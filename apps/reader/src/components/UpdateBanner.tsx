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
    void checkForUpdate().then((result) => {
      if (result.status === 'available') {
        setUpdate({ version: result.version, notes: result.notes });
      }
    });
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <span className="update-summary">
        {t('update.available', { version: update.version })}
        {update.notes ? (
          <span className="update-notes" id="banner-update-notes" role="tooltip">
            <strong>{t('update.notes')}</strong>
            <span className="update-notes-body">{update.notes}</span>
          </span>
        ) : null}
      </span>
      {supportsInAppUpdate() ? (
        <button
          type="button"
          className="reader-action update-install"
          aria-describedby={update.notes ? 'banner-update-notes' : undefined}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void installUpdate(update.version).catch((cause: unknown) => {
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
