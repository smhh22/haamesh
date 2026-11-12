import type { BookRecord } from '@hamesh/storage';
import { useTranslation } from 'react-i18next';
import { formatAuthorList, primaryActionLabel } from '../../library/bookDisplay';
import type { UiLocale } from '../../stores/uiStore';
import { BookActionsMenu } from './BookActionsMenu';
import { BookCover, FORMAT_LABEL } from './BookCover';

interface BookCardProps {
  book: BookRecord;
  /** `plate` fills a grid cell; `shelf` is the compact horizontal shelf item. */
  variant?: 'plate' | 'shelf';
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

/**
 * Grid card (Reading Desk): the cover is the anchor and the whole plate opens
 * the book; title, author and progress sit under it. The primary action stays
 * a real button for keyboard users and the overflow menu holds the rest.
 */
export const BookCard = ({
  book,
  variant = 'plate',
  locale,
  fraction,
  hasFile,
  opening,
  downloading,
  onOpen,
  onEdit,
  onRemove,
  onDownload,
}: BookCardProps) => {
  const { t } = useTranslation();
  const percentFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const authors = formatAuthorList(book.authors, locale) || t('library.unknownAuthor');
  const percent = Math.round(fraction * 100);
  const label = primaryActionLabel(book, t, opening, hasFile);

  return (
    <li className={variant === 'shelf' ? 'book-card book-shelf-item' : 'book-card book-plate'}>
      <button
        type="button"
        className="book-plate-cover"
        aria-label={t('library.openBook', { title: book.title })}
        onClick={onOpen}
      >
        <BookCover book={book} variant="cover" />
      </button>

      <div className="book-plate-meta">
        <h3 className="book-plate-title">
          <span dir="auto">{book.title}</span>
        </h3>
        <p className="book-plate-author" dir="auto">
          {authors}
        </p>
        <p className="book-plate-tags">
          <span className="format-chip">{FORMAT_LABEL[book.format]}</span>
          {book.language ? <span className="format-chip">{book.language}</span> : null}
        </p>
        {fraction > 0 ? (
          <span className="book-plate-progress">
            <span className="progress-track">
              <span style={{ inlineSize: `${percent}%` }} />
            </span>
            <span className="progress-value">
              {t('library.percent', { percent: percentFormat.format(percent) })}
            </span>
          </span>
        ) : null}
        <div className="book-plate-actions">
          <button type="button" className="book-open-button" disabled={opening} onClick={onOpen}>
            {label}
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
      </div>
    </li>
  );
};
