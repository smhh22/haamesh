import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';

export interface TagSummary {
  name: string;
  count: number;
}

interface TagsDialogProps {
  open: boolean;
  tags: TagSummary[];
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
  onClose: () => void;
}

/**
 * Manage every tag in the library: rename one across all books, or remove it
 * everywhere. Edits happen inline; the destructive action asks first. Tags are
 * denormalized on books (ADR-0013), so both operations rewrite the affected
 * books and persist their category/tag clocks.
 */
export const TagsDialog = ({ open, tags, onRename, onDelete, onClose }: TagsDialogProps) => {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  useDialogFocus(open, dialogRef);
  const numberFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US');

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setDeleting(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (editing) setEditing(null);
      else if (deleting) setDeleting(null);
      else onClose();
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
  }, [open, editing, deleting, onClose]);

  if (!open) return null;

  const submitRename = (from: string) => {
    const name = draft.trim();
    setEditing(null);
    if (name && name !== from) onRename(from, name);
  };

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog confirm-dialog tags-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('library.manageTags')}
      >
        <div className="panel-header">
          <h2>{t('library.manageTags')}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            {t('reader.close')}
          </button>
        </div>
        <div className="confirm-body">
          {tags.length === 0 ? <p className="hint">{t('library.noTags')}</p> : null}
          <ul className="tag-manage-list">
            {tags.map((tag) => (
              <li key={tag.name} className="tag-manage-row">
                {editing === tag.name ? (
                  <>
                    <input
                      className="text-input"
                      type="text"
                      dir="auto"
                      value={draft}
                      aria-label={t('library.tagName')}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submitRename(tag.name);
                      }}
                    />
                    <div className="tag-manage-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setEditing(null)}
                      >
                        {t('reader.cancel')}
                      </button>
                      <button
                        type="button"
                        className="reader-action is-primary"
                        disabled={draft.trim().length === 0}
                        onClick={() => submitRename(tag.name)}
                      >
                        {t('reader.save')}
                      </button>
                    </div>
                  </>
                ) : deleting === tag.name ? (
                  <>
                    <span className="tag-manage-name">
                      {t('library.deleteTagQuestion', { name: tag.name })}
                    </span>
                    <div className="tag-manage-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setDeleting(null)}
                      >
                        {t('reader.cancel')}
                      </button>
                      <button
                        type="button"
                        className="reader-action is-danger"
                        onClick={() => {
                          onDelete(tag.name);
                          setDeleting(null);
                        }}
                      >
                        {t('library.removeConfirm')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="tag-chip" dir="auto">
                      #{tag.name}
                    </span>
                    <span className="hint tag-manage-count">
                      {t('library.tagUsedIn', { count: numberFormat.format(tag.count) })}
                    </span>
                    <div className="tag-manage-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setDraft(tag.name);
                          setEditing(tag.name);
                          setDeleting(null);
                        }}
                      >
                        {t('library.renameTag')}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setDeleting(tag.name);
                          setEditing(null);
                        }}
                      >
                        {t('library.deleteTag')}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
