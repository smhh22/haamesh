import type { BookRecord } from '@hamesh/storage';
import { useTranslation } from 'react-i18next';
import type { UiLocale } from '../../stores/uiStore';
import { BookActionsMenu } from './BookActionsMenu';
import { BookCover, FORMAT_LABEL } from './BookCover';

interface BookRowProps {
  book: BookRecord;
  locale: UiLocale;
  fraction: number;
  hasFile: boolean;
  opening: boolean;
  downloading: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDownload: () => void;
}

const formatAuthors = (authors: string[], locale: UiLocale): string => {
  if (authors.length === 0) return '';
  try {
    return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(authors);
  } catch {
    return authors.join(locale === 'fa' ? '، ' : ', ');
  }
};

/**
 * One catalog row (list view): thumbnail, title and metadata, reading
 * progress, added date, then the primary action and an overflow menu. The
 * whole row is not a button on purpose — the primary action stays explicit and
 * keyboard reachable.
 */
export const BookRow = ({
  book,
  locale,
  fraction,
  hasFile,
  opening,
  downloading,
  onOpen,
  onEdit,
  onRemove,
  onDownload,
}: BookRowProps) => {
  const { t } = useTranslation();
  const percentFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const dateFormat = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    day: 'numeric',
    month: 'short',
  });

  const authors = formatAuthors(book.authors, locale) || t('library.unknownAuthor');
  const percent = Math.round(fraction * 100);
  const primaryLabel = opening
    ? hasFile
      ? t('library.opening')
      : t('library.downloading')
    : book.format === 'audio'
      ? t('library.listen')
      : book.format === 'video'
        ? t('library.watch')
        : t('library.read');

  return (
    <li className="book-card book-row">
      <BookCover book={book} variant="thumb" />

      <div className="book-row-text">
        <h3 className="book-row-title">
          <span dir="auto">{book.title}</span>
        </h3>
        <p className="book-row-meta">
          <span className="book-row-authors" dir="auto">
            {authors}
            {book.series ? ` · ${book.series}` : ''}
          </span>
          <span className="format-chip">{FORMAT_LABEL[book.format]}</span>
        </p>
        {fraction > 0 ? (
          <span className="book-row-progress is-phone">
            <span className="progress-track">
              <span style={{ inlineSize: `${percent}%` }} />
            </span>
            <span className="progress-value">
              {t('library.percent', { percent: percentFormat.format(percent) })}
            </span>
          </span>
        ) : null}
      </div>

      <span className="book-row-progress is-desktop">
        {fraction > 0 ? (
          <>
            <span className="progress-track">
              <span style={{ inlineSize: `${percent}%` }} />
            </span>
            <span className="progress-value">
              {t('library.percent', { percent: percentFormat.format(percent) })}
            </span>
          </>
        ) : null}
      </span>

      <span className="book-row-added">{dateFormat.format(book.addedAt)}</span>

      <div className="book-row-actions">
        <button type="button" className="book-open-button" disabled={opening} onClick={onOpen}>
          {primaryLabel}
        </button>
        <BookActionsMenu
          hasFile={hasFile}
          downloading={downloading}
          disabled={opening || downloading}
          onEdit={onEdit}
          onRemove={onRemove}
          onDownload={onDownload}
        />
      </div>
    </li>
  );
};
