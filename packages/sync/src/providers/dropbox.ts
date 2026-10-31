/**
 * Dropbox provider using a user-owned scoped app — no vendor backend. The user
 * creates their own app in the Dropbox App Console and supplies the app key,
 * app secret, and a refresh token; access tokens are refreshed here and cached
 * in memory. Uploads use `mode: update(rev)` for real conditional writes, so
 * the engine's read-merge-retry works exactly as with WebDAV.
 *
 * Routes and argument shapes follow dropbox/dropbox-api-spec (files.stone):
 * upload/download carry their argument in the Dropbox-API-Arg header, API
 * routes take JSON bodies, and the OAuth token route is form-encoded.
 */
import type {
  ProviderCapabilities,
  ProviderEntry,
  ProviderHead,
  StorageProvider,
} from '../provider';
import { ProviderError } from '../provider';

export interface DropboxConfig {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  /** Stable id used in sync reports; defaults to "dropbox". */
  id?: string;
}

export interface DropboxEndpoints {
  api: string;
  content: string;
  token: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_ENDPOINTS: DropboxEndpoints = {
  api: 'https://api.dropboxapi.com/2',
  content: 'https://content.dropboxapi.com/2',
  token: 'https://api.dropboxapi.com/oauth2/token',
};

export const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';

/** The consent URL that yields a code to paste back (offline access). */
export const dropboxAuthorizeUrl = (appKey: string): string =>
  `${DROPBOX_AUTHORIZE_URL}?client_id=${encodeURIComponent(appKey)}` +
  '&response_type=code&token_access_type=offline';

interface DropboxToken {
  value: string;
  expiresAt: number;
}

interface FileMetadata {
  '.tag'?: string;
  name?: string;
  path_display?: string;
  path_lower?: string;
  rev?: string;
  size?: number;
  server_modified?: string;
}

interface ListFolderResponse {
  entries?: FileMetadata[];
  cursor?: string;
  has_more?: boolean;
}

const remotePath = (path: string): string => `/${path.replace(/^\/+/, '')}`;

const parentPaths = (path: string): string[] => {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/');
  return parts.slice(0, -1).map((_, index) => `/${parts.slice(0, index + 1).join('/')}`);
};

const isNotFound = (summary: string): boolean => summary.includes('not_found');

export const createDropboxProvider = (
  config: DropboxConfig,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  now: () => number = () => Date.now(),
  endpoints: Partial<DropboxEndpoints> = {},
): StorageProvider => {
  const urls: DropboxEndpoints = { ...DEFAULT_ENDPOINTS, ...endpoints };
  let token: DropboxToken | null = null;

  const refresh = async (): Promise<string> => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken,
      client_id: config.appKey,
      client_secret: config.appSecret,
    });
    const response = await fetchImpl(urls.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new ProviderError('dropbox token refresh failed', 'AUTH_FAILED', response.status);
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new ProviderError('dropbox token response has no access_token', 'AUTH_FAILED');
    }
    token = {
      value: data.access_token,
      expiresAt: now() + (data.expires_in ?? 14_400) * 1000,
    };
    return token.value;
  };

  const accessToken = async (force = false): Promise<string> => {
    if (!force && token && token.expiresAt > now() + 60_000) return token.value;
    return refresh();
  };

  /** JSON API call with one auth retry (a cached token can expire mid-session). */
  const api = async (route: string, body: unknown): Promise<Response> => {
    const call = async (force: boolean) =>
      fetchImpl(`${urls.api}/${route}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessToken(force)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const response = await call(false);
    if (response.status !== 401) return response;
    return call(true);
  };

  /** Content API call: the argument travels in the Dropbox-API-Arg header. */
  const content = async (
    route: string,
    arg: unknown,
    init: { method: 'POST'; body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> => {
    const call = async (force: boolean) =>
      fetchImpl(`${urls.content}/${route}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${await accessToken(force)}`,
          'Dropbox-API-Arg': JSON.stringify(arg),
        },
      });
    const response = await call(false);
    if (response.status !== 401) return response;
    return call(true);
  };

  const errorSummary = async (response: Response): Promise<string> => {
    try {
      const data = (await response.json()) as { error_summary?: string };
      return data.error_summary ?? '';
    } catch {
      return '';
    }
  };

  const failure = async (route: string, response: Response): Promise<ProviderError> => {
    const summary = await errorSummary(response);
    if (response.status === 401 || response.status === 403) {
      return new ProviderError(`dropbox auth failed on ${route}`, 'AUTH_FAILED', response.status);
    }
    if (response.status === 409 && summary.includes('conflict')) {
      return new ProviderError(`dropbox conflict on ${route}`, 'CONFLICT', response.status);
    }
    return new ProviderError(
      `dropbox ${route} failed with ${response.status}${summary ? `: ${summary}` : ''}`,
      'UNKNOWN',
      response.status,
    );
  };

  const head = async (path: string): Promise<ProviderHead | null> => {
    const response = await api('files/get_metadata', { path: remotePath(path) });
    if (response.status === 409) return null;
    if (!response.ok) throw await failure('files/get_metadata', response);
    const meta = (await response.json()) as FileMetadata;
    return { size: meta.size, etag: meta.rev };
  };

  const readBinary = async (path: string): Promise<ArrayBuffer | null> => {
    const response = await content(
      'files/download',
      { path: remotePath(path) },
      { method: 'POST' },
    );
    if (response.status === 409) return null;
    if (!response.ok) throw await failure('files/download', response);
    return response.arrayBuffer();
  };

  const ensureDir = async (paths: string[]): Promise<void> => {
    for (const path of paths) {
      const response = await api('files/create_folder_v2', {
        path: remotePath(path),
        autorename: false,
      });
      // 409 means the folder already exists; nothing to do.
      if (!response.ok && response.status !== 409) {
        throw await failure('files/create_folder_v2', response);
      }
    }
  };

  const createParents = async (path: string): Promise<void> => {
    await ensureDir(parentPaths(remotePath(path)));
  };

  const upload = async (
    path: string,
    body: BodyInit,
    mode: unknown,
    contentType: string,
  ): Promise<Response> => {
    const arg = {
      path: remotePath(path),
      mode,
      autorename: false,
      mute: true,
      strict_conflict: true,
    };
    const send = () =>
      content('files/upload', arg, {
        method: 'POST',
        body,
        headers: { 'Content-Type': contentType },
      });
    const response = await send();
    // Dropbox does not create parents implicitly; do it once and retry.
    if (response.status === 409) {
      if (isNotFound(await errorSummary(response.clone()))) {
        await createParents(path);
        return send();
      }
    }
    return response;
  };

  return {
    id: config.id ?? 'dropbox',
    capabilities: {
      etag: true,
      atomicRename: false,
      streaming: false,
      mkdirs: true,
      rangeRequests: false,
    } satisfies ProviderCapabilities,

    readText: async (path) => {
      const bytes = await readBinary(path);
      return bytes ? new TextDecoder().decode(bytes) : null;
    },

    readBinary,

    head,

    async list(path) {
      const response = await api('files/list_folder', {
        path: remotePath(path),
        recursive: false,
      });
      if (response.status === 409) return [];
      if (!response.ok) throw await failure('files/list_folder', response);

      const entries: ProviderEntry[] = [];
      let page = (await response.json()) as ListFolderResponse;
      for (;;) {
        for (const entry of page.entries ?? []) {
          if (entry['.tag'] === 'deleted' || !entry.name) continue;
          entries.push({
            name: entry.name,
            path: (entry.path_display ?? '').replace(/^\/+/, ''),
            isDirectory: entry['.tag'] === 'folder',
            size: entry.size,
            lastModified: entry.server_modified,
          });
        }
        if (!page.has_more || !page.cursor) break;
        const next = await api('files/list_folder/continue', { cursor: page.cursor });
        if (!next.ok) throw await failure('files/list_folder/continue', next);
        page = (await next.json()) as ListFolderResponse;
      }
      return entries;
    },

    async writeText(path, body) {
      const response = await upload(path, body, 'overwrite', 'application/octet-stream');
      if (!response.ok) throw await failure('files/upload', response);
    },

    async writeTextConditional(path, body, etag) {
      const mode = etag ? { '.tag': 'update', update: etag } : { '.tag': 'add' };
      const response = await upload(path, body, mode, 'application/octet-stream');
      if (response.ok) return 'ok';
      const summary = await errorSummary(response);
      if (response.status === 409 && (summary.includes('conflict') || isNotFound(summary))) {
        return 'conflict';
      }
      throw await failure('files/upload', response);
    },

    async writeBinary(path, body) {
      const response = await upload(path, body, 'overwrite', 'application/octet-stream');
      if (!response.ok) throw await failure('files/upload', response);
    },

    ensureDir,

    async deleteDir(path) {
      const response = await api('files/delete_v2', { path: remotePath(path) });
      if (response.status === 409) return;
      if (!response.ok) throw await failure('files/delete_v2', response);
    },

    async deleteFile(path) {
      const response = await api('files/delete_v2', { path: remotePath(path) });
      if (response.status === 409) return;
      if (!response.ok) throw await failure('files/delete_v2', response);
    },
  };
};

/**
 * Exchange a pasted authorization code for a refresh token (offline access).
 * The user's own app credentials form the request; nothing goes through us.
 */
export const exchangeDropboxCode = async (
  config: Pick<DropboxConfig, 'appKey' | 'appSecret'>,
  code: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  tokenUrl: string = DEFAULT_ENDPOINTS.token,
): Promise<string> => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code.trim(),
    client_id: config.appKey,
    client_secret: config.appSecret,
  });
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new ProviderError('dropbox code exchange failed', 'AUTH_FAILED', response.status);
  }
  const data = (await response.json()) as { refresh_token?: string };
  if (!data.refresh_token) {
    throw new ProviderError('dropbox response has no refresh_token', 'AUTH_FAILED');
  }
  return data.refresh_token;
};
