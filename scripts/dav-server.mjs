/**
 * Minimal WebDAV server for the two-device sync harness. Implements the
 * subset the app uses — OPTIONS, GET, HEAD, PUT, MKCOL, DELETE, PROPFIND —
 * with Basic auth and Apache-like status codes. Dev/test only.
 *
 * Usage: node scripts/dav-server.mjs [port] [rootDir]
 * Credentials: alice / secret (override with DAV_USER / DAV_PASS).
 */

import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 8081);
const root = normalize(process.argv[3] ?? '/tmp/hamesh-dav-data');
const user = process.env.DAV_USER ?? 'alice';
const pass = process.env.DAV_PASS ?? 'secret';

const expectedAuth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const xmlEscape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const resolvePath = (urlPath) => {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  if (decoded.includes('..')) return null;
  return join(root, normalize(decoded));
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND',
  'Access-Control-Allow-Headers': 'Authorization, Depth, Content-Type',
  'Access-Control-Expose-Headers': 'ETag, Content-Length',
  'Access-Control-Max-Age': '600',
};

const send = (res, status, body = null, headers = {}) => {
  res.writeHead(status, { ...cors, ...headers });
  res.end(body);
};

const statOrNull = async (path) => {
  try {
    return await fs.stat(path);
  } catch {
    return null;
  }
};

const ensureParent = async (path) => {
  await fs.mkdir(dirname(path), { recursive: true });
};

const propfind = async (res, path, depth) => {
  const stat = await statOrNull(path);
  if (!stat) return send(res, 404);

  const entries = [{ path, stat }];
  if (depth !== '0' && stat.isDirectory()) {
    const children = await fs.readdir(path, { withFileTypes: true });
    for (const child of children) {
      const childPath = join(path, child.name);
      entries.push({ path: childPath, stat: await fs.stat(childPath) });
    }
  }

  const responses = entries
    .map(({ path: entryPath, stat: entryStat }) => {
      const href = `/${entryPath.slice(root.length).split('\\').join('/')}`;
      const isDir = entryStat.isDirectory();
      return (
        '<d:response>' +
        `<d:href>${xmlEscape(href)}</d:href>` +
        '<d:propstat><d:prop>' +
        (isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>') +
        `<d:getcontentlength>${isDir ? 0 : entryStat.size}</d:getcontentlength>` +
        `<d:getlastmodified>${entryStat.mtime.toUTCString()}</d:getlastmodified>` +
        '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>' +
        '</d:response>'
      );
    })
    .join('');

  send(
    res,
    207,
    `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`,
    { 'Content-Type': 'application/xml; charset=utf-8' },
  );
};

await fs.mkdir(root, { recursive: true });

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.headers.authorization !== expectedAuth) {
    return send(res, 401, null, { 'WWW-Authenticate': 'Basic realm="hamesh-test"' });
  }

  const path = resolvePath(req.url ?? '/');
  if (!path) return send(res, 400);
  if (['PUT', 'MKCOL', 'DELETE', 'PROPFIND'].includes(req.method ?? '')) {
    console.log(`${req.method} ${req.url} depth=${req.headers.depth ?? '-'}`);
  }

  try {
    switch (req.method) {
      case 'GET': {
        const stat = await statOrNull(path);
        if (!stat || stat.isDirectory()) return send(res, 404);
        const data = await fs.readFile(path);
        return send(res, 200, data, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(data.length),
          ETag: `"${stat.size}-${stat.mtimeMs}"`,
        });
      }
      case 'HEAD': {
        const stat = await statOrNull(path);
        if (!stat || stat.isDirectory()) return send(res, 404);
        return send(res, 200, null, {
          'Content-Length': String(stat.size),
          ETag: `"${stat.size}-${stat.mtimeMs}"`,
        });
      }
      case 'PUT': {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const existed = Boolean(await statOrNull(path));
        await ensureParent(path);
        await fs.writeFile(path, body);
        return send(res, existed ? 204 : 201);
      }
      case 'MKCOL': {
        if (await statOrNull(path)) return send(res, 405);
        await fs.mkdir(path, { recursive: true });
        return send(res, 201);
      }
      case 'DELETE': {
        const stat = await statOrNull(path);
        if (!stat) return send(res, 404);
        await fs.rm(path, { recursive: true, force: true });
        return send(res, 204);
      }
      case 'PROPFIND':
        return propfind(res, path, req.headers.depth ?? 'infinity');
      default:
        return send(res, 405);
    }
  } catch (error) {
    console.error('DAV error', req.method, req.url, error);
    return send(res, 500);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DAV server on http://127.0.0.1:${port} root=${root} user=${user}`);
});
