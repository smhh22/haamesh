/**
 * Sync orchestration for the app: builds the engine from the app's stores and
 * the configured provider. Clocks are stamped at the write sites, never here.
 */

import type { StorageProvider, SyncReport } from '@hamesh/sync';
import { createLocalFolderProvider, createSyncEngine, createWebDavProvider } from '@hamesh/sync';
import { extractMissingBookTexts } from './bookTexts';
import { createDataStore, isTauriRuntime } from './dataStore';
import { keychainDelete, keychainGet, keychainSet } from './keychain';
import { getActiveStorage, getSyncClock, reloadLibraryFromStorage } from './libraryPersistence';
import { createLocalFolderFs, isLocalFolderAvailable, restoreSyncRoot } from './localFolderFs';
import { createSqlSyncStore, getOrCreateDeviceId } from './syncStore';

export interface SyncConfig {
  provider: 'none' | 'webdav' | 'local-folder';
  baseUrl: string;
  username: string;
  password: string;
  /** Desktop only: absolute path of the user-chosen sync folder. */
  localFolder: string;
  /** True when the password lives in the OS keychain rather than the config. */
  hasPassword: boolean;
}

export interface SyncStatus {
  lastSyncAt: number | null;
  lastReport: SyncReport | null;
}

const DEFAULT_CONFIG: SyncConfig = {
  provider: 'none',
  baseUrl: '',
  username: '',
  password: '',
  localFolder: '',
  hasPassword: false,
};

const CONFIG_KEY = 'hamesh.sync.config';
const STATUS_KEY = 'hamesh.sync.status';

export const loadSyncConfig = (): SyncConfig => {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw
      ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<SyncConfig>) }
      : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
};

const PASSWORD_KEY = 'sync.webdav.password';

/**
 * Persist config. The WebDAV password never goes to localStorage on desktop:
 * it is written to the OS keychain and only a `hasPassword` marker remains.
 * On web there is no OS keychain, so the fallback keeps it in localStorage
 * (documented caveat in the sync settings).
 */
export const saveSyncConfig = (config: SyncConfig): void => {
  if (isTauriRuntime()) {
    if (config.password) {
      void keychainSet(PASSWORD_KEY, config.password);
    } else if (!config.hasPassword) {
      void keychainDelete(PASSWORD_KEY);
    }
    const stored: SyncConfig = {
      ...config,
      password: '',
      hasPassword: config.hasPassword || Boolean(config.password),
    };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(stored));
    return;
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

/** Swap the `hasPassword` marker for the real secret before using a provider. */
const withResolvedPassword = async (config: SyncConfig): Promise<SyncConfig> => {
  if (config.password || !config.hasPassword) return config;
  const password = (await keychainGet(PASSWORD_KEY)) ?? '';
  return { ...config, password };
};

/** One-way migration: move a plaintext password out of localStorage. */
export const initSyncSecurity = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return;
  try {
    const stored = JSON.parse(raw) as Partial<SyncConfig>;
    if (stored.password) {
      await keychainSet(PASSWORD_KEY, stored.password);
      localStorage.setItem(
        CONFIG_KEY,
        JSON.stringify({ ...stored, password: '', hasPassword: true }),
      );
    }
  } catch {
    // Malformed config is ignored; the next save rewrites it.
  }
};

const loadStatus = (): SyncStatus => {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as SyncStatus) : { lastSyncAt: null, lastReport: null };
  } catch {
    return { lastSyncAt: null, lastReport: null };
  }
};

export const syncStatus = (): SyncStatus => loadStatus();

export const providerFromConfig = (config: SyncConfig): StorageProvider | null => {
  switch (config.provider) {
    case 'local-folder':
      return isLocalFolderAvailable() ? createLocalFolderProvider(createLocalFolderFs()) : null;
    case 'webdav':
      return config.baseUrl
        ? createWebDavProvider({
            baseUrl: config.baseUrl,
            username: config.username || undefined,
            password: config.password || undefined,
          })
        : null;
    default:
      return null;
  }
};

/** Basic reachability + credentials check for the settings panel. */
export const testSyncConnection = async (
  config: SyncConfig,
): Promise<{ ok: boolean; message: string }> => {
  const provider = providerFromConfig(await withResolvedPassword(config));
  if (!provider) return { ok: false, message: 'Provider not configured.' };
  try {
    await provider.ensureDir(['Hamesh']);
    await provider.readText('Hamesh/index.json');
    return { ok: true, message: 'Connection OK.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Interval for background sync rounds while the app stays open. */
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

/** Fire-and-forget sync when a provider is configured; errors are swallowed. */
const autoSync = async (): Promise<void> => {
  const config = loadSyncConfig();
  if (config.provider === 'none') return;
  if (config.provider === 'webdav' && !config.baseUrl) return;
  try {
    if (config.provider === 'local-folder' && config.localFolder) {
      await restoreSyncRoot(config.localFolder);
    }
    await runSync(config);
  } catch {
    // Auto-sync is best-effort; the manual button surfaces real errors.
  }
};

/**
 * ADR-0006 convergence points: app open, page-hide (best-effort; the webview
 * can be torn down before a request completes — local SQLite keeps the data
 * and the next round catches up), a 5-minute timer while the app stays open
 * and visible, and the manual button.
 */
export const initAutoSync = (): (() => void) => {
  void autoSync();
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') void autoSync();
  }, AUTO_SYNC_INTERVAL_MS);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const onHide = () => {
    if (document.visibilityState !== 'hidden') return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => void autoSync(), 2000);
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => void autoSync());
  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onHide);
    if (hideTimer) clearTimeout(hideTimer);
  };
};

// One round at a time per install: manual clicks, the timer, and page-hide
// all share the in-flight promise instead of racing the engine.
let syncInFlight: Promise<SyncReport> | null = null;

/** Run one sync round against the configured provider (deduped while running). */
export const runSync = (config: SyncConfig): Promise<SyncReport> => {
  syncInFlight ??= runSyncRound(config).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
};

const runSyncRound = async (config: SyncConfig): Promise<SyncReport> => {
  const provider = providerFromConfig(await withResolvedPassword(config));
  if (!provider) throw new Error('Provider not configured.');
  const storage = getActiveStorage();
  const clock = getSyncClock();
  const dataStore = await createDataStore();
  if (!storage || !clock || !dataStore) throw new Error('Storage is not initialized.');

  const deviceId = await getOrCreateDeviceId(dataStore);
  const store = createSqlSyncStore(storage, dataStore);
  const engine = createSyncEngine({ deviceId, clock, store, providers: [provider] });
  const report = await engine.sync();
  localStorage.setItem(
    STATUS_KEY,
    JSON.stringify({ lastSyncAt: Date.now(), lastReport: report } satisfies SyncStatus),
  );
  // Local SQL writes from the pull are invisible to the running UI until the
  // stores rehydrate; do both only when the round actually changed something.
  const changed = report.providers.some(
    (item) => item.pulledRecords > 0 || item.downloadedBlobs > 0,
  );
  if (changed) {
    await reloadLibraryFromStorage();
    if (report.providers.some((item) => item.downloadedBlobs > 0)) {
      await extractMissingBookTexts();
    }
  }
  return report;
};
