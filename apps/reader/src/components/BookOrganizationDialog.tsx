import type { BookRecord } from '@hamesh/storage';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface BookOrganizationDialogProps {
  book: BookRecord | null;
  categories: string[];
  onSave: (organization: { category: string | null; tags: string[] }) => void;
  onClose: () => void;
}

/** Splits on either comma, trims, drops empties, and dedupes case-sensitively. */
export const parseTags = (value: string): string[] => {
  const tags = value
    .split(/[,،]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)];
};

/**
 * Category and tag editor for one book. Categories are free text with
 * suggestions from the library; tags are comma-separated and synced as one
 * field (ADR-0012).
 */
export const BookOrganizationDialog = ({
  book,
  categories,
  onSave,
  onClose,
}: BookOrganizationDialogProps) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [category, setCategory] = useState(book?.category ?? '');
  const [tags, setTags] = useState((book?.tags ?? []).join('، '));
  useDialogFocus(book !== null, dialogRef);

  useEffect(() => {
    setCategory(book?.category ?? '');
    setTags((book?.tags ?? []).join('، '));
  }, [book]);

  useEffect(() => {
    if (!book) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [book, onClose]);

  if (!book) return null;

  const submit = () => {
    const trimmed = category.trim();
    onSave({ category: trimmed.length > 0 ? trimmed : null, tags: parseTags(tags) });
  };

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog book-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('library.details')}
      >
        <div className="panel-header">
          <h2>{t('library.details')}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            {t('reader.close')}
          </button>
        </div>
        <form
          className="settings-content"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="hint book-details-title" dir="auto">
            {book.title}
          </p>
          <div className="setting-row is-field">
            <label htmlFor="book-category">{t('library.category')}</label>
            <input
              className="text-input"
              id="book-category"
              type="text"
              list="book-category-options"
              value={category}
              dir="auto"
              onChange={(event) => setCategory(event.target.value)}
            />
            <datalist id="book-category-options">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="setting-row is-field">
            <label htmlFor="book-tags">{t('library.tags')}</label>
            <input
              className="text-input"
              id="book-tags"
              type="text"
              value={tags}
              dir="auto"
              placeholder={t('library.tagsHint')}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>
          <div className="setting-row">
            <span />
            <div className="setting-controls">
              <button type="button" className="reader-action" onClick={onClose}>
                {t('reader.cancel')}
              </button>
              <button type="submit" className="reader-action is-primary">
                {t('reader.save')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
