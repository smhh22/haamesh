/**
 * In-memory StorageProvider: the reference implementation for the conformance
 * suite and the multi-device engine simulations.
 */
import type { ProviderCapabilities, ProviderEntry, StorageProvider } from '../provider';
import { ProviderError } from '../provider';

export interface MemoryProviderOptions {
  id?: string;
  /** Simulated flakiness for tests: reject up to N operations with NETWORK. */
  failFirst?: number;
}

export const createMemoryProvider = (options: MemoryProviderOptions = {}): StorageProvider => {
  const files = new Map<string, { body: ArrayBuffer | string; version: number }>();
  let failuresLeft = options.failFirst ?? 0;
  const etagOf = (path: string): string | null => {
    const file = files.get(path);
    return file ? `"v${file.version}"` : null;
  };

  const rejectMaybe = (): void => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new ProviderError('simulated network failure', 'NETWORK');
    }
  };

  const parts = (path: string): string[] => path.split('/').filter(Boolean);
  const hasDir = (dir: string): boolean => {
    if (files.has(`${dir}/`)) return true;
    const prefix = `${dir}/`;
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  };
  const mkdirp = (path: string): void => {
    const segments = parts(path);
    let current = '';
    for (const segment of segments) {
      current = `${current}/${segment}`;
      files.set(`${current}/`, { body: '', version: 0 });
    }
  };

  return {
    id: options.id ?? 'memory',
    capabilities: {
      etag: true,
      atomicRename: true,
      streaming: false,
      mkdirs: true,
      rangeRequests: false,
    } satisfies ProviderCapabilities,

    async readText(path) {
      rejectMaybe();
      const file = files.get(path);
      return file && typeof file.body === 'string' ? file.body : null;
    },
    async readBinary(path) {
      rejectMaybe();
      const file = files.get(path);
      return file && file.body instanceof ArrayBuffer ? file.body : null;
    },
    async head(path) {
      rejectMaybe();
      const file = files.get(path);
      if (!file) return null;
      return {
        size: typeof file.body === 'string' ? file.body.length : file.body.byteLength,
        etag: `"v${file.version}"`,
      };
    },
    async list(path) {
      rejectMaybe();
      const prefix = path === '' ? '' : `${path.replace(/\/$/, '')}/`;
      const seen = new Set<string>();
      const entries: ProviderEntry[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix) || key === prefix) continue;
        const rest = key.slice(prefix.length);
        if (rest === '') continue;
        const [head, ...remainder] = rest.split('/');
        if (!head) continue;
        if (remainder.length > 0 || key === `${prefix}${head}/`) {
          if (!seen.has(head)) {
            seen.add(head);
            entries.push({ name: head, path: `${prefix}${head}`, isDirectory: true });
          }
        } else {
          entries.push({ name: head, path: `${prefix}${head}`, isDirectory: false });
        }
      }
      return entries;
    },
    async writeText(path, body) {
      rejectMaybe();
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir && !hasDir(dir)) mkdirp(dir);
      files.set(path, { body, version: (files.get(path)?.version ?? 0) + 1 });
    },
    async writeTextConditional(path, body, etag) {
      rejectMaybe();
      const current = etagOf(path);
      if (current !== etag) return 'conflict';
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir && !hasDir(dir)) mkdirp(dir);
      files.set(path, { body, version: (files.get(path)?.version ?? 0) + 1 });
      return 'ok';
    },
    async writeBinary(path, body) {
      rejectMaybe();
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir && !hasDir(dir)) mkdirp(dir);
      files.set(path, { body, version: (files.get(path)?.version ?? 0) + 1 });
    },
    async ensureDir(paths) {
      rejectMaybe();
      for (const path of paths) mkdirp(path);
    },
    async deleteDir(path) {
      rejectMaybe();
      const prefix = `${path.replace(/\/$/, '')}/`;
      for (const key of [...files.keys()]) {
        if (key.startsWith(prefix)) files.delete(key);
      }
    },
  };
};
