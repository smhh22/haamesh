import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkForUpdate,
  installUpdate,
  supportsInAppUpdate,
  type UpdateInfo,
} from '../services/updater';

/**
 * Update banner: silent check on launch, one-click install for AppImage and
 * Windows. deb/rpm installs link to the release page instead.
 */
export const UpdateBanner = () => {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supportsInAppUpdate()) return;
    void checkForUpdate().then(setUpdate);
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <span>
        {t('update.available', { version: update.version })}
        {!supportsInAppUpdate() ? ` — ${t('update.downloadManually')}` : ''}
      </span>
      {supportsInAppUpdate() ? (
        <button
          type="button"
          className="reader-action"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void installUpdate().catch((cause: unknown) => {
              setBusy(false);
              setError(cause instanceof Error ? cause.message : String(cause));
            });
          }}
        >
          {busy ? t('update.installing') : t('update.install')}
        </button>
      ) : null}
      <button type="button" className="text-button" onClick={() => setDismissed(true)}>
        {t('update.later')}
      </button>
      {error ? <span className="hint">{error}</span> : null}
    </div>
  );
};
