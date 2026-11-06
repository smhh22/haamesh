import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { finishStartupRun, markStartup } from '../services/startupTrace';
import {
  checkForUpdate,
  installUpdate,
  supportsInAppUpdate,
  type UpdateInfo,
} from '../services/updater';
import { MarkdownView } from './MarkdownView';

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
    // Defer the launch check. The first seconds after the library renders are
    // the heaviest (WebView warm-up; on Windows, Defender scanning a freshly
    // updated exe), and a slow round-trip to GitHub made launches feel
    // frozen. The manual check in Settings stays immediate.
    const timer = window.setTimeout(() => {
      markStartup('update-check-start');
      void checkForUpdate()
        .then((result) => {
          markStartup('update-check-done', result.status);
          if (result.status === 'available') {
            setUpdate({ version: result.version, notes: result.notes });
          }
        })
        .catch((cause: unknown) => {
          markStartup('update-check-failed', cause instanceof Error ? cause.message : 'unknown');
        })
        .finally(() => {
          // Rewrite the persisted run so the trace includes the deferred check.
          finishStartupRun();
        });
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <div className="update-summary">
        {t('update.available', { version: update.version })}
        {update.notes ? (
          <div className="update-notes" id="banner-update-notes" role="tooltip">
            <strong>{t('update.notes')}</strong>
            {/* Release notes are English upstream copy; keep them LTR. */}
            <MarkdownView source={update.notes} dir="ltr" className="update-notes-body" />
          </div>
        ) : null}
      </div>
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
