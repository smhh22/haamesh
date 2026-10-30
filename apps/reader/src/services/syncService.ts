/**
 * Sync orchestration for the app: builds the engine from the app's stores and
 * the configured providers. Clocks are stamped at the write sites, never here.
 *
 * ADR-0006 mirroring: every enabled provider holds a full replica of the same
 * library; the engine merges each with the same rules. No sharding.
 */

import type { StorageProvider, SyncReport } from '@hamesh/sync';
import {
  createDropboxProvider,
  createLocalFolderProvider,
  createS3Provider,
  createSyncEngine,
  createWebDavProvider,
  exchangeDropboxCode,
} from '@hamesh/sync';
import { extractMissingBookTexts } from './bookTexts';
import { createDataStore, isTauriRuntime } from './dataStore';
import { providerFetch } from './httpFetch';
import { keychainDelete, keychainGet, keychainSet } from './keychain';
import { getActiveStorage, getSyncClock, reloadLibraryFromStorage } from './libraryPersistence';
import { createLocalFolderFs, isLocalFolderAvailable, restoreSyncRoot } from './localFolderFs';
import { createSqlSyncStore, getOrCreateDeviceId } from './syncStore';

export type ProviderKind = 'webdav' | 'local-folder' | 's3' | 'dropbox';

export interface SyncProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  enabled: boolean;
  /** WebDAV */
  baseUrl: string;
  username: string;
  /** Runtime only; persisted to the OS keychain (web: localStorage caveat). */
  password: string;
  hasPassword: boolean;
  /** Desktop local folder */
  localFolder: string;
  /** S3-compatible */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  /** Runtime only; persisted to the OS keychain like WebDAV passwords. */
  secretAccessKey: string;
  hasSecretKey: boolean;
  /** Named setup preset (e.g. 'syncthing'), empty for a plain provider. */
  preset: string;
  /** Dropbox (a user-owned scoped app; no vendor backend) */
  appKey: string;
  appSecret: string;
  hasAppSecret: boolean;
  refreshToken: string;
  hasRefreshToken: boolean;
  /** Optional HTTP/SOCKS5 proxy for remote providers (empty = direct). */
  proxy: string;
}

export interface SyncConfig {
  providers: SyncProviderConfig[];
}

export interface SyncStatus {
  lastSyncAt: number | null;
  lastReport: SyncReport | null;
}

const CONFIG_KEY = 'hamesh.sync.config';
const STATUS_KEY = 'hamesh.sync.status';

const providerLabel = (kind: ProviderKind): string => {
  switch (kind) {
    case 'webdav':
      return 'WebDAV';
    case 's3':
      return 'S3';
    case 'dropbox':
      return 'Dropbox';
    default:
      return 'Local folder';
  }
};

export const newProvider = (
  kind: ProviderKind,
  overrides: Partial<SyncProviderConfig> = {},
): SyncProviderConfig => ({
  id: crypto.randomUUID(),
  kind,
  label: providerLabel(kind),
  enabled: true,
  baseUrl: '',
  username: '',
  password: '',
  hasPassword: false,
  localFolder: '',
  endpoint: '',
  region: kind === 's3' ? 'us-east-1' : '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  hasSecretKey: false,
  preset: '',
  appKey: '',
  appSecret: '',
  hasAppSecret: false,
  refreshToken: '',
  hasRefreshToken: false,
  proxy: '',
  ...overrides,
});

/**
 * WebDAV setups that only need a URL pattern: users still fill their own
 * server/user, but the shape is right. Syncthing is the local-folder preset:
 * Syncthing syncs a folder on disk, and Hāmesh syncs inside that folder.
 */
export interface WebdavPreset {
  id: string;
  label: string;
  baseUrl: string;
}

export const WEBDAV_PRESETS: readonly WebdavPreset[] = [
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    baseUrl: 'https://your-server/remote.php/dav/files/username/',
  },
  {
    id: 'owncloud',
    label: 'ownCloud',
    baseUrl: 'https://your-server/remote.php/dav/files/username/',
  },
  { id: 'koofr', label: 'Koofr', baseUrl: 'https://app.koofr.net/dav/Koofr' },
  { id: 'pcloud', label: 'pCloud', baseUrl: 'https://webdav.pcloud.com' },
  { id: 'infinicloud', label: 'InfiniCLOUD', baseUrl: 'https://your-server.teracloud.jp/dav/' },
];

export const SYNCTHING_PRESET = 'syncthing';

const passwordKey = (providerId: string): string => `sync.webdav.password.${providerId}`;
const secretKey = (providerId: string): string => `sync.s3.secret.${providerId}`;
const appSecretKey = (providerId: string): string => `sync.dropbox.appSecret.${providerId}`;
const refreshTokenKey = (providerId: string): string => `sync.dropbox.refreshToken.${providerId}`;

/** Legacy single-provider shape (pre-mirroring) — migrated on load. */
interface LegacyConfig {
  provider?: 'none' | 'webdav' | 'local-folder';
  baseUrl?: string;
  username?: string;
  password?: string;
  localFolder?: string;
  hasPassword?: boolean;
}

const migrateLegacy = (legacy: LegacyConfig): SyncConfig => {
  if (!legacy.provider || legacy.provider === 'none') return { providers: [] };
  return {
    providers: [
      {
        id: 'legacy',
        kind: legacy.provider,
        label: legacy.provider === 'webdav' ? 'WebDAV' : 'Local folder',
        enabled: true,
        baseUrl: legacy.baseUrl ?? '',
        username: legacy.username ?? '',
        password: legacy.password ?? '',
        hasPassword: legacy.hasPassword ?? false,
        localFolder: legacy.localFolder ?? '',
        endpoint: '',
        region: '',
        bucket: '',
        accessKeyId: '',
        secretAccessKey: '',
        hasSecretKey: false,
        preset: '',
        appKey: '',
        appSecret: '',
        hasAppSecret: false,
        refreshToken: '',
        hasRefreshToken: false,
        proxy: '',
      },
    ],
  };
};

export const loadSyncConfig = (): SyncConfig => {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { providers: [] };
    const parsed = JSON.parse(raw) as Partial<SyncConfig> & LegacyConfig;
    if (Array.isArray(parsed.providers)) {
      return { providers: parsed.providers };
    }
    return migrateLegacy(parsed);
  } catch {
    return { providers: [] };
  }
};

/**
 * Persist config. Remote secrets never go to localStorage on desktop: WebDAV
 * passwords and S3 secret keys are written to the OS keychain under the
 * provider id, leaving only a `hasPassword`/`hasSecretKey` marker. On web
 * there is no OS keychain, so the fallback keeps them in localStorage
 * (documented caveat in the sync settings).
 */
/**
 * Keychain writes are serialized so rapid edits cannot interleave and store a
 * partial password out of order.
 */
let secretQueue: Promise<void> = Promise.resolve();
const queueSecret = (operation: () => Promise<void>): void => {
  secretQueue = secretQueue.then(operation, operation);
};

/** Forget every stored secret belonging to a removed provider. */
export const removeProviderSecrets = (providerId: string): void => {
  if (!isTauriRuntime()) return;
  queueSecret(async () => {
    await keychainDelete(passwordKey(providerId));
    await keychainDelete(secretKey(providerId));
    await keychainDelete(appSecretKey(providerId));
    await keychainDelete(refreshTokenKey(providerId));
  });
};

export const saveSyncConfig = (config: SyncConfig): void => {
  if (!isTauriRuntime()) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return;
  }
  const stored: SyncConfig = {
    providers: config.providers.map((provider) => {
      if (provider.kind === 'dropbox') {
        if (provider.appSecret) {
          queueSecret(() => keychainSet(appSecretKey(provider.id), provider.appSecret));
        } else if (!provider.hasAppSecret) {
          queueSecret(() => keychainDelete(appSecretKey(provider.id)));
        }
        if (provider.refreshToken) {
          queueSecret(() => keychainSet(refreshTokenKey(provider.id), provider.refreshToken));
        } else if (!provider.hasRefreshToken) {
          queueSecret(() => keychainDelete(refreshTokenKey(provider.id)));
        }
        return {
          ...provider,
          appSecret: '',
          hasAppSecret: provider.hasAppSecret || Boolean(provider.appSecret),
          refreshToken: '',
          hasRefreshToken: provider.hasRefreshToken || Boolean(provider.refreshToken),
        };
      }
      if (provider.kind === 's3') {
        if (provider.secretAccessKey) {
          queueSecret(() => keychainSet(secretKey(provider.id), provider.secretAccessKey));
        } else if (!provider.hasSecretKey) {
          queueSecret(() => keychainDelete(secretKey(provider.id)));
        }
        return {
          ...provider,
          secretAccessKey: '',
          hasSecretKey: provider.hasSecretKey || Boolean(provider.secretAccessKey),
        };
      }
      if (provider.password) {
        queueSecret(() => keychainSet(passwordKey(provider.id), provider.password));
      } else if (!provider.hasPassword) {
        queueSecret(() => keychainDelete(passwordKey(provider.id)));
      }
      return {
        ...provider,
        password: '',
        hasPassword: provider.hasPassword || Boolean(provider.password),
      };
    }),
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(stored));
};

const resolveSecrets = async (provider: SyncProviderConfig): Promise<SyncProviderConfig> => {
  if (provider.kind === 'dropbox') {
    if (
      (provider.appSecret || !provider.hasAppSecret) &&
      (provider.refreshToken || !provider.hasRefreshToken)
    ) {
      return provider;
    }
    const appSecret = provider.appSecret || ((await keychainGet(appSecretKey(provider.id))) ?? '');
    const refreshToken =
      provider.refreshToken || ((await keychainGet(refreshTokenKey(provider.id))) ?? '');
    return { ...provider, appSecret, refreshToken };
  }
  if (provider.kind === 's3') {
    if (provider.secretAccessKey || !provider.hasSecretKey) return provider;
    const secret = (await keychainGet(secretKey(provider.id))) ?? '';
    return { ...provider, secretAccessKey: secret };
  }
  if (provider.password || !provider.hasPassword) return provider;
  const password = (await keychainGet(passwordKey(provider.id))) ?? '';
  return { ...provider, password };
};

/** One-way migrations: legacy plaintext password → OS keychain. */
export const initSyncSecurity = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncConfig> & LegacyConfig;
    if (parsed.provider && parsed.password) {
      // Legacy flat config: move the single password to the migrated provider.
      await keychainSet(passwordKey('legacy'), parsed.password);
      const migrated = migrateLegacy(parsed);
      saveSyncConfig({
        providers: migrated.providers.map((provider) => ({ ...provider, password: '' })),
      });
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

/** A provider can sync once it has the minimum details its kind needs. */
export const isProviderConfigured = (provider: SyncProviderConfig): boolean => {
  switch (provider.kind) {
    case 'webdav':
      return Boolean(provider.baseUrl);
    case 'local-folder':
      return Boolean(provider.localFolder);
    case 's3':
      return Boolean(
        provider.endpoint &&
          provider.bucket &&
          provider.accessKeyId &&
          (provider.hasSecretKey || provider.secretAccessKey),
      );
    case 'dropbox':
      return Boolean(
        provider.appKey &&
          (provider.hasAppSecret || provider.appSecret) &&
          (provider.hasRefreshToken || provider.refreshToken),
      );
    default:
      return false;
  }
};

export const providerFromConfig = (provider: SyncProviderConfig): StorageProvider | null => {
  switch (provider.kind) {
    case 'local-folder':
      return isLocalFolderAvailable() ? createLocalFolderProvider(createLocalFolderFs()) : null;
    case 'webdav':
      return provider.baseUrl
        ? createWebDavProvider(
            {
              baseUrl: provider.baseUrl,
              username: provider.username || undefined,
              password: provider.password || undefined,
            },
            providerFetch(provider.proxy),
          )
        : null;
    case 'dropbox':
      return provider.appKey && provider.appSecret && provider.refreshToken
        ? createDropboxProvider(
            {
              appKey: provider.appKey,
              appSecret: provider.appSecret,
              refreshToken: provider.refreshToken,
            },
            providerFetch(provider.proxy),
          )
        : null;
    case 's3':
      return provider.endpoint &&
        provider.bucket &&
        provider.accessKeyId &&
        provider.secretAccessKey
        ? createS3Provider(
            {
              endpoint: provider.endpoint,
              region: provider.region || 'us-east-1',
              bucket: provider.bucket,
              accessKeyId: provider.accessKeyId,
              secretAccessKey: provider.secretAccessKey,
            },
            providerFetch(provider.proxy),
          )
        : null;
    default:
      return null;
  }
};

/** Build providers for every enabled, fully-configured replica. */
const providersFromConfig = async (config: SyncConfig): Promise<StorageProvider[]> => {
  const providers: StorageProvider[] = [];
  for (const entry of config.providers) {
    if (!entry.enabled || !isProviderConfigured(entry)) continue;
    if (entry.kind === 'local-folder') {
      await restoreSyncRoot(entry.localFolder);
    }
    const provider = providerFromConfig(await resolveSecrets(entry));
    if (provider) providers.push(provider);
  }
  return providers;
};

/** Basic reachability + credentials check for one provider. */
export type SyncTestResult =
  | { ok: true }
  | { ok: false; code: 'not-configured' }
  | { ok: false; code: 'failed'; detail: string };

/**
 * Finish a Dropbox connection: exchange the pasted authorization code for a
 * refresh token using the user's own app credentials. Returns the token; the
 * caller stores it (keychain on desktop).
 */
export const completeDropboxConnect = async (
  provider: SyncProviderConfig,
  code: string,
): Promise<string> => {
  const secrets = await resolveSecrets(provider);
  return exchangeDropboxCode(
    { appKey: secrets.appKey, appSecret: secrets.appSecret },
    code,
    providerFetch(secrets.proxy),
  );
};

export const testSyncConnection = async (provider: SyncProviderConfig): Promise<SyncTestResult> => {
  if (provider.kind === 'local-folder' && provider.localFolder) {
    await restoreSyncRoot(provider.localFolder);
  }
  const built = providerFromConfig(await resolveSecrets(provider));
  if (!built) return { ok: false, code: 'not-configured' };
  try {
    await built.ensureDir(['Hamesh']);
    await built.readText('Hamesh/index.json');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Interval for background sync rounds while the app stays open. */
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

/** Fire-and-forget sync when at least one provider is configured. */
const autoSync = async (): Promise<void> => {
  const config = loadSyncConfig();
  if (!config.providers.some((provider) => provider.enabled)) return;
  try {
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

/** Run one sync round across all enabled providers (deduped while running). */
export const runSync = (config: SyncConfig): Promise<SyncReport> => {
  syncInFlight ??= runSyncRound(config).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
};

const runSyncRound = async (config: SyncConfig): Promise<SyncReport> => {
  const providers = await providersFromConfig(config);
  if (providers.length === 0) throw new Error('No sync provider configured.');
  const storage = getActiveStorage();
  const clock = getSyncClock();
  const dataStore = await createDataStore();
  if (!storage || !clock || !dataStore) throw new Error('Storage is not initialized.');

  const deviceId = await getOrCreateDeviceId(dataStore);
  const store = createSqlSyncStore(storage, dataStore);
  const engine = createSyncEngine({ deviceId, clock, store, providers });
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
