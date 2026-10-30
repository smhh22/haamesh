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

/**
 * Sync settings with mirroring (ADR-0006): every enabled provider holds a full
 * replica. Passwords live in the OS keychain on desktop.
 */
export const SyncSettings = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SyncConfig>(loadSyncConfig);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'idle' | 'testing' | 'syncing'>('idle');
  const [testingId, setTestingId] = useState<string | null>(null);
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
    setMessage('');
    const result = await testSyncConnection(provider);
    setMessage(`${provider.label}: ${result.message}`);
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

  const hasEnabled = config.providers.some((provider) => provider.enabled);

  return (
    <section className="sync-settings" aria-label={t('sync.title')}>
      <h2>{t('sync.title')}</h2>

      {config.providers.map((provider) => (
        <div key={provider.id} className="sync-provider-card">
          <div className="setting-row">
            <label htmlFor={`sync-enabled-${provider.id}`} className="sync-enabled">
              <input
                id={`sync-enabled-${provider.id}`}
                type="checkbox"
                checked={provider.enabled}
                onChange={(event) => patchProvider(provider.id, { enabled: event.target.checked })}
              />
              {provider.label}
            </label>
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
                  onChange={(event) => patchProvider(provider.id, { baseUrl: event.target.value })}
                />
              </div>
              <div className="setting-row">
                <label htmlFor={`sync-user-${provider.id}`}>{t('sync.username')}</label>
                <input
                  id={`sync-user-${provider.id}`}
                  type="text"
                  value={provider.username}
                  autoComplete="off"
                  onChange={(event) => patchProvider(provider.id, { username: event.target.value })}
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
                  onChange={(event) => patchProvider(provider.id, { password: event.target.value })}
                />
              </div>
            </>
          ) : null}

          {provider.kind === 'local-folder' ? (
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
      ))}

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

      <div className="setting-row">
        <button
          type="button"
          className="reader-action"
          disabled={busy !== 'idle' || !hasEnabled}
          onClick={onSync}
        >
          {busy === 'syncing' ? t('sync.working') : t('sync.syncNow')}
        </button>
      </div>

      <p className="hint">
        {lastSyncAt
          ? `${t('sync.lastSync')}: ${new Date(lastSyncAt).toLocaleString()}`
          : t('sync.never')}
      </p>
      {message ? <p className="hint">{message}</p> : null}
    </section>
  );
};
