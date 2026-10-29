import type { DataStorePort } from '@hamesh/platform';

const validateRelative = (path: string): string[] => {
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid data path');
  }
  return parts;
};

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const createTauriStore = async (): Promise<DataStorePort> => {
  const { invoke } = await import('@tauri-apps/api/core');

  return {
    async read(relative) {
      const bytes = await invoke<number[] | null>('data_read', { relative });
      return bytes ? Uint8Array.from(bytes) : null;
    },
    async write(relative, data) {
      validateRelative(relative);
      await invoke('data_write', { relative, data: Array.from(data) });
    },
    async remove(relative) {
      validateRelative(relative);
      await invoke('data_remove', { relative });
    },
    async list(relativeDir) {
      return invoke<string[]>('data_list', { relative: relativeDir });
    },
  };
};

const getDirectory = async (
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> => {
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
};

const createOpfsStore = (root: FileSystemDirectoryHandle): DataStorePort => ({
  async read(relative) {
    const parts = validateRelative(relative);
    const name = parts.pop();
    if (!name) return null;
    try {
      const dir = await getDirectory(root, parts, false);
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      throw error;
    }
  },

  async write(relative, data) {
    const parts = validateRelative(relative);
    const name = parts.pop();
    if (!name) throw new Error('Invalid data path');
    const dir = await getDirectory(root, parts, true);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
    copy.set(data);
    await writable.write(copy);
    await writable.close();
  },

  async remove(relative) {
    const parts = validateRelative(relative);
    const name = parts.pop();
    if (!name) return;
    try {
      const dir = await getDirectory(root, parts, false);
      await dir.removeEntry(name);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      throw error;
    }
  },

  async list(relativeDir) {
    const parts = validateRelative(relativeDir);
    try {
      const dir = await getDirectory(root, parts, false);
      const names: string[] = [];
      for await (const name of dir.keys()) names.push(name);
      return names;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return [];
      throw error;
    }
  },
});

/**
 * Desktop uses thin Tauri commands over the app data directory; the web
 * development build uses OPFS. Returns null in environments with neither, in
 * which case the library stays in memory.
 */
export const createDataStore = async (): Promise<DataStorePort | null> => {
  if (isTauri()) return createTauriStore();

  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.getDirectory) return null;

  const root = await storage.getDirectory();
  return createOpfsStore(root);
};
