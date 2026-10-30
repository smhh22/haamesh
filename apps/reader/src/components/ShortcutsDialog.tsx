import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const ShortcutRow = ({ keys, label }: { keys: string[]; label: string }) => (
  <div className="shortcut-row">
    <dt>
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </dt>
    <dd>{label}</dd>
  </div>
);

/**
 * Keyboard shortcut map, opened with `?` or from the settings dialog. Esc and
 * a click outside close it.
 */
export const ShortcutsDialog = ({ open, onClose }: ShortcutsDialogProps) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
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

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
      >
        <div className="panel-header">
          <h2>{t('shortcuts.title')}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            {t('reader.close')}
          </button>
        </div>

        <section className="settings-section">
          <h3>{t('shortcuts.library')}</h3>
          <dl className="shortcut-list">
            <ShortcutRow keys={['/']} label={t('shortcuts.search')} />
            <ShortcutRow keys={['?']} label={t('shortcuts.help')} />
            <ShortcutRow keys={['Esc']} label={t('shortcuts.escapeLibrary')} />
          </dl>
        </section>

        <section className="settings-section">
          <h3>{t('shortcuts.reader')}</h3>
          <dl className="shortcut-list">
            <ShortcutRow keys={['←', '→']} label={t('shortcuts.pageTurn')} />
            <ShortcutRow keys={['Space']} label={t('shortcuts.pageNext')} />
            <ShortcutRow keys={['Shift + Space']} label={t('shortcuts.pagePrev')} />
            <ShortcutRow keys={['+', '−']} label={t('shortcuts.zoom')} />
            <ShortcutRow keys={['Esc']} label={t('shortcuts.escapeReader')} />
            <ShortcutRow keys={['?']} label={t('shortcuts.help')} />
          </dl>
        </section>
      </div>
    </div>
  );
};
