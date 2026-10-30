import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isLocalFolderAvailable, pickSyncFolder } from '../services/localFolderFs';
import {
  loadSyncConfig,
  newProvider,
  runSync,
  type SyncConfig,
  type SyncProviderConfig,
  saveSyncConfig,
  syncStatus,
  testSyncConnection,
} from '../services/syncService';

/** A provider can sync once it has the minimum details its kind needs. */
const isReady = (provider: SyncProviderConfig): boolean =>
  provider.kind === 'webdav' ? Boolean(provider.baseUrl) : Boolean(provider.localFolder);

/**
 * Sync settings with mirroring (ADR-0006): every enabled provider holds a full
 * replica. Passwords live in the OS keychain on desktop.
 */
export const SyncSettings = () => {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<SyncConfig>(loadSyncConfig);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'idle' | 'testing' | 'syncing'>('idle');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(syncStatus().lastSyncAt);

  const commit = (next: SyncConfig) => {
    setConfig(next);
    saveSyncConfig(next);
  };

  const patchProvider = (id: string, patch: Partial<SyncProviderConfig>) => {
    commit({
      providers: config.providers.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider,
      ),
    });
  };

  const removeProvider = (id: string) => {
    commit({ providers: config.providers.filter((provider) => provider.id !== id) });
  };

  const addProvider = (kind: SyncProviderConfig['kind']) => {
    commit({ providers: [...config.providers, newProvider(kind)] });
  };

  const onTest = async (provider: SyncProviderConfig) => {
    setBusy('testing');
    setTestingId(provider.id);
    const result = await testSyncConnection(provider);
    const text = result.ok
      ? t('sync.testOk')
      : result.code === 'not-configured'
        ? t('sync.testNotConfigured')
        : t('sync.testFailed', { detail: result.detail });
    setTestResults((current) => ({ ...current, [provider.id]: { ok: result.ok, text } }));
    setBusy('idle');
    setTestingId(null);
  };

  const onSync = async () => {
    setBusy('syncing');
    setMessage('');
    try {
      const report = await runSync(config);
      const failed = report.providers.filter((item) => !item.ok);
      setMessage(
        failed.length > 0
          ? `${t('sync.failed')}: ${failed.map((item) => item.error ?? item.providerId).join(', ')}`
          : t('sync.report', {
              pulled: report.providers.reduce((sum, item) => sum + item.pulledRecords, 0),
              uploaded: report.providers.reduce((sum, item) => sum + item.uploadedBlobs, 0),
              downloaded: report.providers.reduce((sum, item) => sum + item.downloadedBlobs, 0),
            }),
      );
      setLastSyncAt(Date.now());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setBusy('idle');
  };

  const readyProviders = config.providers.filter(
    (provider) => provider.enabled && isReady(provider),
  );
  const lastSyncText = lastSyncAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(lastSyncAt))
    : t('sync.never');

  return (
    <section className="sync-settings" aria-label={t('sync.title')}>
      <div className="settings-section-heading">
        <h2>{t('sync.title')}</h2>
        <p className="hint">{t('sync.lede')}</p>
      </div>

      {config.providers.length === 0 ? (
        <div className="sync-empty">
          <p className="sync-empty-title">{t('sync.emptyTitle')}</p>
          <p className="hint">{t('sync.emptyBody')}</p>
          <div className="sync-add">
            <button
              type="button"
              className="reader-action is-primary"
              onClick={() => addProvider('webdav')}
            >
              {t('sync.addWebdav')}
            </button>
            {isLocalFolderAvailable() ? (
              <button
                type="button"
                className="reader-action"
                onClick={() => addProvider('local-folder')}
              >
                {t('sync.addLocalFolder')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {config.providers.map((provider) => {
        const ready = isReady(provider);
        const status = !provider.enabled
          ? { key: 'off', label: t('sync.statusOff') }
          : ready
            ? { key: 'ready', label: t('sync.statusReady') }
            : { key: 'setup', label: t('sync.statusNeedsSetup') };
        const testResult = testResults[provider.id];
        return (
          <div key={provider.id} className="sync-provider-card">
            <div className="sync-card-header">
              <label htmlFor={`sync-enabled-${provider.id}`} className="sync-enabled">
                <input
                  id={`sync-enabled-${provider.id}`}
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={(event) =>
                    patchProvider(provider.id, { enabled: event.target.checked })
                  }
                />
                {provider.label}
              </label>
              <span className={`sync-status is-${status.key}`}>{status.label}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => removeProvider(provider.id)}
              >
                {t('sync.remove')}
              </button>
            </div>

            {provider.kind === 'webdav' ? (
              <>
                <div className="setting-row">
                  <label htmlFor={`sync-url-${provider.id}`}>{t('sync.baseUrl')}</label>
                  <input
                    id={`sync-url-${provider.id}`}
                    type="url"
                    value={provider.baseUrl}
                    placeholder="https://cloud.example.com/remote.php/dav/files/user"
                    onChange={(event) =>
                      patchProvider(provider.id, { baseUrl: event.target.value })
                    }
                  />
                </div>
                <p className="hint sync-field-hint">{t('sync.baseUrlHint')}</p>
                <div className="setting-row">
                  <label htmlFor={`sync-user-${provider.id}`}>{t('sync.username')}</label>
                  <input
                    id={`sync-user-${provider.id}`}
                    type="text"
                    value={provider.username}
                    autoComplete="off"
                    onChange={(event) =>
                      patchProvider(provider.id, { username: event.target.value })
                    }
                  />
                </div>
                <div className="setting-row">
                  <label htmlFor={`sync-pass-${provider.id}`}>{t('sync.password')}</label>
                  <input
                    id={`sync-pass-${provider.id}`}
                    type="password"
                    value={provider.password}
                    placeholder={provider.hasPassword ? t('sync.passwordSaved') : undefined}
                    autoComplete="off"
                    onChange={(event) =>
                      patchProvider(provider.id, { password: event.target.value })
                    }
                  />
                </div>
                <div className="setting-row">
                  <label htmlFor={`sync-proxy-${provider.id}`}>{t('sync.proxy')}</label>
                  <input
                    id={`sync-proxy-${provider.id}`}
                    type="text"
                    value={provider.proxy}
                    placeholder="socks5h://127.0.0.1:2080"
                    autoComplete="off"
                    onChange={(event) => patchProvider(provider.id, { proxy: event.target.value })}
                  />
                </div>
                <p className="hint sync-field-hint">{t('sync.proxyHint')}</p>
              </>
            ) : null}

            {provider.kind === 'local-folder' ? (
              <>
                <div className="setting-row">
                  <span>{t('sync.folder')}</span>
                  <span className="hint" dir="ltr">
                    {provider.localFolder || t('sync.noFolder')}
                  </span>
                  <button
                    type="button"
                    className="reader-action"
                    onClick={() => {
                      void pickSyncFolder().then((path) => {
                        if (path) patchProvider(provider.id, { localFolder: path });
                      });
                    }}
                  >
                    {t('sync.chooseFolder')}
                  </button>
                </div>
                <p className="hint sync-field-hint">{t('sync.folderHint')}</p>
              </>
            ) : null}

            {testResult ? (
              <p
                className={`sync-test-result ${testResult.ok ? 'is-ok' : 'is-error'}`}
                role="status"
              >
                {testResult.text}
              </p>
            ) : null}

            <div className="setting-row">
              <button
                type="button"
                className="reader-action"
                disabled={busy !== 'idle'}
                onClick={() => void onTest(provider)}
              >
                {testingId === provider.id ? t('sync.working') : t('sync.test')}
              </button>
            </div>
          </div>
        );
      })}

      {config.providers.length > 0 ? (
        <div className="setting-row sync-add">
          <button type="button" className="reader-action" onClick={() => addProvider('webdav')}>
            {t('sync.addWebdav')}
          </button>
          {isLocalFolderAvailable() ? (
            <button
              type="button"
              className="reader-action"
              onClick={() => addProvider('local-folder')}
            >
              {t('sync.addLocalFolder')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="sync-actions">
        <button
          type="button"
          className="reader-action is-primary"
          disabled={busy !== 'idle' || readyProviders.length === 0}
          onClick={onSync}
        >
          {busy === 'syncing' ? t('sync.working') : t('sync.syncNow')}
        </button>
        <span className="hint">
          {t('sync.lastSync')}: {lastSyncText}
        </span>
      </div>
      {config.providers.length > 0 && readyProviders.length === 0 ? (
        <p className="hint">{t('sync.noReady')}</p>
      ) : null}
      {message ? <p className="hint">{message}</p> : null}
    </section>
  );
};
