import { type Direction, sanitizeCategoryName } from '@hamesh/core';
import type { BookRecord } from '@hamesh/storage';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';

export interface BookOrganization {
  title: string;
  authors: string[];
  series: string | null;
  publisher: string | null;
  category: string | null;
  tags: string[];
  language: string | null;
  direction: Direction;
}

interface BookOrganizationDialogProps {
  book: BookRecord | null;
  categories: string[];
  onSave: (organization: BookOrganization) => void;
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

/** Common language tags for the suggestions list; any BCP 47 tag is accepted. */
const LANGUAGE_SUGGESTIONS = [
  'fa',
  'en',
  'ar',
  'he',
  'ur',
  'tr',
  'fr',
  'de',
  'ru',
  'zh',
  'ja',
  'ko',
];

/** Sentinel select value for typing a category that does not exist yet. */
const NEW_CATEGORY = '__new__';

/**
 * Category and tag editor for one book. The category is a dropdown over the
 * library's categories (plus a New… entry that reveals a name field), so a
 * book never needs its category retyped; tags are comma-separated and synced
 * as one field (ADR-0013).
 *
 * The body mounts per book (keyed by id) and initializes its fields once.
 * A store update that replaces the book object — a sync reload, for example —
 * no longer resets what the user is typing.
 */
export const BookOrganizationDialog = ({ book, ...props }: BookOrganizationDialogProps) => {
  if (!book) return null;
  return <BookOrganizationDialogContent key={book.id} book={book} {...props} />;
};

type BookOrganizationDialogContentProps = Omit<BookOrganizationDialogProps, 'book'> & {
  book: BookRecord;
};

const BookOrganizationDialogContent = ({
  book,
  categories,
  onSave,
  onClose,
}: BookOrganizationDialogContentProps) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [category, setCategory] = useState(
    book.category === null ? '' : categories.includes(book.category) ? book.category : NEW_CATEGORY,
  );
  const [customCategory, setCustomCategory] = useState(
    book.category !== null && !categories.includes(book.category) ? book.category : '',
  );
  const [title, setTitle] = useState(book.title);
  const [authors, setAuthors] = useState((book.authors ?? []).join('، '));
  const [series, setSeries] = useState(book.series ?? '');
  const [publisher, setPublisher] = useState(book.publisher ?? '');
  const [tags, setTags] = useState((book.tags ?? []).join('، '));
  const [language, setLanguage] = useState(book.language ?? '');
  const [direction, setDirection] = useState<Direction>(book.direction);
  const onCloseRef = useRef(onClose);
  useDialogFocus(true, dialogRef);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = () => {
    const chosen = category === NEW_CATEGORY ? customCategory : category;
    const trimmed = chosen.trim();
    const trimmedLanguage = language.trim();
    const trimmedTitle = title.trim();
    const trimmedSeries = series.trim();
    const trimmedPublisher = publisher.trim();
    onSave({
      // A book must keep a name; an emptied field keeps the previous title.
      title: trimmedTitle.length > 0 ? trimmedTitle : book.title,
      authors: parseTags(authors),
      series: trimmedSeries.length > 0 ? trimmedSeries : null,
      publisher: trimmedPublisher.length > 0 ? trimmedPublisher : null,
      category: trimmed.length > 0 ? trimmed : null,
      tags: parseTags(tags),
      language: trimmedLanguage.length > 0 ? trimmedLanguage : null,
      direction,
    });
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
          <div className="setting-row is-field">
            <label htmlFor="book-title">{t('library.bookTitle')}</label>
            <input
              className="text-input"
              id="book-title"
              type="text"
              value={title}
              dir="auto"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="setting-row is-field">
            <label htmlFor="book-authors">{t('library.bookAuthors')}</label>
            <input
              className="text-input"
              id="book-authors"
              type="text"
              value={authors}
              dir="auto"
              placeholder={t('library.authorsHint')}
              onChange={(event) => setAuthors(event.target.value)}
            />
          </div>
          <div className="setting-row is-field">
            <label htmlFor="book-series">{t('library.bookSeries')}</label>
            <input
              className="text-input"
              id="book-series"
              type="text"
              value={series}
              dir="auto"
              onChange={(event) => setSeries(event.target.value)}
            />
          </div>
          <div className="setting-row is-field">
            <label htmlFor="book-publisher">{t('library.bookPublisher')}</label>
            <input
              className="text-input"
              id="book-publisher"
              type="text"
              value={publisher}
              dir="auto"
              onChange={(event) => setPublisher(event.target.value)}
            />
          </div>
          <div className="setting-row is-field">
            <label htmlFor="book-category">{t('library.category')}</label>
            <select
              className="sort-select"
              id="book-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">{t('library.uncategorized')}</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={NEW_CATEGORY}>{t('library.newCategoryOption')}</option>
            </select>
          </div>
          {category === NEW_CATEGORY ? (
            <div className="setting-row is-field">
              <label htmlFor="book-category-new">{t('library.newCategoryName')}</label>
              <input
                className="text-input"
                id="book-category-new"
                type="text"
                value={customCategory}
                dir="auto"
                onChange={(event) => setCustomCategory(sanitizeCategoryName(event.target.value))}
              />
            </div>
          ) : null}
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
          <div className="setting-row is-field">
            <label htmlFor="book-language">{t('library.language')}</label>
            <input
              className="text-input"
              id="book-language"
              type="text"
              list="book-language-options"
              value={language}
              dir="auto"
              placeholder={t('library.languageHint')}
              onChange={(event) => setLanguage(event.target.value)}
            />
            <datalist id="book-language-options">
              {LANGUAGE_SUGGESTIONS.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </div>
          <div className="setting-row is-field">
            <label htmlFor="book-direction">{t('library.direction')}</label>
            <select
              className="sort-select"
              id="book-direction"
              value={direction}
              onChange={(event) => setDirection(event.target.value === 'rtl' ? 'rtl' : 'ltr')}
            >
              <option value="ltr">{t('library.directionLtr')}</option>
              <option value="rtl">{t('library.directionRtl')}</option>
            </select>
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
