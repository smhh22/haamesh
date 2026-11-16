import type { BookGroupRecord, BookRecord } from '@hamesh/storage';
import type { DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BookCover } from './BookCover';
import { GroupMark } from './GroupMark';
import { OverflowMenu } from './OverflowMenu';
import { useTouchReorder } from './useTouchReorder';

interface GroupMemberRowProps {
  book: BookRecord;
  /** "64% read" style line from the caller. */
  meta: string;
  progressPercent: number;
  locale: string;
  /** Dragging this row reorders members within the group (ADR-0025). */
  draggable?: boolean;
  isDropTarget?: boolean;
  /** Touch: true while a long-press drag moves this row. */
  isTouchLifted?: boolean;
  onOpen: () => void;
  onDragStart?: (event: ReactDragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: ReactDragEvent) => void;
  onDrop?: (event: ReactDragEvent) => void;
  onGripPointerDown?: (event: React.PointerEvent) => void;
  onGripPointerMove?: (event: React.PointerEvent) => void;
  onGripPointerUp?: (event: React.PointerEvent) => void;
  onGripPointerCancel?: (event: React.PointerEvent) => void;
  setRowRef?: (row: HTMLElement | null) => void;
  onRemoveFromGroup: () => void;
}

/**
 * One member row inside the group view. Identical grid to a catalog row, but
 * the overflow menu manages membership instead of the library.
 */
export const GroupMemberRow = ({
  book,
  meta,
  progressPercent,
  locale,
  draggable = false,
  isDropTarget = false,
  isTouchLifted = false,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onGripPointerDown,
  onGripPointerMove,
  onGripPointerUp,
  onGripPointerCancel,
  setRowRef,
  onRemoveFromGroup,
}: GroupMemberRowProps) => {
  const { t } = useTranslation();
  const numberFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  void numberFormat;

  return (
    <li
      ref={setRowRef}
      className={`book-card book-row member-row${isDropTarget ? ' is-drop-target' : ''}${
        isTouchLifted ? ' is-touch-lifted' : ''
      }`}
      draggable={draggable || undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span
        className="group-grip"
        aria-hidden="true"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerCancel}
      >
        <svg width="12" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.3" />
          <circle cx="15" cy="6" r="1.3" />
          <circle cx="9" cy="12" r="1.3" />
          <circle cx="15" cy="12" r="1.3" />
          <circle cx="9" cy="18" r="1.3" />
          <circle cx="15" cy="18" r="1.3" />
        </svg>
      </span>
      <BookCover book={book} variant="thumb" />
      <div className="book-row-text">
        <h3 className="book-row-title">
          <span dir="auto">{book.title}</span>
        </h3>
        <p className="book-row-meta">{meta}</p>
      </div>
      <span className="book-row-progress is-desktop">
        {progressPercent > 0 ? (
          <>
            <span className="progress-track">
              <span style={{ inlineSize: `${progressPercent}%` }} />
            </span>
            <span className="progress-value">
              {t('library.percent', { percent: numberFormat.format(progressPercent) })}
            </span>
          </>
        ) : null}
      </span>
      <div className="book-row-actions">
        <button type="button" className="book-open-button" onClick={onOpen}>
          {t('library.openShort')}
        </button>
        <OverflowMenu label={t('library.bookActions')}>
          {(close) => (
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                close();
                onRemoveFromGroup();
              }}
            >
              {t('library.groupRemoveBook')}
            </button>
          )}
        </OverflowMenu>
      </div>
    </li>
  );
};

export interface GroupViewProps {
  group: BookGroupRecord;
  members: BookRecord[];
  /** Direct child groups (ADR-0027), already in display order. */
  subgroups: BookGroupRecord[];
  /** Ancestors from the root down, excluding this group. */
  ancestors: BookGroupRecord[];
  /** Files in the whole subtree, for the header and the mark. */
  totalFiles: number;
  locale: string;
  /** Human lines per member id (format/pages/progress summary). */
  metaFor: (book: BookRecord) => string;
  percentFor: (book: BookRecord) => number;
  onBack: () => void;
  /** Jump to an ancestor group from the breadcrumb. */
  onNavigate: (groupId: string) => void;
  onOpenBook: (book: BookRecord) => void;
  /** Row renderer supplied by the App (drop targets, menus, counts). */
  renderSubgroup: (group: BookGroupRecord) => React.ReactNode;
  onCreateSubgroup: () => void;
  onRename: () => void;
  onAddBooks: () => void;
  onDelete: () => void;
  onRemoveMember: (book: BookRecord) => void;
  onReorder: (draggedId: string, targetId: string) => void;
}

/**
 * The group surface (ADR-0025/0027): breadcrumb back through the ancestor
 * chain, a header with the folder mark and actions, then child groups and
 * members. Member rows drag to reorder; drops on rows reorder, drops
 * elsewhere in the view do nothing.
 */
export const GroupView = ({
  group,
  members,
  subgroups,
  ancestors,
  totalFiles,
  locale,
  metaFor,
  percentFor,
  onBack,
  onNavigate,
  onOpenBook,
  renderSubgroup,
  onCreateSubgroup,
  onRename,
  onAddBooks,
  onDelete,
  onRemoveMember,
  onReorder,
}: GroupViewProps) => {
  const { t } = useTranslation();
  const numberFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');

  const ordered = members;
  // Touch reorder (grip long-press): same commit contract as a desktop drop.
  const touch = useTouchReorder({
    ids: ordered.map((book) => book.id),
    onReorder,
    enabled: ordered.length > 1,
  });

  return (
    <div className="group-view">
      <nav className="group-breadcrumb" aria-label={t('library.groupBreadcrumb')}>
        <button type="button" className="group-back" onClick={onBack}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 6-6 6 6 6" />
          </svg>
          {t('library.groupBack')}
        </button>
        <span className="group-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        {group.category ? (
          <>
            <span>{group.category}</span>
            <span className="group-breadcrumb-sep" aria-hidden="true">
              /
            </span>
          </>
        ) : null}
        {ancestors.map((ancestor) => (
          <span key={ancestor.id} className="group-crumb-item">
            <button
              type="button"
              className="group-crumb"
              onClick={() => onNavigate(ancestor.id)}
              dir="auto"
            >
              {ancestor.name}
            </button>
            <span className="group-breadcrumb-sep" aria-hidden="true">
              /
            </span>
          </span>
        ))}
        <span aria-current="page" dir="auto">
          {group.name}
        </span>
      </nav>

      <div className="group-header">
        <GroupMark count={totalFiles} size="header" />
        <div className="group-header-text">
          <h2 className="group-header-name">
            <span dir="auto">{group.name}</span>
          </h2>
          <p className="group-header-meta">
            {subgroups.length > 0
              ? `${t('library.groupSubgroups', {
                  count: subgroups.length,
                  total: numberFormat.format(subgroups.length),
                })} · `
              : ''}
            {t('library.groupFiles', {
              count: totalFiles,
              total: numberFormat.format(totalFiles),
            })}
            {ordered.length > 1 ? ` · ${t('library.groupReorderHint')}` : ''}
          </p>
        </div>
        <div className="group-header-actions">
          <button type="button" className="reader-action" onClick={onCreateSubgroup}>
            {t('library.groupAddSubgroup')}
          </button>
          <button type="button" className="reader-action" onClick={onRename}>
            {t('library.groupRename')}
          </button>
          <button type="button" className="reader-action" onClick={onAddBooks}>
            {t('library.groupAddBooks')}
          </button>
          <button type="button" className="reader-action is-danger" onClick={onDelete}>
            {t('library.groupDelete')}
          </button>
        </div>
      </div>

      {subgroups.length > 0 ? (
        <section className="group-children">
          <h3 className="group-section-title">{t('library.groupSubgroupsTitle')}</h3>
          <ul className="book-grid is-list">{subgroups.map(renderSubgroup)}</ul>
        </section>
      ) : null}

      {ordered.length === 0 && subgroups.length === 0 ? (
        <p className="group-empty">{t('library.groupEmpty')}</p>
      ) : ordered.length === 0 ? null : (
        <ul className={`book-grid is-list${touch.liftedId ? ' is-touch-reordering' : ''}`}>
          {ordered.map((book) => (
            <GroupMemberRow
              key={book.id}
              book={book}
              meta={metaFor(book)}
              progressPercent={percentFor(book)}
              locale={locale}
              draggable
              isTouchLifted={touch.liftedId === book.id}
              setRowRef={touch.setRowRef(book.id)}
              onOpen={() => onOpenBook(book)}
              onRemoveFromGroup={() => onRemoveMember(book)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', `reorder:${book.id}`);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const raw = event.dataTransfer.getData('text/plain');
                const draggedId = raw.startsWith('reorder:') ? raw.slice('reorder:'.length) : null;
                if (draggedId && draggedId !== book.id) onReorder(draggedId, book.id);
              }}
              onGripPointerDown={(event) => touch.onGripPointerDown(book.id, event)}
              onGripPointerMove={touch.onGripPointerMove}
              onGripPointerUp={touch.onGripPointerUp}
              onGripPointerCancel={touch.onGripPointerCancel}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
