/**
 * In-app updates: AppImage and Windows use the Tauri updater with signed
 * artifacts from GitHub Releases. deb/rpm installs download `latest.json` and
 * the deb through the native HTTP bridge (GitHub release assets do not send
 * CORS headers, so a WebView fetch cannot read them), then hand the deb to
 * apt-get through pkexec.
 */
import { isTauriRuntime } from './dataStore';
import { isNewerVersion } from './version';

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
const fetchLatest = async (): Promise<{ version?: string; notes?: string } | null> => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<{ status: number; body: number[] }>('http_request', {
      method: 'GET',
      url: LATEST_JSON,
      headers: {},
      body: null,
      proxy: null,
    });
    if (response.status < 200 || response.status >= 300) return null;
    const text = new TextDecoder().decode(Uint8Array.from(response.body));
    return JSON.parse(text) as { version?: string; notes?: string };
  } catch {
    return null;
  }
};

const checkViaLatestJson = async (): Promise<UpdateInfo | null> => {
  const data = await fetchLatest();
  if (!data?.version) return null;
  const installed = await currentVersion();
  return isNewerVersion(data.version, installed)
    ? { version: data.version, notes: data.notes ?? null }
    : null;
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
