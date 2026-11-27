import type { DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupMark } from './GroupMark';

interface GroupRowProps {
  name: string;
  total: number;
  started: number;
  /** Direct child groups (ADR-0027). */
  subgroups?: number;
  /** Ancestor path for search results, so nested groups stay identifiable. */
  pathLabel?: string;
  updatedAt: number;
  locale: string;
  isDropTarget: boolean;
  onOpen: () => void;
  onDragOver: (event: ReactDragEvent) => void;
  onDrop: (event: ReactDragEvent) => void;
  actions: React.ReactNode;
}

/**
 * One catalog row for a group (ADR-0025): folder mark, name, aggregate
 * progress, then Open and the actions menu. The row is a drop target while a
 * book is being dragged onto it; it is not itself draggable.
 */
export const GroupRow = ({
  name,
  total,
  started,
  subgroups = 0,
  pathLabel = '',
  updatedAt,
  locale,
  isDropTarget,
  onOpen,
  onDragOver,
  onDrop,
  actions,
}: GroupRowProps) => {
  const { t } = useTranslation();
  const numberFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const dateFormat = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    day: 'numeric',
    month: 'short',
  });
  const percent = total > 0 ? Math.round((started / total) * 100) : 0;

  return (
    <li
      className={`book-card book-row group-row${isDropTarget ? ' is-drop-target' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <GroupMark count={total} size="thumb" />
      <div className="book-row-text">
        <h3 className="book-row-title">
          <span dir="auto">{name}</span>
        </h3>
        <p className="book-row-meta">
          {pathLabel ? (
            <span className="group-path" dir="auto">
              {pathLabel}
            </span>
          ) : null}
          <span className="group-count">
            {subgroups > 0
              ? `${t('library.groupSubgroups', {
                  count: subgroups,
                  total: numberFormat.format(subgroups),
                })} · `
              : ''}
            {t('library.groupFiles', { count: total, total: numberFormat.format(total) })}
          </span>
          {total > 0 ? (
            <span>
              {t('library.groupStarted', {
                started: numberFormat.format(started),
                total: numberFormat.format(total),
              })}
            </span>
          ) : null}
        </p>
      </div>
      <span className="book-row-progress is-desktop">
        {total > 0 ? (
          <>
            <span className="progress-track">
              <span style={{ inlineSize: `${percent}%` }} />
            </span>
            <span className="progress-value">
              {t('library.groupOf', { started: numberFormat.format(started), total })}
            </span>
          </>
        ) : null}
      </span>
      <span className="book-row-added">{dateFormat.format(updatedAt)}</span>
      <div className="book-row-actions">
        <button type="button" className="book-open-button" onClick={onOpen}>
          {t('library.groupOpen')}
        </button>
        {actions}
      </div>
    </li>
  );
};
