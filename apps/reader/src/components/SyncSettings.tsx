import { dropboxAuthorizeUrl } from '@hamesh/sync';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isLocalFolderAvailable, pickSyncFolder } from '../services/localFolderFs';
import {
  completeDropboxConnect,
  isProviderConfigured,
  loadSyncConfig,
  newProvider,
  runSync,
  type SyncConfig,
  type SyncProviderConfig,
  saveSyncConfig,
  syncStatus,
  testSyncConnection,
} from '../services/syncService';

interface SyncSettingsProps {
  /** The settings dialog renders its own section title; hide ours there. */
  showHeading?: boolean;
}

/**
 * Sync settings with mirroring (ADR-0006): every enabled provider holds a full
 * replica. Passwords live in the OS keychain on desktop.
 */
export const SyncSettings = ({ showHeading = true }: SyncSettingsProps) => {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<SyncConfig>(loadSyncConfig);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'idle' | 'testing' | 'syncing'>('idle');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [dropboxCode, setDropboxCode] = useState<Record<string, string>>({});
  const [connectingId, setConnectingId] = useState<string | null>(null);
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

  const onDropboxConnect = async (provider: SyncProviderConfig) => {
    const code = (dropboxCode[provider.id] ?? '').trim();
    if (!code) return;
    setBusy('testing');
    setConnectingId(provider.id);
    try {
      const refreshToken = await completeDropboxConnect(provider, code);
      patchProvider(provider.id, { refreshToken, hasRefreshToken: true });
      setDropboxCode((current) => ({ ...current, [provider.id]: '' }));
      setTestResults((current) => ({
        ...current,
        [provider.id]: { ok: true, text: t('sync.dropboxConnected') },
      }));
    } catch {
      setTestResults((current) => ({
        ...current,
        [provider.id]: { ok: false, text: t('sync.dropboxConnectFailed') },
      }));
    }
    setBusy('idle');
    setConnectingId(null);
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
    (provider) => provider.enabled && isProviderConfigured(provider),
  );
  const lastSyncText = lastSyncAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(lastSyncAt))
    : t('sync.never');

  return (
    <section className="sync-settings" aria-label={t('sync.title')}>
      {showHeading ? (
        <div className="settings-section-heading">
          <h3>{t('sync.title')}</h3>
          <p className="hint">{t('sync.lede')}</p>
        </div>
      ) : (
        <p className="hint sync-lede">{t('sync.lede')}</p>
      )}

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
            <button type="button" className="reader-action" onClick={() => addProvider('s3')}>
              {t('sync.addS3')}
            </button>
            <button type="button" className="reader-action" onClick={() => addProvider('dropbox')}>
              {t('sync.addDropbox')}
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
        const ready = isProviderConfigured(provider);
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
                {provider.kind === 'local-folder' ? t('sync.providerLocalFolder') : provider.label}
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
                <div className="setting-row is-field">
                  <label htmlFor={`sync-url-${provider.id}`}>{t('sync.baseUrl')}</label>
                  <input
                    className="text-input"
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
                <div className="setting-row is-field">
                  <label htmlFor={`sync-user-${provider.id}`}>{t('sync.username')}</label>
                  <input
                    className="text-input"
                    id={`sync-user-${provider.id}`}
                    type="text"
                    value={provider.username}
                    autoComplete="off"
                    onChange={(event) =>
                      patchProvider(provider.id, { username: event.target.value })
                    }
                  />
                </div>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-pass-${provider.id}`}>{t('sync.password')}</label>
                  <input
                    className="text-input"
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
                <div className="setting-row is-field">
                  <label htmlFor={`sync-proxy-${provider.id}`}>{t('sync.proxy')}</label>
                  <input
                    className="text-input"
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

            {provider.kind === 's3' ? (
              <>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-s3-endpoint-${provider.id}`}>{t('sync.s3Endpoint')}</label>
                  <input
                    className="text-input"
                    id={`sync-s3-endpoint-${provider.id}`}
                    type="url"
                    value={provider.endpoint}
                    placeholder="https://s3.example.com"
                    onChange={(event) =>
                      patchProvider(provider.id, { endpoint: event.target.value })
                    }
                  />
                </div>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-s3-region-${provider.id}`}>{t('sync.s3Region')}</label>
                  <input
                    className="text-input"
                    id={`sync-s3-region-${provider.id}`}
                    type="text"
                    value={provider.region}
                    placeholder="us-east-1"
                    autoComplete="off"
                    onChange={(event) => patchProvider(provider.id, { region: event.target.value })}
                  />
                </div>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-s3-bucket-${provider.id}`}>{t('sync.s3Bucket')}</label>
                  <input
                    className="text-input"
                    id={`sync-s3-bucket-${provider.id}`}
                    type="text"
                    value={provider.bucket}
                    autoComplete="off"
                    onChange={(event) => patchProvider(provider.id, { bucket: event.target.value })}
                  />
                </div>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-s3-access-${provider.id}`}>{t('sync.s3AccessKey')}</label>
                  <input
                    className="text-input"
                    id={`sync-s3-access-${provider.id}`}
                    type="text"
                    value={provider.accessKeyId}
                    autoComplete="off"
                    onChange={(event) =>
                      patchProvider(provider.id, { accessKeyId: event.target.value })
                    }
                  />
                </div>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-s3-secret-${provider.id}`}>{t('sync.s3SecretKey')}</label>
                  <input
                    className="text-input"
                    id={`sync-s3-secret-${provider.id}`}
                    type="password"
                    value={provider.secretAccessKey}
                    placeholder={provider.hasSecretKey ? t('sync.passwordSaved') : undefined}
                    autoComplete="off"
                    onChange={(event) =>
                      patchProvider(provider.id, { secretAccessKey: event.target.value })
                    }
                  />
                </div>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-s3-proxy-${provider.id}`}>{t('sync.proxy')}</label>
                  <input
                    className="text-input"
                    id={`sync-s3-proxy-${provider.id}`}
                    type="text"
                    value={provider.proxy}
                    placeholder="socks5h://127.0.0.1:2080"
                    autoComplete="off"
                    onChange={(event) => patchProvider(provider.id, { proxy: event.target.value })}
                  />
                </div>
                <p className="hint sync-field-hint">{t('sync.s3Hint')}</p>
              </>
            ) : null}

            {provider.kind === 'dropbox' ? (
              <>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-dropbox-key-${provider.id}`}>
                    {t('sync.dropboxAppKey')}
                  </label>
                  <input
                    className="text-input"
                    id={`sync-dropbox-key-${provider.id}`}
                    type="text"
                    value={provider.appKey}
                    autoComplete="off"
                    onChange={(event) => patchProvider(provider.id, { appKey: event.target.value })}
                  />
                </div>
                <div className="setting-row is-field">
                  <label htmlFor={`sync-dropbox-secret-${provider.id}`}>
                    {t('sync.dropboxAppSecret')}
                  </label>
                  <input
                    className="text-input"
                    id={`sync-dropbox-secret-${provider.id}`}
                    type="password"
                    value={provider.appSecret}
                    placeholder={provider.hasAppSecret ? t('sync.passwordSaved') : undefined}
                    autoComplete="off"
                    onChange={(event) =>
                      patchProvider(provider.id, { appSecret: event.target.value })
                    }
                  />
                </div>
                <p className="hint sync-field-hint">{t('sync.dropboxHint')}</p>
                {provider.appKey ? (
                  <div className="setting-row">
                    <span>{t('sync.dropboxAuthorize')}</span>
                    <a
                      className="reader-action"
                      href={dropboxAuthorizeUrl(provider.appKey)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('sync.dropboxOpenLink')}
                    </a>
                  </div>
                ) : null}
                <div className="setting-row is-field">
                  <label htmlFor={`sync-dropbox-code-${provider.id}`}>
                    {t('sync.dropboxCode')}
                  </label>
                  <input
                    className="text-input"
                    id={`sync-dropbox-code-${provider.id}`}
                    type="text"
                    value={dropboxCode[provider.id] ?? ''}
                    autoComplete="off"
                    onChange={(event) =>
                      setDropboxCode((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                  />
                </div>
                <p className="hint sync-field-hint">{t('sync.dropboxCodeHint')}</p>
                <div className="sync-card-footer">
                  <button
                    type="button"
                    className="reader-action is-primary"
                    disabled={
                      busy !== 'idle' ||
                      !provider.appKey ||
                      !provider.appSecret ||
                      !(dropboxCode[provider.id] ?? '').trim()
                    }
                    onClick={() => void onDropboxConnect(provider)}
                  >
                    {connectingId === provider.id
                      ? t('sync.dropboxConnecting')
                      : t('sync.dropboxConnect')}
                  </button>
                </div>
                {provider.hasRefreshToken ? (
                  <p className="sync-test-result is-ok" role="status">
                    {t('sync.dropboxConnected')}
                  </p>
                ) : null}
              </>
            ) : null}

            {provider.kind === 'local-folder' ? (
              <>
                <div className="setting-row">
                  <span>{t('sync.folder')}</span>
                  <div className="setting-controls">
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

            <div className="sync-card-footer">
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
          <button type="button" className="reader-action" onClick={() => addProvider('s3')}>
            {t('sync.addS3')}
          </button>
          <button type="button" className="reader-action" onClick={() => addProvider('dropbox')}>
            {t('sync.addDropbox')}
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
