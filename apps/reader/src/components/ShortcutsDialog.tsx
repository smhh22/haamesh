import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { ShortcutsList } from './ShortcutsList';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Keyboard shortcut overlay, opened with `?`. Esc and a click outside close
 * it; the settings dialog also renders the same list as its own section.
 */
export const ShortcutsDialog = ({ open, onClose }: ShortcutsDialogProps) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialogRef);

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

        <div className="shortcuts-dialog-body">
          <ShortcutsList />
        </div>
      </div>
    </div>
  );
};
