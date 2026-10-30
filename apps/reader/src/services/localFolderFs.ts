/**
 * Desktop adapter for the local-folder sync provider (ADR-0006, Syncthing
 * story). The native side owns the user-picked root and rejects any path that
 * escapes it; this module only speaks root-relative paths.
 */
import type { FolderFs } from '@hamesh/sync';
import { isTauriRuntime } from './dataStore';

const invokeFs = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
};

export const isLocalFolderAvailable = (): boolean => isTauriRuntime();

/** Native folder picker; stores the chosen root in the Rust side. */
export const pickSyncFolder = async (): Promise<string | null> => {
  if (!isTauriRuntime()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: 'Choose sync folder' });
  if (typeof picked !== 'string') return null;
  return invokeFs<string>('sync_set_root', { path: picked });
};

/** Re-establish the saved root after a restart (needed before fs commands). */
export const restoreSyncRoot = async (path: string): Promise<string | null> => {
  if (!isTauriRuntime() || !path) return null;
  try {
    return await invokeFs<string>('sync_set_root', { path });
  } catch {
    return null;
  }
};

export const getSyncRoot = async (): Promise<string | null> => {
  if (!isTauriRuntime()) return null;
  return invokeFs<string | null>('sync_root', {});
};

export const createLocalFolderFs = (): FolderFs => ({
  async readFile(relative) {
    const data = await invokeFs<number[] | null>('sync_fs_read', { relative });
    const bytes = new Uint8Array(data ?? []);
    if (bytes.byteLength === 0 && data === null) throw new Error(`ENOENT: ${relative}`);
    return bytes;
  },
  async writeFile(relative, data) {
    await invokeFs<null>('sync_fs_write', { relative, data: Array.from(data) });
  },
  async exists(relative) {
    return invokeFs<boolean>('sync_fs_exists', { relative });
  },
  async remove(relative) {
    await invokeFs<null>('sync_fs_remove', { relative });
  },
  async list(relative) {
    return invokeFs<string[]>('sync_fs_list', { relative });
  },
});
