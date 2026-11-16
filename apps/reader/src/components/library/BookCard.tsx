import type { BookRecord } from '@hamesh/storage';
import type { DragEvent as ReactDragEvent } from 'react';
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
  /** Set when the card can be filed into a group (ADR-0025). */
  onAddToGroup?: () => void;
  /** Link-only materialization progress (ADR-0026); undefined when idle. */
  downloadFraction?: number | null;
  onCancelDownload?: () => void;
  /** Dragging the card files it into a group drop target. */
  draggable?: boolean;
  onDragStart?: (event: ReactDragEvent) => void;
  onDragEnd?: () => void;
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
  onAddToGroup,
  downloadFraction,
  onCancelDownload,
  draggable,
  onDragStart,
  onDragEnd,
}: BookCardProps) => {
  const { t } = useTranslation();
  const percentFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const authors = formatAuthorList(book.authors, locale) || t('library.unknownAuthor');
  const percent = Math.round(fraction * 100);
  const downloadingLink = downloadFraction !== undefined;
  const label = downloadingLink
    ? t('library.linkCancelDownload')
    : primaryActionLabel(book, t, opening, hasFile);

  return (
    <li
      className={variant === 'shelf' ? 'book-card book-shelf-item' : 'book-card book-plate'}
      draggable={draggable || undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="book-plate-cover"
        aria-label={t('library.openBook', { title: book.title })}
        onClick={onOpen}
      >
        <BookCover book={book} variant="cover" />
      </button>

      <div className="book-plate-meta">
        <h3 className="book-plate-title" title={book.title}>
          <span dir="auto">{book.title}</span>
        </h3>
        <p className="book-plate-author" dir="auto">
          {authors}
        </p>
        <p className="book-plate-tags">
          <span className="format-chip">{FORMAT_LABEL[book.format]}</span>
          {book.identifiers.pending === '1' ? (
            <span className="format-chip is-link">{t('library.linkSource')}</span>
          ) : null}
          {book.language ? <span className="format-chip">{book.language}</span> : null}
        </p>
        {/* The row renders even at 0% so cards align across a row. */}
        <span className="book-plate-progress">
          {downloadingLink ? (
            <>
              <span className="progress-track">
                <span
                  style={{
                    inlineSize: `${downloadFraction === null ? 0 : Math.round(downloadFraction * 100)}%`,
                  }}
                />
              </span>
              <span className="progress-value">
                {downloadFraction === null
                  ? '…'
                  : t('library.percent', {
                      percent: percentFormat.format(Math.round(downloadFraction * 100)),
                    })}
              </span>
            </>
          ) : fraction > 0 ? (
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
        <div className="book-plate-actions">
          <button
            type="button"
            className="book-open-button"
            disabled={opening || downloadingLink}
            onClick={downloadingLink ? onCancelDownload : onOpen}
          >
            {label}
          </button>
          <BookActionsMenu
            hasFile={hasFile}
            downloading={downloading}
            disabled={opening || downloading}
            onEdit={onEdit}
            onRemove={onRemove}
            onDownload={onDownload}
            onAddToGroup={onAddToGroup}
          />
        </div>
      </div>
    </li>
  );
};
