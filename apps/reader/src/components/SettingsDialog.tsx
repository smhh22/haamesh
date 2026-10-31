import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { checkForUpdate, installUpdate, supportsInAppUpdate } from '../services/updater';
import { type UiTheme, useUiStore } from '../stores/uiStore';
import { ShortcutsList } from './ShortcutsList';
import { SyncSettings } from './SyncSettings';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type SettingsSection = 'general' | 'shortcuts' | 'sync' | 'updates' | 'about';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; labelKey: string }> = [
  { id: 'general', labelKey: 'settings.general' },
  { id: 'shortcuts', labelKey: 'shortcuts.title' },
  { id: 'sync', labelKey: 'sync.title' },
  { id: 'updates', labelKey: 'settings.updates' },
  { id: 'about', labelKey: 'settings.about' },
];

const GeneralSection = () => {
  const { t } = useTranslation();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);

  return (
    <>
      <div className="setting-row">
        <span>{t('settings.theme')}</span>
        <div className="setting-controls">
          {(['system', 'light', 'dark'] as UiTheme[]).map((option) => (
            <button
              key={option}
              type="button"
              className={theme === option ? 'reader-action is-selected' : 'reader-action'}
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
            >
              {t(`settings.themes.${option}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <span>{t('settings.language')}</span>
        <button
          type="button"
          className="reader-action"
          onClick={() => setLocale(locale === 'fa' ? 'en' : 'fa')}
        >
          {locale === 'fa' ? 'English' : 'فارسی'}
        </button>
      </div>
    </>
  );
};

const UpdatesSection = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [pendingUpdate, setPendingUpdate] = useState<{
    version: string;
    notes: string | null;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!supportsInAppUpdate()) return;
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => setVersion(''));
  }, []);

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
      setPendingUpdate({ version: result.version, notes: result.notes });
    }
    setChecking(false);
  };

  // A manual check reports availability first; installing is a second click.
  const installPending = async () => {
    if (!pendingUpdate) return;
    setInstalling(true);
    setUpdateMessage('');
    try {
      await installUpdate(pendingUpdate.version);
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
      setInstalling(false);
    }
  };

  return (
    <>
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
          <span className="update-summary">
            {t('settings.updateAvailable', { version: pendingUpdate.version })}
            {pendingUpdate.notes ? (
              <span className="update-notes" id="settings-update-notes" role="tooltip">
                <strong>{t('update.notes')}</strong>
                <span className="update-notes-body">{pendingUpdate.notes}</span>
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="reader-action is-primary update-install"
            aria-describedby={pendingUpdate.notes ? 'settings-update-notes' : undefined}
            disabled={installing}
            onClick={() => void installPending()}
          >
            {installing ? t('update.installing') : t('update.install')}
          </button>
        </div>
      ) : null}
      {updateMessage ? <p className="hint">{updateMessage}</p> : null}
    </>
  );
};

const AboutSection = () => {
  const { t } = useTranslation();
  return <p className="hint">{t('settings.aboutText')}</p>;
};

/**
 * App-level settings with sidebar navigation (general, sync, updates, about).
 * Reachable from the library header; Esc and the backdrop close it.
 */
export const SettingsDialog = ({ open, onClose }: SettingsDialogProps) => {
  const { t } = useTranslation();
  const [active, setActive] = useState<SettingsSection>('general');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialogRef);

  useEffect(() => {
    if (!open) return;
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

  const title = t(
    SECTIONS.find((section) => section.id === active)?.labelKey ?? 'settings.general',
  );

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

        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t('settings.title')}>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={
                  active === section.id ? 'settings-nav-item is-active' : 'settings-nav-item'
                }
                aria-current={active === section.id || undefined}
                onClick={() => setActive(section.id)}
              >
                {t(section.labelKey)}
              </button>
            ))}
          </nav>

          <section className="settings-content" aria-label={title}>
            {active === 'general' ? <GeneralSection /> : null}
            {active === 'shortcuts' ? <ShortcutsList /> : null}
            {active === 'sync' ? <SyncSettings showHeading={false} /> : null}
            {active === 'updates' ? <UpdatesSection /> : null}
            {active === 'about' ? <AboutSection /> : null}
          </section>
        </div>
      </div>
    </div>
  );
};
