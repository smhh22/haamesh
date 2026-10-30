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
/**
 * Pick the sync folder with the native dialog. The path is chosen and
 * stored in Rust, so the webview never supplies a filesystem root.
 */
export const pickSyncFolder = async (): Promise<string | null> => {
  if (!isTauriRuntime()) return null;
  return invokeFs<string | null>('sync_pick_root', {});
};

/**
 * Re-establish the saved root after a restart (needed before fs commands).
 * The root is restored from Rust-side storage; older builds that only saved
 * the path in webview config adopt it once.
 */
export const restoreSyncRoot = async (path: string): Promise<string | null> => {
  if (!isTauriRuntime()) return null;
  try {
    const restored = await invokeFs<string | null>('sync_restore_root', {});
    if (restored) return restored;
    if (!path) return null;
    return await invokeFs<string | null>('sync_adopt_root', { path });
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
