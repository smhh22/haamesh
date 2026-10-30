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

export type UpdateCheck =
  | ({ status: 'available' } & UpdateInfo)
  | { status: 'current' }
  | { status: 'error' };

export type InstallKind = 'appimage' | 'deb' | 'package' | 'windows' | 'unknown';

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

const checkViaLatestJson = async (): Promise<UpdateCheck> => {
  const data = await fetchLatest();
  if (!data?.version) return { status: 'error' };
  const installed = await currentVersion();
  return isNewerVersion(data.version, installed)
    ? { status: 'available', version: data.version, notes: data.notes ?? null }
    : { status: 'current' };
};

/** Distinguishes "no update" from "could not check" for the manual button. */
export const checkForUpdate = async (): Promise<UpdateCheck> => {
  if (!isTauriRuntime()) return { status: 'error' };
  try {
    const kind = await installKind();
    if (kind === 'deb' || kind === 'package') return await checkViaLatestJson();
    if (kind !== 'appimage' && kind !== 'windows') return { status: 'error' };
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    return update
      ? { status: 'available', version: update.version, notes: update.body ?? null }
      : { status: 'current' };
  } catch {
    return { status: 'error' };
  }
};

/** Download, install, and relaunch. Throws on failure so the UI can report. */
export const installUpdate = async (version: string): Promise<void> => {
  const kind = await installKind();
  if (kind === 'deb') {
    // Deterministic artifact name from the bundler.
    const url = `https://github.com/smhh22/haamesh/releases/download/v${version}/Hamesh_${version}_amd64.deb`;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('install_deb_update', { url, version });
  } else if (kind === 'appimage' || kind === 'windows') {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return;
    await update.downloadAndInstall();
  } else {
    throw new Error(
      'Automatic install is not available for this package. Download the latest package from the releases page.',
    );
  }
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
};
