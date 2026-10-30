import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { checkForUpdate, installUpdate, supportsInAppUpdate } from '../services/updater';
import { type UiTheme, useUiStore } from '../stores/uiStore';
import { SyncSettings } from './SyncSettings';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenShortcuts: () => void;
}

/**
 * App-level settings: appearance, language, sync, updates, about. Reachable
 * from the library header; Esc and the backdrop close it.
 */
export const SettingsDialog = ({ open, onClose, onOpenShortcuts }: SettingsDialogProps) => {
  const { t } = useTranslation();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);
  const [version, setVersion] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [pendingUpdate, setPendingUpdate] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    if (supportsInAppUpdate()) {
      void import('@tauri-apps/api/app')
        .then(({ getVersion }) => getVersion())
        .then(setVersion)
        .catch(() => setVersion(''));
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // The backdrop is presentational; clicks outside the dialog close it.
    const onPointerDown = (event: PointerEvent) => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const toggleLanguage = () => {
    setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  const checkUpdates = async () => {
    setChecking(true);
    setUpdateMessage('');
    setPendingUpdate(null);
    const result = await checkForUpdate();
    if (result.status === 'error') {
      setUpdateMessage(t('settings.checkFailed'));
    } else if (result.status === 'current') {
      setUpdateMessage(t('settings.upToDate'));
    } else {
      setPendingUpdate(result.version);
    }
    setChecking(false);
  };

  // A manual check reports availability first; installing is a second click.
  const installPending = async () => {
    if (!pendingUpdate) return;
    setInstalling(true);
    setUpdateMessage('');
    try {
      await installUpdate(pendingUpdate);
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
      setInstalling(false);
    }
  };

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
      >
        <div className="panel-header">
          <h2>{t('settings.title')}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            {t('reader.close')}
          </button>
        </div>

        <section className="settings-section">
          <h3>{t('settings.appearance')}</h3>
          <div className="setting-row">
            <span>{t('settings.theme')}</span>
            <div className="setting-controls">
              {(['system', 'light', 'dark'] as UiTheme[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={theme === option ? 'reader-action is-selected' : 'reader-action'}
                  onClick={() => setTheme(option)}
                >
                  {t(`settings.themes.${option}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>{t('settings.language')}</span>
            <button type="button" className="reader-action" onClick={toggleLanguage}>
              {locale === 'fa' ? 'English' : 'فارسی'}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>{t('settings.shortcuts')}</h3>
          <div className="setting-row">
            <span>{t('shortcuts.title')}</span>
            <button type="button" className="reader-action" onClick={onOpenShortcuts}>
              {t('settings.show')}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <SyncSettings />
        </section>

        <section className="settings-section">
          <h3>{t('settings.updates')}</h3>
          <div className="setting-row">
            <span>
              {t('settings.version')} {version || '—'}
            </span>
            <button
              type="button"
              className="reader-action"
              disabled={checking || !supportsInAppUpdate()}
              onClick={() => void checkUpdates()}
            >
              {checking ? t('sync.working') : t('settings.checkUpdates')}
            </button>
          </div>
          {pendingUpdate ? (
            <div className="setting-row">
              <span>{t('settings.updateAvailable', { version: pendingUpdate })}</span>
              <button
                type="button"
                className="reader-action is-primary"
                disabled={installing}
                onClick={() => void installPending()}
              >
                {installing ? t('update.installing') : t('update.install')}
              </button>
            </div>
          ) : null}
          {updateMessage ? <p className="hint">{updateMessage}</p> : null}
        </section>

        <section className="settings-section">
          <h3>{t('settings.about')}</h3>
          <p className="hint">{t('settings.aboutText')}</p>
        </section>
      </div>
    </div>
  );
};
