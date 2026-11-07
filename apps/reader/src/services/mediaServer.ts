import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './dataStore';

/**
 * Media origin for video playback (ADR-0023). On the desktop shell the Rust
 * loopback server streams content-addressed blobs with Range support; on the
 * web (tests, dev) an object URL over the file bytes works instead.
 */
export const mediaUrlFor = async (
  file: File,
  sha256: string,
  container: string,
): Promise<string> => {
  if (!isTauriRuntime()) return URL.createObjectURL(file);
  const base = await invoke<string>('media_server_start');
  return `${base}${sha256}.${container}`;
};
