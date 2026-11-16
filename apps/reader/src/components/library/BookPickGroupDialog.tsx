import type { BookGroupRecord, BookRecord } from '@hamesh/storage';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { flattenGroups } from '../../library/groups';

interface BookPickGroupDialogProps {
  open: boolean;
  book: BookRecord | null;
  groups: BookGroupRecord[];
  /** File the book into the picked group (ADR-0025). */
  onPick: (group: BookGroupRecord) => void;
  onClose: () => void;
}

/**
 * "Add to group…" from a book's menu: pick the shelf. The book's current
 * group is marked; picking another moves it (one group per book).
 */
export const BookPickGroupDialog = ({
  open,
  book,
  groups,
  onPick,
  onClose,
}: BookPickGroupDialogProps) => {
  if (!open || !book) return null;
  return <BookPickGroupContent book={book} groups={groups} onPick={onPick} onClose={onClose} />;
};

const BookPickGroupContent = ({
  book,
  groups,
  onPick,
  onClose,
}: Omit<BookPickGroupDialogProps, 'open' | 'book'> & { book: BookRecord }) => {
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
        aria-label={t('library.groupPickTitle', { title: book.title })}
      >
        <div className="panel-header">
          <h2>{t('library.groupPickTitle', { title: book.title })}</h2>
        </div>
        {groups.length === 0 ? (
          <p className="group-empty">{t('library.groupPickEmpty')}</p>
        ) : (
          <ul className="group-add-list">
            {flattenGroups(groups).map(({ group, depth }) => (
              <li
                key={group.id}
                className="group-add-row"
                style={
                  depth > 0
                    ? { paddingInlineStart: `calc(${depth} * var(--hamesh-space-4))` }
                    : undefined
                }
              >
                <span className="group-add-title" dir="auto">
                  {group.name}
                  {book.groupId === group.id ? (
                    <span className="group-add-current"> · {t('library.groupCurrent')}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="reader-action"
                  disabled={book.groupId === group.id}
                  onClick={() => {
                    onPick(group);
                    onClose();
                  }}
                >
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
