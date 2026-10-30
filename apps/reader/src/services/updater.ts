/**
 * In-app updates (Tauri updater): AppImage and Windows get real
 * download-and-install with signed artifacts from GitHub Releases; deb/rpm
 * installs cannot be replaced in place, so the UI links to the release page.
 */
import { isTauriRuntime } from './dataStore';

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

export const supportsInAppUpdate = (): boolean => isTauriRuntime();

/** Silent check; resolves null on web, when up to date, or on any failure. */
export const checkForUpdate = async (): Promise<UpdateInfo | null> => {
  if (!isTauriRuntime()) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    return update ? { version: update.version, notes: update.body ?? null } : null;
  } catch {
    return null;
  }
};

/** Download, install, and relaunch. Throws on failure so the UI can report. */
export const installUpdate = async (): Promise<void> => {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return;
  await update.downloadAndInstall();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
};
