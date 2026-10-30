import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isLocalFolderAvailable, pickSyncFolder } from '../services/localFolderFs';
import {
  loadSyncConfig,
  runSync,
  type SyncConfig,
  saveSyncConfig,
  syncStatus,
  testSyncConnection,
} from '../services/syncService';

/**
 * Library-side sync settings (ADR-0006, Phase 3): one provider, manual sync.
 * Credentials live in localStorage for now; the desktop build moves them to
 * the OS keychain when the KeychainPort adapter lands.
 */
export const SyncSettings = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SyncConfig>(loadSyncConfig);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'idle' | 'testing' | 'syncing'>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(syncStatus().lastSyncAt);

  const update = (patch: Partial<SyncConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveSyncConfig(next);
  };

  const onTest = async () => {
    setBusy('testing');
    setMessage('');
    const result = await testSyncConnection(config);
    setMessage(result.message);
    setBusy('idle');
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

  return (
    <section className="sync-settings" aria-label={t('sync.title')}>
      <h2>{t('sync.title')}</h2>
      <div className="setting-row">
        <label htmlFor="sync-provider">{t('sync.provider')}</label>
        <select
          id="sync-provider"
          value={config.provider}
          onChange={(event) => update({ provider: event.target.value as SyncConfig['provider'] })}
        >
          <option value="none">{t('sync.providerNone')}</option>
          <option value="webdav">{t('sync.providerWebdav')}</option>
          {isLocalFolderAvailable() ? (
            <option value="local-folder">{t('sync.providerLocalFolder')}</option>
          ) : null}
        </select>
      </div>
      {config.provider === 'local-folder' ? (
        <div className="setting-row">
          <span>{t('sync.folder')}</span>
          <span className="hint" dir="ltr">
            {config.localFolder || t('sync.noFolder')}
          </span>
          <button
            type="button"
            className="reader-action"
            onClick={() => {
              void pickSyncFolder().then((path) => {
                if (path) update({ localFolder: path });
              });
            }}
          >
            {t('sync.chooseFolder')}
          </button>
        </div>
      ) : null}
      {config.provider === 'webdav' ? (
        <>
          <div className="setting-row">
            <label htmlFor="sync-url">{t('sync.baseUrl')}</label>
            <input
              id="sync-url"
              type="url"
              value={config.baseUrl}
              placeholder="https://cloud.example.com/remote.php/dav/files/user"
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </div>
          <div className="setting-row">
            <label htmlFor="sync-user">{t('sync.username')}</label>
            <input
              id="sync-user"
              type="text"
              value={config.username}
              autoComplete="off"
              onChange={(event) => update({ username: event.target.value })}
            />
          </div>
          <div className="setting-row">
            <label htmlFor="sync-pass">{t('sync.password')}</label>
            <input
              id="sync-pass"
              type="password"
              value={config.password}
              placeholder={config.hasPassword ? t('sync.passwordSaved') : undefined}
              autoComplete="off"
              onChange={(event) => update({ password: event.target.value })}
            />
          </div>
        </>
      ) : null}
      <div className="setting-row">
        <button type="button" className="reader-action" disabled={busy !== 'idle'} onClick={onTest}>
          {t('sync.test')}
        </button>
        <button
          type="button"
          className="reader-action"
          disabled={busy !== 'idle' || config.provider === 'none'}
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
