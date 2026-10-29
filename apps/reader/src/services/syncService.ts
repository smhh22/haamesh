/**
 * Sync orchestration for the app: builds the engine from the app's stores and
 * the configured provider. Clocks are stamped at the write sites, never here.
 */

import type { StorageProvider, SyncReport } from '@hamesh/sync';
import { createSyncEngine, createWebDavProvider } from '@hamesh/sync';
import { createDataStore } from './dataStore';
import { getActiveStorage, getSyncClock } from './libraryPersistence';
import { createSqlSyncStore, getOrCreateDeviceId } from './syncStore';

export interface SyncConfig {
  provider: 'none' | 'webdav';
  baseUrl: string;
  username: string;
  password: string;
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

export const saveSyncConfig = (config: SyncConfig): void => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
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
  const provider = providerFromConfig(config);
  if (!provider) return { ok: false, message: 'Provider not configured.' };
  try {
    await provider.ensureDir(['Hamesh']);
    await provider.readText('Hamesh/index.json');
    return { ok: true, message: 'Connection OK.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Run one sync round against the configured provider. */
export const runSync = async (config: SyncConfig): Promise<SyncReport> => {
  const provider = providerFromConfig(config);
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
  return report;
};
