import type { BookGroupRecord, BookRecord } from '@hamesh/storage';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../../hooks/useDialogFocus';

interface GroupAddBooksDialogProps {
  open: boolean;
  group: BookGroupRecord | null;
  /** Books that can be filed (everywhere except this group already). */
  candidates: BookRecord[];
  onAdd: (book: BookRecord) => void;
  onClose: () => void;
}

/**
 * Pick books to file into a group (ADR-0025). One click files immediately and
 * keeps the dialog open, so several books can be added in a row; Escape or the
 * backdrop closes.
 */
export const GroupAddBooksDialog = ({
  open,
  group,
  candidates,
  onAdd,
  onClose,
}: GroupAddBooksDialogProps) => {
  if (!open || !group) return null;
  return (
    <GroupAddBooksContent group={group} candidates={candidates} onAdd={onAdd} onClose={onClose} />
  );
};

const GroupAddBooksContent = ({
  group,
  candidates,
  onAdd,
  onClose,
}: Omit<GroupAddBooksDialogProps, 'open' | 'group'> & { group: BookGroupRecord }) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(true, dialogRef);

  useEffect(() => {
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
  }, [onClose]);

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog confirm-dialog group-add-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('library.groupAddTitle', { name: group.name })}
      >
        <div className="panel-header">
          <h2>{t('library.groupAddTitle', { name: group.name })}</h2>
        </div>
        <p className="group-add-hint">{t('library.groupAddHint')}</p>
        {candidates.length === 0 ? (
          <p className="group-empty">{t('library.groupAddEmpty')}</p>
        ) : (
          <ul className="group-add-list">
            {candidates.map((book) => (
              <li key={book.id} className="group-add-row">
                <span className="group-add-title" dir="auto">
                  {book.title}
                </span>
                <button type="button" className="reader-action" onClick={() => onAdd(book)}>
                  {t('library.groupAddOne')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="confirm-actions">
          <button type="button" className="reader-action" onClick={onClose}>
            {t('reader.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
