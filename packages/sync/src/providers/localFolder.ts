/**
 * Local-folder storage provider: points the sync engine at a directory the
 * user owns — a Syncthing folder, a USB drive, or a desktop sync client's
 * folder. Built on a minimal filesystem surface (the platform FileSystemPort
 * satisfies it structurally); no network stack involved.
 *
 * FileSystemPort.list returns bare names, so directory detection probes the
 * port; capabilities are conservative (no etag, no atomic rename guarantee).
 */
import type { ProviderCapabilities, ProviderEntry, StorageProvider } from '../provider';
import { ProviderError } from '../provider';

/** Minimal filesystem surface; the platform FileSystemPort satisfies it structurally. */
export interface FolderFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
  /** Optional; without it, ensureDir leaves a marker file instead. */
  mkdir?(path: string): Promise<void>;
}

export const createLocalFolderProvider = (fs: FolderFs, baseDir = ''): StorageProvider => {
  const join = (...parts: string[]): string =>
    [baseDir, ...parts]
      .filter((part) => part !== '')
      .join('/')
      .replace(/\/{2,}/g, '/');

  const isDirectory = async (path: string): Promise<boolean> => {
    try {
      const children = await fs.list(path);
      return Array.isArray(children);
    } catch {
      return false;
    }
  };

  return {
    id: 'local-folder',
    capabilities: {
      etag: false,
      atomicRename: false,
      streaming: false,
      mkdirs: false,
      rangeRequests: false,
    } satisfies ProviderCapabilities,

    async readText(path) {
      const full = join(path);
      if (!(await fs.exists(full))) return null;
      return new TextDecoder().decode(await fs.readFile(full));
    },

    async readBinary(path) {
      const full = join(path);
      if (!(await fs.exists(full))) return null;
      return fs.readFile(full).then((data) => data.slice().buffer);
    },

    async head(path) {
      const full = join(path);
      if (!(await fs.exists(full))) return null;
      const data = await fs.readFile(full);
      return { size: data.byteLength };
    },

    async list(path) {
      const full = join(path);
      let names: string[];
      try {
        names = await fs.list(full);
      } catch {
        return [];
      }
      const entries: ProviderEntry[] = [];
      for (const name of names) {
        const child = full ? `${full}/${name}` : name;
        entries.push({
          name,
          path: `${path}/${name}`.replace(/^\/+/, ''),
          isDirectory: await isDirectory(child),
        });
      }
      return entries;
    },

    async writeText(path, body) {
      await fs.writeFile(join(path), new TextEncoder().encode(body));
    },

    async writeBinary(path, body) {
      await fs.writeFile(join(path), new Uint8Array(body));
    },

    async ensureDir(paths) {
      for (const path of paths) {
        if (fs.mkdir) {
          await fs.mkdir(join(path));
        } else if (!(await fs.exists(join(path)))) {
          // Fallback for filesystem ports without mkdir: a marker file makes
          // the directory exist.
          await fs.writeFile(join(path, '.hamesh-dir'), new Uint8Array());
        }
      }
    },

    async deleteDir(path) {
      const full = join(path);
      if (!(await fs.exists(full))) return;
      try {
        await fs.remove(full);
      } catch (error) {
        throw new ProviderError(`delete failed: ${String(error)}`, 'UNKNOWN');
      }
    },
  };
};
