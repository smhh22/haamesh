import type { DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupMark } from './GroupMark';

interface GroupCardProps {
  name: string;
  total: number;
  started: number;
  /** Direct child groups (ADR-0027). */
  subgroups?: number;
  /** Ancestor path for search results, so nested groups stay identifiable. */
  pathLabel?: string;
  locale: string;
  isDropTarget: boolean;
  onOpen: () => void;
  onDragOver: (event: ReactDragEvent) => void;
  onDrop: (event: ReactDragEvent) => void;
  actions: React.ReactNode;
}

/** Grid card for a group (ADR-0025): the folder mark at cover size. */
export const GroupCard = ({
  name,
  total,
  started,
  subgroups = 0,
  pathLabel = '',
  locale,
  isDropTarget,
  onOpen,
  onDragOver,
  onDrop,
  actions,
}: GroupCardProps) => {
  const { t } = useTranslation();
  const numberFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <li
      className={`book-card book-plate group-card${isDropTarget ? ' is-drop-target' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="book-plate-cover"
        aria-label={t('library.groupOpen')}
        onClick={onOpen}
      >
        <GroupMark count={total} size="cover" unit={t('library.groupUnit')} />
      </button>
      <div className="book-plate-meta">
        <h3 className="book-plate-title">
          <span dir="auto">{name}</span>
        </h3>
        <p className="book-plate-author">
          {pathLabel ? (
            <span className="group-path" dir="auto">
              {pathLabel} ·{' '}
            </span>
          ) : null}
          {subgroups > 0
            ? `${t('library.groupSubgroups', {
                count: subgroups,
                total: numberFormat.format(subgroups),
              })} · `
            : ''}
          {t('library.groupFiles', { count: total, total: numberFormat.format(total) })}
          {total > 0
            ? ` · ${t('library.groupStarted', {
                started: numberFormat.format(started),
                total: numberFormat.format(total),
              })}`
            : ''}
        </p>
        <div className="book-plate-actions">{actions}</div>
      </div>
    </li>
  );
};
