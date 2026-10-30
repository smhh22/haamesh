// @vitest-environment jsdom
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { providerConformanceChecks } from '../conformance';
import type { StorageProvider } from '../provider';
import { createDropboxProvider, exchangeDropboxCode } from './dropbox';

/**
 * Minimal in-process Dropbox: the OAuth token route plus files/upload,
 * files/download, files/get_metadata, files/list_folder (+continue),
 * files/create_folder_v2, and files/delete_v2, following files.stone. Every
 * route requires a bearer token, upload validates WriteMode semantics
 * (add/overwrite/update(rev)) and rejects missing parents, and list_folder
 * paginates at two entries per page.
 */
const createFakeDropbox = async (): Promise<{ server: Server; base: string }> => {
  const files = new Map<string, { body: Buffer; rev: number }>();
  const folders = new Set<string>(['/']);
  let rev = 0;
  let tokenCalls = 0;

  const metadata = (path: string) => {
    const file = files.get(path);
    return {
      '.tag': 'file',
      name: path.split('/').pop(),
      path_display: path,
      rev: file ? `rev-${file.rev}` : undefined,
      size: file?.body.length,
      server_modified: '2026-01-01T00:00:00Z',
    };
  };

  const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: import('node:http').IncomingMessage): Promise<Buffer> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/oauth2/token') {
      const form = new URLSearchParams((await readBody(req)).toString());
      if (form.get('grant_type') === 'refresh_token') {
        tokenCalls += 1;
        json(res, 200, { access_token: `access-${tokenCalls}`, expires_in: 14_400 });
        return;
      }
      if (form.get('grant_type') === 'authorization_code') {
        json(res, 200, { refresh_token: 'refresh-from-code' });
        return;
      }
      json(res, 400, { error: 'unsupported_grant_type' });
      return;
    }

    if (!req.headers.authorization?.startsWith('Bearer ')) {
      json(res, 401, { error_summary: 'invalid_access_token/' });
      return;
    }

    let arg: Record<string, unknown> = {};
    const rawArg = req.headers['dropbox-api-arg'];
    if (typeof rawArg === 'string') arg = JSON.parse(rawArg) as Record<string, unknown>;
    const route = url.pathname.replace(/^\/2\//, '');
    const body = await readBody(req);
    // JSON API routes carry their argument in the body; upload/download use
    // the Dropbox-API-Arg header and keep the body as file content.
    if (!rawArg && body.length > 0) {
      try {
        arg = JSON.parse(body.toString()) as Record<string, unknown>;
      } catch {
        arg = {};
      }
    }
    const path = typeof arg.path === 'string' ? arg.path : '';

    if (route === 'files/upload') {
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!folders.has(parent)) {
        console.error(
          'FAKE upload missing parent',
          JSON.stringify(path),
          JSON.stringify(parent),
          JSON.stringify([...folders]),
        );
        json(res, 409, { error_summary: 'path/not_found/..' });
        return;
      }
      const mode = arg.mode as { '.tag'?: string; update?: string } | string;
      const existing = files.get(path);
      const tag = typeof mode === 'string' ? mode : (mode['.tag'] ?? 'add');
      if (tag === 'add' && existing) {
        if (!existing.body.equals(body)) {
          json(res, 409, { error_summary: 'path/conflict/file/..' });
          return;
        }
        json(res, 200, metadata(path));
        return;
      }
      if (tag === 'update') {
        const expected = typeof mode === 'object' ? mode.update : undefined;
        if (!existing || `rev-${existing.rev}` !== expected) {
          json(res, 409, { error_summary: 'path/conflict/file/..' });
          return;
        }
      }
      rev += 1;
      files.set(path, { body, rev });
      json(res, 200, metadata(path));
      return;
    }

    if (route === 'files/download') {
      const file = files.get(path);
      if (!file) {
        json(res, 409, { error_summary: 'path/not_found/..' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(file.body);
      return;
    }

    if (route === 'files/get_metadata') {
      const file = files.get(path);
      if (!file) {
        json(res, 409, { error_summary: 'path/not_found/..' });
        return;
      }
      json(res, 200, metadata(path));
      return;
    }

    if (route === 'files/list_folder' || route === 'files/list_folder/continue') {
      const dir = route.endsWith('continue')
        ? String(arg.cursor).split('|')[0]
        : String(arg.path ?? '');
      const prefix = dir === '/' ? '/' : `${dir}/`;
      const children = new Map<string, { folder: boolean; path: string }>();
      for (const folder of folders) {
        if (folder === dir || !folder.startsWith(prefix)) continue;
        const rest = folder.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        children.set(rest, { folder: true, path: folder });
      }
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        children.set(rest, { folder: false, path: filePath });
      }
      const all = [...children.values()].sort((a, b) => a.path.localeCompare(b.path));
      const pageSize = 2;
      const offset = route.endsWith('continue') ? Number(String(arg.cursor).split('|')[1] ?? 0) : 0;
      const page = all.slice(offset, offset + pageSize);
      const hasMore = offset + pageSize < all.length;
      json(res, 200, {
        entries: page.map((entry) =>
          entry.folder
            ? { '.tag': 'folder', name: entry.path.split('/').pop(), path_display: entry.path }
            : metadata(entry.path),
        ),
        cursor: `${dir}|${offset + pageSize}`,
        has_more: hasMore,
      });
      return;
    }

    if (route === 'files/create_folder_v2') {
      if (folders.has(path)) {
        json(res, 409, { error_summary: 'path/conflict/folder/..' });
        return;
      }
      folders.add(path);
      json(res, 200, { metadata: { '.tag': 'folder', path_display: path } });
      return;
    }

    if (route === 'files/delete_v2') {
      const exists =
        files.has(path) || folders.has(path) || [...folders].some((f) => f.startsWith(`${path}/`));
      if (!exists) {
        json(res, 409, { error_summary: 'path_lookup/not_found/..' });
        return;
      }
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
      for (const folder of [...folders]) {
        if (folder === path || folder.startsWith(`${path}/`)) folders.delete(folder);
      }
      json(res, 200, { metadata: { '.tag': 'folder', path_display: path } });
      return;
    }

    json(res, 404, { error_summary: 'unknown_route' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
};

let fake: { server: Server; base: string };

beforeAll(async () => {
  fake = await createFakeDropbox();
});

afterAll(async () => {
  await new Promise<void>((resolve) => fake.server.close(() => resolve()));
});

const endpoints = (): { api: string; content: string; token: string } => ({
  api: `${fake.base}/2`,
  content: `${fake.base}/2`,
  token: `${fake.base}/oauth2/token`,
});

const createProvider = (): StorageProvider =>
  createDropboxProvider(
    { appKey: 'app-key', appSecret: 'app-secret', refreshToken: 'refresh-token' },
    (input, init) => fetch(input, init),
    () => Date.now(),
    endpoints(),
  );

describe('dropbox provider conformance', () => {
  for (const check of providerConformanceChecks) {
    it(check.name, async () => {
      await expect(check.run(createProvider)).resolves.toBeUndefined();
    });
  }
});

describe('dropbox provider specifics', () => {
  it('refreshes the access token once and only again after expiry', async () => {
    let now = 1_000_000;
    let calls = 0;
    const base = fake.base;
    const provider = createDropboxProvider(
      { appKey: 'k', appSecret: 's', refreshToken: 'r' },
      (input, init) => {
        if (input.endsWith('/oauth2/token')) calls += 1;
        return fetch(input, init);
      },
      () => now,
      { api: `${base}/2`, content: `${base}/2`, token: `${base}/oauth2/token` },
    );

    await provider.head('docs/absent.json');
    await provider.head('docs/absent.json');
    expect(calls).toBe(1);

    now += 15_000_000; // beyond the 4h window
    await provider.head('docs/absent.json');
    expect(calls).toBe(2);
  });

  it('uses update(rev) for conditional writes and reports conflicts', async () => {
    const provider = createProvider();
    await provider.writeText('cond/file.txt', 'one');
    const head = await provider.head('cond/file.txt');
    expect(head?.etag).toBeTruthy();

    expect(await provider.writeTextConditional?.('cond/file.txt', 'two', head?.etag ?? null)).toBe(
      'ok',
    );
    // The previous etag is stale now.
    expect(
      await provider.writeTextConditional?.('cond/file.txt', 'three', head?.etag ?? null),
    ).toBe('conflict');
    // Create-only on an existing file with different contents conflicts.
    expect(await provider.writeTextConditional?.('cond/file.txt', 'four', null)).toBe('conflict');
    expect(await provider.writeTextConditional?.('cond/new.txt', 'fresh', null)).toBe('ok');
  });

  it('pages through large listings', async () => {
    const provider = createProvider();
    for (let index = 0; index < 5; index += 1) {
      await provider.writeText(`paged/item-${index}.json`, String(index));
    }
    const entries = await provider.list('paged');
    expect(entries.filter((entry) => !entry.isDirectory)).toHaveLength(5);
  });

  it('exchanges an authorization code for a refresh token', async () => {
    const token = await exchangeDropboxCode(
      { appKey: 'app-key', appSecret: 'app-secret' },
      'the-code',
      (input, init) => fetch(input, init),
      `${fake.base}/oauth2/token`,
    );
    expect(token).toBe('refresh-from-code');
  });
});
