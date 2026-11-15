import type { DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupMark } from './GroupMark';

interface GroupCardProps {
  name: string;
  total: number;
  started: number;
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
          {t('library.groupFiles', { count: total, total: numberFormat.format(total) })} ·{' '}
          {t('library.groupStarted', {
            started: numberFormat.format(started),
            total: numberFormat.format(total),
          })}
        </p>
        <div className="book-plate-actions">{actions}</div>
      </div>
    </li>
  );
};
