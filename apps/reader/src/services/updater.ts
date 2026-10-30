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

export type InstallKind = 'appimage' | 'deb' | 'unknown';

const LATEST_JSON = 'https://github.com/smhh22/haamesh/releases/latest/download/latest.json';

export const supportsInAppUpdate = (): boolean => isTauriRuntime();

export const installKind = async (): Promise<InstallKind> => {
  if (!isTauriRuntime()) return 'unknown';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string>('install_kind')) as InstallKind;
  } catch {
    return 'unknown';
  }
};

const currentVersion = async (): Promise<string> => {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
};

/** deb/rpm: the plugin's check targets AppImage artifacts, so read latest.json. */
const checkViaLatestJson = async (): Promise<UpdateInfo | null> => {
  const response = await fetch(LATEST_JSON, { cache: 'no-store' });
  if (!response.ok) return null;
  const data = (await response.json()) as { version?: string; notes?: string };
  if (!data.version) return null;
  const installed = await currentVersion();
  return data.version !== installed ? { version: data.version, notes: data.notes ?? null } : null;
};

/** Silent check; resolves null on web, when up to date, or on any failure. */
export const checkForUpdate = async (): Promise<UpdateInfo | null> => {
  if (!isTauriRuntime()) return null;
  try {
    if ((await installKind()) === 'deb') return await checkViaLatestJson();
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    return update ? { version: update.version, notes: update.body ?? null } : null;
  } catch {
    return null;
  }
};

/** Download, install, and relaunch. Throws on failure so the UI can report. */
export const installUpdate = async (version: string): Promise<void> => {
  if ((await installKind()) === 'deb') {
    // Deterministic artifact name from the bundler.
    const url = `https://github.com/smhh22/haamesh/releases/download/v${version}/Hamesh_${version}_amd64.deb`;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('install_deb_update', { url, version });
  } else {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return;
    await update.downloadAndInstall();
  }
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
};
