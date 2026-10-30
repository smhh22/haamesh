// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { describeProviderConformance } from '../conformance.vitest';
import type { ProviderError } from '../provider';
import type { FetchLike } from './webdav';
import { createWebDavProvider } from './webdav';

/**
 * A strict in-memory DAV server: MKCOL refuses missing parents (409), PUT
 * requires the collection to exist, PROPFIND answers with absolute-path hrefs
 * (the most common server behavior).
 */
const createFakeDavServer = (options: { hrefStyle?: 'path' | 'url' } = {}) => {
  const hrefFor = (entry: string): string =>
    options.hrefStyle === 'url' ? `https://dav.example.com${entry}` : entry;
  const files = new Map<string, ArrayBuffer>();
  const dirs = new Set<string>(['/']);
  // A real server always has the user's DAV root; seed its ancestors.
  {
    let current = '';
    for (const segment of new URL(SERVER_BASE).pathname.split('/').filter(Boolean)) {
      current = `${current}/${segment}`;
      dirs.add(current);
    }
  }

  const authOk = (headers: Headers): boolean =>
    headers.get('Authorization') === `Basic ${btoa('alice:s3cret')}`;

  const status = (body: ArrayBuffer): Response =>
    new Response(body, { status: 200, headers: { ETag: '"etag-1"' } });

  const propfind = (path: string): Response => {
    if (!dirs.has(path) && !files.has(path)) return new Response(null, { status: 404 });
    const prefix = path === '/' ? '' : path;
    const children = new Set<string>();
    for (const dir of dirs) {
      if (
        dir !== path &&
        dir.startsWith(`${prefix}/`) &&
        !dir.slice(prefix.length + 1).includes('/')
      ) {
        children.add(dir);
      }
    }
    for (const file of files.keys()) {
      if (file.startsWith(`${prefix}/`) && !file.slice(prefix.length + 1).includes('/')) {
        children.add(file);
      }
    }
    const responses = [path, ...children]
      .map((entry) => {
        const isDir = dirs.has(entry);
        const size = files.get(entry)?.byteLength;
        return (
          `<d:response>` +
          `<d:href>${hrefFor(entry)}</d:href>` +
          `<d:propstat><d:prop>` +
          (isDir ? `<d:resourcetype><d:collection/></d:resourcetype>` : `<d:resourcetype/>`) +
          (size !== undefined ? `<d:getcontentlength>${size}</d:getcontentlength>` : '') +
          `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` +
          `</d:response>`
        );
      })
      .join('');
    return new Response(
      `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`,
      { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
    );
  };

  const handler: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (!authOk(request.headers)) return new Response(null, { status: 401 });

    switch (request.method) {
      case 'GET':
        return files.has(path)
          ? status(files.get(path) ?? new ArrayBuffer(0))
          : new Response(null, { status: 404 });
      case 'HEAD':
        return files.has(path)
          ? new Response(null, {
              status: 200,
              headers: {
                'Content-Length': String(files.get(path)?.byteLength ?? 0),
                ETag: '"etag-1"',
              },
            })
          : new Response(null, { status: 404 });
      case 'PUT': {
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        if (!dirs.has(parent)) return new Response(null, { status: 409 });
        files.set(path, await request.arrayBuffer());
        return new Response(null, { status: 201 });
      }
      case 'MKCOL': {
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        if (dirs.has(path) || files.has(path)) return new Response(null, { status: 405 });
        if (!dirs.has(parent)) return new Response(null, { status: 409 });
        dirs.add(path);
        return new Response(null, { status: 201 });
      }
      case 'DELETE': {
        if (!dirs.has(path) && !files.has(path)) return new Response(null, { status: 404 });
        for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
        for (const key of [...dirs]) if (key.startsWith(`${path}/`)) dirs.delete(key);
        dirs.delete(path);
        files.delete(path);
        return new Response(null, { status: 204 });
      }
      case 'PROPFIND':
        return propfind(path);
      default:
        return new Response(null, { status: 405 });
    }
  };
  return handler;
};

const SERVER_BASE = 'https://dav.example.com/remote.php/dav/files/alice';

describe('webdav provider', () => {
  describeProviderConformance(() =>
    createWebDavProvider(
      { baseUrl: SERVER_BASE, username: 'alice', password: 's3cret' },
      createFakeDavServer(),
    ),
  );

  it('creates parent collections automatically for nested writes', async () => {
    const provider = createWebDavProvider(
      { baseUrl: SERVER_BASE, username: 'alice', password: 's3cret' },
      createFakeDavServer(),
    );
    await provider.writeText('Hamesh/index.json', '{}');
    expect(await provider.readText('Hamesh/index.json')).toBe('{}');
  });

  it('maps 401 to AUTH_FAILED', async () => {
    const provider = createWebDavProvider(
      { baseUrl: SERVER_BASE, username: 'alice', password: 'wrong' },
      createFakeDavServer(),
    );
    await expect(provider.readText('Hamesh/index.json')).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'AUTH_FAILED',
      status: 401,
    } satisfies Partial<ProviderError>);
  });

  it('maps transport failures to NETWORK', async () => {
    const provider = createWebDavProvider(
      { baseUrl: SERVER_BASE, username: 'alice', password: 's3cret' },
      () => Promise.reject(new TypeError('fetch failed')),
    );
    await expect(provider.readText('Hamesh/index.json')).rejects.toMatchObject({
      code: 'NETWORK',
    } satisfies Partial<ProviderError>);
  });

  it('parses PROPFIND hrefs returned as full URLs', async () => {
    const provider = createWebDavProvider(
      { baseUrl: SERVER_BASE, username: 'alice', password: 's3cret' },
      createFakeDavServer({ hrefStyle: 'url' }),
    );
    await provider.writeText('Hamesh/books/x/meta.json', '{}');
    const entries = await provider.list('Hamesh/books');
    expect(entries.map((entry) => entry.name)).toEqual(['x']);
  });

  it('surfaces 404 as NOT_FOUND for explicit reads through head', async () => {
    const provider = createWebDavProvider(
      { baseUrl: SERVER_BASE, username: 'alice', password: 's3cret' },
      createFakeDavServer(),
    );
    expect(await provider.head('Hamesh/missing.json')).toBeNull();
  });
});
