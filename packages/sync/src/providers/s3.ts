/**
 * S3-compatible storage provider (MinIO, Arvan, Liara, R2, B2, AWS). Path-style
 * addressing by default; SigV4 header signing via ./awsV4.
 *
 * Conditional index writes are not attempted: many S3-compatible services do
 * not implement If-Match, so the engine falls back to the plain commit
 * (convergence still holds; conflict detection is WebDAV-only for now).
 */
import type {
  ProviderCapabilities,
  ProviderEntry,
  ProviderHead,
  StorageProvider,
} from '../provider';
import { ProviderError } from '../provider';
import { EMPTY_PAYLOAD_HASH, sha256Hex, signAwsV4, uriEncode } from './awsV4';

export interface S3Config {
  /** Scheme + host (+ optional port), no bucket, e.g. https://s3.ir-thr-at1.arvanstorage.ir */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Stable id used in sync reports; defaults to "s3". */
  id?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const errorFor = (method: string, path: string, response: Response): ProviderError => {
  if (response.status === 403 || response.status === 401) {
    return new ProviderError(`auth failed for ${method} ${path}`, 'AUTH_FAILED', response.status);
  }
  if (response.status === 404) {
    return new ProviderError(`not found: ${path}`, 'NOT_FOUND', response.status);
  }
  return new ProviderError(
    `${method} ${path} failed with ${response.status}`,
    'UNKNOWN',
    response.status,
  );
};

const xmlText = (doc: Document, tag: string): string[] =>
  Array.from(doc.getElementsByTagName(tag)).map((node) => node.textContent ?? '');

export const createS3Provider = (
  config: S3Config,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  now: () => Date = () => new Date(),
): StorageProvider => {
  const base = `${config.endpoint.replace(/\/$/, '')}/${uriEncode(config.bucket)}`;
  const keyUrl = (path: string): string =>
    `${base}/${path
      .split('/')
      .filter(Boolean)
      .map((segment) => uriEncode(segment))
      .join('/')}`;

  const request = async (
    method: string,
    url: string,
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> => {
    const payloadHash = body ? await sha256Hex(body) : EMPTY_PAYLOAD_HASH;
    let signed: Awaited<ReturnType<typeof signAwsV4>>;
    try {
      signed = await signAwsV4({
        method,
        url,
        payloadHash,
        contentSha256Header: true,
        headers: extraHeaders,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: config.region,
        service: 's3',
        date: now(),
      });
    } catch (cause) {
      throw new ProviderError(`signing failed: ${String(cause)}`, 'UNKNOWN');
    }
    try {
      return await fetchImpl(url, {
        method,
        headers: { ...signed.headers, Authorization: signed.authorization },
        body: body as BodyInit | undefined,
      });
    } catch (cause) {
      throw new ProviderError(`network error: ${String(cause)}`, 'NETWORK');
    }
  };

  return {
    id: config.id ?? 's3',
    capabilities: {
      etag: true,
      atomicRename: false,
      streaming: false,
      mkdirs: false,
      rangeRequests: false,
    } satisfies ProviderCapabilities,

    async readText(path) {
      const response = await request('GET', keyUrl(path));
      if (response.status === 404) return null;
      if (!response.ok) throw errorFor('GET', path, response);
      return response.text();
    },

    async readBinary(path) {
      const response = await request('GET', keyUrl(path));
      if (response.status === 404) return null;
      if (!response.ok) throw errorFor('GET', path, response);
      return response.arrayBuffer();
    },

    async head(path) {
      const response = await request('HEAD', keyUrl(path));
      if (response.status === 404) return null;
      if (!response.ok) throw errorFor('HEAD', path, response);
      const size = response.headers.get('Content-Length');
      const etag = response.headers.get('ETag');
      const head: ProviderHead = {};
      if (size !== null && size !== '') head.size = Number(size);
      if (etag) head.etag = etag;
      return head;
    },

    async list(path) {
      const dir = path.replace(/^\/+|\/+$/g, '');
      const prefix = dir ? `${dir}/` : '';
      const url = `${base}?list-type=2&delimiter=%2F&prefix=${uriEncode(prefix, false)}`;
      const response = await request('GET', url);
      if (response.status === 404) return [];
      if (!response.ok) throw errorFor('LIST', path, response);
      const xml = await response.text();
      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      const entries: ProviderEntry[] = [];
      for (const key of xmlText(parsed, 'Key')) {
        if (!key || key === prefix) continue;
        const name = key.slice(prefix.length);
        if (!name || name.includes('/')) continue;
        entries.push({ name, path: `${dir}/${name}`.replace(/^\/+/, ''), isDirectory: false });
      }
      for (const commonPrefix of xmlText(parsed, 'Prefix')) {
        const name = commonPrefix.slice(prefix.length).replace(/\/$/, '');
        if (!name || name.includes('/')) continue;
        entries.push({ name, path: `${dir}/${name}`.replace(/^\/+/, ''), isDirectory: true });
      }
      return entries;
    },

    async writeText(path, body) {
      const response = await request('PUT', keyUrl(path), new TextEncoder().encode(body), {
        'content-type': 'application/json; charset=utf-8',
      });
      if (!response.ok) throw errorFor('PUT', path, response);
    },

    async writeBinary(path, body) {
      const response = await request('PUT', keyUrl(path), new Uint8Array(body), {
        'content-type': 'application/octet-stream',
      });
      if (!response.ok) throw errorFor('PUT', path, response);
    },

    async ensureDir() {
      // Object storage has no directories; prefixes exist implicitly.
    },

    async deleteFile(path) {
      const response = await request('DELETE', keyUrl(path));
      if (response.status === 404) return;
      if (!response.ok) throw errorFor('DELETE', path, response);
    },

    async deleteDir(path) {
      const dir = path.replace(/^\/+|\/+$/g, '');
      const prefix = dir ? `${dir}/` : '';
      let token: string | null = null;
      do {
        const url =
          `${base}?list-type=2&prefix=${uriEncode(prefix, false)}` +
          (token ? `&continuation-token=${uriEncode(token)}` : '');
        const response = await request('GET', url);
        if (response.status === 404) return;
        if (!response.ok) throw errorFor('LIST', path, response);
        const xml = await response.text();
        const parsed = new DOMParser().parseFromString(xml, 'application/xml');
        for (const key of xmlText(parsed, 'Key')) {
          const del = await request('DELETE', keyUrl(key));
          if (!del.ok && del.status !== 404) throw errorFor('DELETE', key, del);
        }
        token = xmlText(parsed, 'NextContinuationToken')[0] || null;
      } while (token);
    },
  };
};
