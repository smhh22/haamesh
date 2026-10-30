/**
 * WebDAV storage provider (Nextcloud, ownCloud, Alist, infini-cloud, ...).
 * Plain HTTP verbs against any RFC 4918 server; the fetch implementation is
 * injectable so the desktop shell can route around CORS and tests can mount
 * a fake server.
 */
import type {
  ProviderCapabilities,
  ProviderEntry,
  ProviderHead,
  StorageProvider,
} from '../provider';
import { ProviderError } from '../provider';

export interface WebDavConfig {
  /** Server base, e.g. https://cloud.example.com/remote.php/dav/files/alice */
  baseUrl: string;
  username?: string;
  password?: string;
  /** Directory inside baseUrl that holds the Hamesh tree. */
  basePath?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/$/, '')}/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;

/** UTF-8 safe Basic auth: btoa throws on non-Latin credentials. */
const basicAuth = (username: string, password: string): string => {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
};

export const createWebDavProvider = (
  config: WebDavConfig,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): StorageProvider => {
  const base = `${config.baseUrl.replace(/\/$/, '')}/${(config.basePath ?? '').split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
  const url = (path: string): string => joinUrl(base, path);
  // Some servers return full URLs in PROPFIND hrefs, others absolute paths.
  const origin = new URL(config.baseUrl).origin;
  const basePathWithSlash = base.slice(origin.length);

  /** Map a multistatus href to a provider-relative path. */
  const decodeHref = (href: string): string => {
    let value = href;
    if (value.startsWith(origin)) value = value.slice(origin.length);
    if (value.startsWith(basePathWithSlash)) value = value.slice(basePathWithSlash.length);
    else if (
      basePathWithSlash.replace(/\/$/, '') !== '/' &&
      value === basePathWithSlash.replace(/\/$/, '')
    )
      value = '';
    try {
      return decodeURIComponent(value.replace(/\/$/, '').replace(/^\/+/, ''));
    } catch {
      return value.replace(/^\/+/, '');
    }
  };
  const authHeader =
    config.username !== undefined || config.password !== undefined
      ? basicAuth(config.username ?? '', config.password ?? '')
      : null;

  const request = async (
    method: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (authHeader) headers.set('Authorization', authHeader);
    let response: Response;
    try {
      response = await fetchImpl(url(path), { ...init, method, headers });
    } catch (cause) {
      throw new ProviderError(`network error: ${String(cause)}`, 'NETWORK');
    }
    return response;
  };

  const requireOk = async (method: string, path: string, response: Response): Promise<Response> => {
    if (response.ok) return response;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`auth failed for ${method} ${path}`, 'AUTH_FAILED', response.status);
    }
    if (response.status === 404) {
      throw new ProviderError(`not found: ${path}`, 'NOT_FOUND', response.status);
    }
    throw new ProviderError(
      `${method} ${path} failed with ${response.status}`,
      'UNKNOWN',
      response.status,
    );
  };

  const bodyOf = async (method: string, path: string, response: Response): Promise<Response> => {
    if (response.ok) return response;
    if (response.status === 404) {
      throw new ProviderError(`not found: ${path}`, 'NOT_FOUND', response.status);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`auth failed for ${method} ${path}`, 'AUTH_FAILED', response.status);
    }
    throw new ProviderError(
      `${method} ${path} failed with ${response.status}`,
      'UNKNOWN',
      response.status,
    );
  };

  const mkcolAll = async (paths: string[]): Promise<void> => {
    for (const path of paths) {
      const segments = path.split('/').filter(Boolean);
      let current = '';
      for (const segment of segments) {
        current = `${current}/${segment}`;
        const response = await request('MKCOL', current);
        // 405 = already exists; some servers answer 301 for trailing dirs.
        if (!response.ok && response.status !== 405 && response.status !== 301) {
          await requireOk('MKCOL', current, response);
        }
      }
    }
  };

  /** Strict DAV servers answer 409 when the parent collection is missing: create it and retry once. */
  const putWithParents = async (path: string, init: RequestInit): Promise<void> => {
    const first = await request('PUT', path, init);
    if (first.status === 409) {
      const segments = path.split('/').filter(Boolean);
      const parents: string[] = [];
      let current = '';
      for (const segment of segments.slice(0, -1)) {
        current = `${current}/${segment}`;
        parents.push(current);
      }
      await mkcolAll(parents);
      await requireOk('PUT', path, await request('PUT', path, init));
      return;
    }
    await requireOk('PUT', path, first);
  };

  return {
    id: 'webdav',
    capabilities: {
      etag: true,
      atomicRename: false,
      streaming: false,
      mkdirs: true,
      rangeRequests: false,
    } satisfies ProviderCapabilities,

    async readText(path) {
      const response = await request('GET', path);
      if (response.status === 404) return null;
      const ok = await bodyOf('GET', path, response);
      return ok.text();
    },

    async readBinary(path) {
      const response = await request('GET', path);
      if (response.status === 404) return null;
      const ok = await bodyOf('GET', path, response);
      return ok.arrayBuffer();
    },

    async head(path) {
      const response = await request('HEAD', path);
      if (response.status === 404) return null;
      const ok = await bodyOf('HEAD', path, response);
      const size = ok.headers.get('Content-Length');
      const etag = ok.headers.get('ETag');
      const head: ProviderHead = {};
      if (size !== null && size !== '') head.size = Number(size);
      if (etag) head.etag = etag;
      return head;
    },

    async list(path) {
      const dir = path.replace(/\/$/, '');
      const body =
        `<?xml version="1.0" encoding="utf-8"?>` +
        `<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`;
      const response = await request('PROPFIND', `${dir}/`, {
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body,
      });
      if (response.status === 404) return [];
      const ok = await bodyOf('PROPFIND', dir, response);
      const xml = await ok.text();
      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      const entries: ProviderEntry[] = [];
      for (const responseNode of Array.from(parsed.getElementsByTagNameNS('DAV:', 'response'))) {
        const hrefNode = responseNode.getElementsByTagNameNS('DAV:', 'href')[0];
        if (!hrefNode?.textContent) continue;
        const decoded = decodeHref(hrefNode.textContent);
        const name = decoded.split('/').filter(Boolean).pop() ?? '';
        if (!name || decoded === dir) continue;
        const isDirectory = responseNode.getElementsByTagNameNS('DAV:', 'collection').length > 0;
        const sizeNode = responseNode.getElementsByTagNameNS('DAV:', 'getcontentlength')[0];
        const modifiedNode = responseNode.getElementsByTagNameNS('DAV:', 'getlastmodified')[0];
        entries.push({
          name,
          path: `${dir}/${name}`,
          isDirectory,
          ...(isDirectory
            ? {}
            : sizeNode?.textContent
              ? { size: Number(sizeNode.textContent) }
              : {}),
          ...(modifiedNode?.textContent ? { lastModified: modifiedNode.textContent } : {}),
        });
      }
      return entries;
    },

    async writeText(path, body) {
      const init: RequestInit = {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      };
      await putWithParents(path, init);
    },

    async writeTextConditional(path, body, etag) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
      if (etag) headers['If-Match'] = etag;
      else headers['If-None-Match'] = '*';
      const response = await request('PUT', path, { headers, body });
      if (response.status === 412) return 'conflict';
      if (response.status === 409) {
        // Missing parent collection: create it and retry once with the same precondition.
        const segments = path.split('/').filter(Boolean);
        const parents: string[] = [];
        let current = '';
        for (const segment of segments.slice(0, -1)) {
          current = `${current}/${segment}`;
          parents.push(current);
        }
        await mkcolAll(parents);
        const retry = await request('PUT', path, { headers, body });
        if (retry.status === 412) return 'conflict';
        await requireOk('PUT', path, retry);
        return 'ok';
      }
      await requireOk('PUT', path, response);
      return 'ok';
    },

    async writeBinary(path, body) {
      const init: RequestInit = {
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      };
      await putWithParents(path, init);
    },

    async ensureDir(paths) {
      await mkcolAll(paths);
    },

    async deleteDir(path) {
      const response = await request('DELETE', path);
      if (response.status === 404) return;
      await requireOk('DELETE', path, response);
    },
  };
};
