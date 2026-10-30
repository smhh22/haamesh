// @vitest-environment jsdom
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { providerConformanceChecks } from '../conformance';
import type { StorageProvider } from '../provider';
import { createS3Provider } from './s3';

/**
 * Minimal in-process S3: path-style GET/PUT/HEAD/DELETE plus ListObjectsV2
 * with delimiter. Signature validation is not simulated — the signer is
 * verified separately against the AWS test vectors — but every request must
 * carry an Authorization header so unsigned traffic fails the suite.
 */
const createFakeS3 = async (): Promise<{ server: Server; port: number }> => {
  const objects = new Map<string, { body: Buffer; etag: string }>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256')) {
      res.writeHead(403);
      res.end();
      return;
    }
    const [, ...rest] = url.pathname.replace(/^\/+/, '').split('/');
    const key = decodeURIComponent(rest.join('/'));

    if (url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const delimiter = url.searchParams.get('delimiter') ?? '';
      const contents: string[] = [];
      const commonPrefixes = new Set<string>();
      for (const [storedKey, object] of objects) {
        if (!storedKey.startsWith(prefix)) continue;
        const restKey = storedKey.slice(prefix.length);
        if (delimiter && restKey.includes(delimiter)) {
          commonPrefixes.add(prefix + restKey.slice(0, restKey.indexOf(delimiter) + 1));
        } else if (restKey) {
          contents.push(
            `<Contents><Key>${storedKey}</Key><Size>${object.body.length}</Size><ETag>${object.etag}</ETag></Contents>`,
          );
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>` +
          contents.join('') +
          [...commonPrefixes]
            .map((prefixKey) => `<CommonPrefixes><Prefix>${prefixKey}</Prefix></CommonPrefixes>`)
            .join('') +
          `</ListBucketResult>`,
      );
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const object = objects.get(key);
      if (!object) {
        res.writeHead(404);
        res.end();
        return;
      }
      const headers = {
        'Content-Length': String(object.body.length),
        'Content-Type': 'application/octet-stream',
        ETag: object.etag,
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      res.end(object.body);
      return;
    }

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      objects.set(key, { body, etag: `"${body.length}-${objects.size}"` });
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { server, port: address.port };
};

describe('s3 provider', () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    const started = await createFakeS3();
    server = started.server;
    port = started.port;
  });

  afterAll(() => {
    server.close();
  });

  const createProvider = (): StorageProvider =>
    createS3Provider({
      endpoint: `http://127.0.0.1:${port}`,
      region: 'us-east-1',
      bucket: 'hamesh-test',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
    });

  for (const check of providerConformanceChecks) {
    it(check.name, async () => {
      await expect(check.run(createProvider)).resolves.toBeUndefined();
    });
  }

  it('signs every request with AWS4-HMAC-SHA256', async () => {
    const headers: string[] = [];
    const provider = createS3Provider(
      {
        endpoint: `http://127.0.0.1:${port}`,
        region: 'us-east-1',
        bucket: 'hamesh-test',
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'secret',
      },
      (input, init) => {
        const auth = new Headers(init?.headers).get('Authorization') ?? '';
        headers.push(auth);
        return fetch(input, init);
      },
    );
    await provider.writeText('auth/check.json', '{}');
    expect(headers[0]).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request/,
    );
  });
});
