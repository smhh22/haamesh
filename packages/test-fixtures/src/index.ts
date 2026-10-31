import type { ProviderEntry, StorageProvider } from '@hamesh/sync';

export type { TestEpubOptions } from './epub';
export { createTestEpub } from './epub';
export { createTestPdf } from './pdf';

export interface FixedClock {
  now(): number;
  advance(ms: number): void;
}

export const createFixedClock = (start = 0): FixedClock => {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
};

const normalize = (path: string): string => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return `/${segments.join('/')}`;
};

/**
 * In-memory implementation of the storage provider contract. Used by tests and
 * by the sync UI before a real provider is connected.
 */
export const createMemoryProvider = (id = 'memory'): StorageProvider => {
  const files = new Map<string, Uint8Array>();

  return {
    id,
    capabilities: {
      etag: false,
      atomicRename: false,
      streaming: false,
      mkdirs: true,
      rangeRequests: false,
    },

    async readText(path) {
      const bytes = files.get(normalize(path));
      return bytes ? new TextDecoder().decode(bytes) : null;
    },

    async readBinary(path) {
      const bytes = files.get(normalize(path));
      if (!bytes) return null;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    },

    async head(path) {
      const bytes = files.get(normalize(path));
      return bytes ? { size: bytes.byteLength } : null;
    },

    async list(path) {
      const dir = normalize(path) === '/' ? '' : normalize(path);
      const entries = new Map<string, ProviderEntry>();
      for (const [key, bytes] of files) {
        if (!key.startsWith(`${dir}/`)) continue;
        const rest = key.slice(dir.length + 1);
        const slash = rest.indexOf('/');
        if (slash === -1) {
          entries.set(rest, { name: rest, path: key, isDirectory: false, size: bytes.byteLength });
        } else {
          const name = rest.slice(0, slash);
          entries.set(name, { name, path: `${dir}/${name}`, isDirectory: true });
        }
      }
      return [...entries.values()];
    },

    async writeText(path, body) {
      files.set(normalize(path), new TextEncoder().encode(body));
    },

    async writeBinary(path, body) {
      files.set(normalize(path), new Uint8Array(body).slice());
    },

    async ensureDir() {
      return;
    },

    async deleteDir(path) {
      const dir = normalize(path);
      for (const key of [...files.keys()]) {
        if (key === dir || key.startsWith(`${dir}/`)) files.delete(key);
      }
    },

    async deleteFile(path) {
      files.delete(normalize(path));
    },
  };
};
