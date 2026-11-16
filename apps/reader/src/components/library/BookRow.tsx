import type { BookRecord } from '@hamesh/storage';
import type { DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAuthorList, primaryActionLabel } from '../../library/bookDisplay';
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
  /** Set when the row can be filed into a group (ADR-0025). */
  onAddToGroup?: () => void;
  /** Link-only materialization progress (ADR-0026); undefined when idle. */
  downloadFraction?: number | null;
  onCancelDownload?: () => void;
  /** Set for members of a group in a flattened view. */
  onRemoveFromGroup?: () => void;
  /** Group name shown in the meta line when the member is surfaced. */
  groupLabel?: string | null;
  /** Dragging the row files it into a group drop target (ADR-0025). */
  draggable?: boolean;
  onDragStart?: (event: ReactDragEvent) => void;
  onDragEnd?: () => void;
}

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
  onAddToGroup,
  downloadFraction,
  onCancelDownload,
  onRemoveFromGroup,
  groupLabel,
  draggable,
  onDragStart,
  onDragEnd,
}: BookRowProps) => {
  const { t } = useTranslation();
  const percentFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const dateFormat = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    day: 'numeric',
    month: 'short',
  });

  const authors = formatAuthorList(book.authors, locale) || t('library.unknownAuthor');
  const percent = Math.round(fraction * 100);
  const downloadingLink = downloadFraction !== undefined;
  const primaryLabel = downloadingLink
    ? t('library.linkCancelDownload')
    : primaryActionLabel(book, t, opening, hasFile);

  return (
    <li
      className="book-card book-row"
      draggable={draggable || undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
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
          {groupLabel ? (
            <span className="group-path" title={groupLabel}>
              {t('library.groupIn', { group: groupLabel })}
            </span>
          ) : null}
          <span className="format-chip">{FORMAT_LABEL[book.format]}</span>
          {book.identifiers.pending === '1' ? (
            <span className="format-chip is-link">{t('library.linkSource')}</span>
          ) : null}
          {book.language ? <span className="format-chip">{book.language}</span> : null}
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

      <span className="book-row-added">{dateFormat.format(book.addedAt)}</span>

      <div className="book-row-actions">
        <button
          type="button"
          className="book-open-button"
          disabled={opening || downloadingLink}
          onClick={downloadingLink ? onCancelDownload : onOpen}
        >
          {primaryLabel}
        </button>
        <BookActionsMenu
          hasFile={hasFile}
          downloading={downloading}
          disabled={opening || downloading}
          onEdit={onEdit}
          onRemove={onRemove}
          onDownload={onDownload}
          onAddToGroup={onAddToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
        />
      </div>
    </li>
  );
};
