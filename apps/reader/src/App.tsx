import type { Direction, ReadingStatus } from '@hamesh/core';
import {
  categoryName,
  categoryParent,
  categoryPathOf,
  isCategoryInSubtree,
  sanitizeCategoryName,
} from '@hamesh/core';
import { ImportError, type ImportErrorCode } from '@hamesh/engine';
import type { BookGroupRecord, BookRecord, ReadingState } from '@hamesh/storage';
import { DirectionProvider } from '@hamesh/ui';
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type BookOrganization, BookOrganizationDialog } from './components/BookOrganizationDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { BookCard } from './components/library/BookCard';
import { BookPickGroupDialog } from './components/library/BookPickGroupDialog';
import { BookRow } from './components/library/BookRow';
import { CategoryActionsMenu } from './components/library/CategoryActionsMenu';
import { type ContinueItem, ContinueReading } from './components/library/ContinueReading';
import { GroupActionsMenu } from './components/library/GroupActionsMenu';
import { GroupAddBooksDialog } from './components/library/GroupAddBooksDialog';
import { GroupCard } from './components/library/GroupCard';
import { GroupDeleteDialog } from './components/library/GroupDeleteDialog';
import { GroupRow } from './components/library/GroupRow';
import { GroupView } from './components/library/GroupView';
import { type ShelfSection, ShelvesView } from './components/library/ShelvesView';
import { PromptDialog } from './components/PromptDialog';
import { ReaderView } from './components/ReaderView';
import { PlayerBar } from './components/reader/PlayerBar';
import { VideoView } from './components/reader/VideoView';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { type TagSummary, TagsDialog } from './components/TagsDialog';
import { UpdateBanner } from './components/UpdateBanner';
import { UrlImportDialog } from './components/UrlImportDialog';
import { useMediaQuery } from './hooks/useMediaQuery';
import { primaryActionLabel } from './library/bookDisplay';
import { type BookSort, filterAndSortBooks, groupBooksByCategory } from './library/bookList';
import {
  buildCategoryTree,
  collectCategoryPaths,
  flattenCategoryPaths,
  siblingCategoryPaths,
} from './library/categoryTree';
import {
  displayParentId,
  type GroupDeleteMode,
  groupAncestors,
  groupPathLabel,
  matchGroupsByName,
  orderMembers,
  orderSubgroups,
  planGroupDeletion,
  reorderBefore,
  subtreeBooks,
  subtreeGroupIds,
  withOrderId,
} from './library/groups';
import { forgetBookFile, getBookFile } from './services/bookFiles';
import {
  type ContentMatch,
  removeBookTexts,
  searchBookContent,
  storeBookTexts,
} from './services/bookTexts';
import {
  FolderImportError,
  type FolderImportPlan,
  planFolderImport,
} from './services/folderImport';
import {
  importBookFile,
  importBookFromUrl,
  UrlImportError,
  type UrlSyncMode,
} from './services/importBook';
import {
  addBookToGroupPersisted,
  applyGroupDeletionPersisted,
  deletePersistedBook,
  listBookHashes,
  loadBookFile,
  persistBook,
  persistBookOrganization,
  persistGroup,
  persistPendingBook,
  persistReadingState,
  removeBookFromGroupPersisted,
} from './services/libraryPersistence';
import {
  cancelLinkDownload,
  isPendingBook,
  LinkImportError,
  materializePendingBook,
  normalizeLinkUrl,
  pendingBookRecord,
  probeLink,
} from './services/linkImport';
import {
  downloadBook,
  isProviderConfigured,
  loadSyncConfig,
  runSync,
} from './services/syncService';
import { useLibraryStore } from './stores/libraryStore';
import { useReadingStore } from './stores/readingStore';
import { type UiLocale as Locale, useUiStore } from './stores/uiStore';

const directionFor = (locale: Locale): Direction => (locale === 'fa' ? 'rtl' : 'ltr');

/** Link-import failures surface through the library error line. */
const linkErrorCode = (
  code: LinkImportError['code'],
): 'URL_INVALID' | 'UNSUPPORTED_FORMAT' | 'LINK_TOO_LARGE' | 'DOWNLOAD_FAILED' => {
  switch (code) {
    case 'URL_INVALID':
      return 'URL_INVALID';
    case 'UNSUPPORTED_FORMAT':
      return 'UNSUPPORTED_FORMAT';
    case 'TOO_LARGE':
      return 'LINK_TOO_LARGE';
    default:
      return 'DOWNLOAD_FAILED';
  }
};

type ReadingStatusFilter = 'all' | ReadingStatus;
type FormatFilter = 'all' | BookRecord['format'];

const statusOfBook = (bookId: string, states: Record<string, ReadingState>): ReadingStatus =>
  states[bookId]?.status ?? 'unread';

const isSupportedBook = (file: File): boolean =>
  file.type === 'application/epub+zip' ||
  file.type === 'application/pdf' ||
  file.type === 'text/markdown' ||
  file.type.startsWith('audio/') ||
  file.type.startsWith('video/') ||
  /\.(epub|pdf|md|markdown|mp3|m4b|m4a|flac|ogg|opus|mp4|mkv|webm)$/i.test(file.name);

export const App = () => {
  const { t, i18n } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isPhone = useMediaQuery('(max-width: 47.99rem)');
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderCancelRef = useRef(false);
  const [folderProgress, setFolderProgress] = useState<{
    done: number;
    total: number;
    name: string;
  } | null>(null);
  const [folderNotice, setFolderNotice] = useState<{
    imported: number;
    skipped: number;
    failed: number;
    cancelled: boolean;
  } | null>(null);
  const [folderErrorCode, setFolderErrorCode] = useState<'EMPTY' | 'TOO_MANY' | null>(null);
  const [errorCode, setErrorCode] = useState<
    | ImportErrorCode
    | 'UNKNOWN'
    | 'BOOK_FILE_MISSING'
    | 'OPEN_FAILED'
    | 'URL_INVALID'
    | 'URL_FAILED'
    | 'DOWNLOAD_FAILED'
    | 'LINK_TOO_LARGE'
    | null
  >(null);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  // Books whose bytes exist locally (ADR-0020); synced rounds deliver records
  // and covers only, so a remote-known book starts without its file.
  const [fileHashes, setFileHashes] = useState<Set<string>>(() => new Set());
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);
  // Link-only materialization progress (ADR-0026): 0–1, or null while the
  // total is still unknown; the bookId scopes the card that shows it.
  const [linkProgress, setLinkProgress] = useState<{
    bookId: string;
    fraction: number | null;
  } | null>(null);
  const linkAbortRef = useRef<AbortController | null>(null);
  const linkTokenRef = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [removingBookId, setRemovingBookId] = useState<string | null>(null);
  const [categoryAction, setCategoryAction] = useState<{
    type: 'create' | 'rename' | 'delete';
    /** Path or name the action targets (empty for a root create). */
    name: string;
    /** For create: the parent path (null = root). */
    parent?: string | null;
  } | null>(null);
  /** Category name being drag-and-dropped between group headers. */
  const [dragCategory, setDragCategory] = useState<string | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [sort, setSort] = useState<BookSort>('recent');
  /** Catalog rail / chip filters; applied before search and sorting. */
  const [statusFilter, setStatusFilter] = useState<ReadingStatusFilter>('all');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const viewMode = useUiStore((state) => state.viewMode);
  const setViewMode = useUiStore((state) => state.setViewMode);
  const [contentMatches, setContentMatches] = useState<ContentMatch[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Library toolbar sync button: idle → syncing → done | failed. */
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done' | 'failed'>('idle');
  const [hasSyncProvider, setHasSyncProvider] = useState(false);
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [readerSession, setReaderSession] = useState<{
    book: BookRecord;
    start: ReadingState | null;
  } | null>(null);
  /** One audio book plays at a time; the bar overlays any view (ADR-0021). */
  const [audioSession, setAudioSession] = useState<{
    book: BookRecord;
    file: File;
  } | null>(null);
  /** Video courses watch full-screen, device-local (ADR-0023). */
  const [videoSession, setVideoSession] = useState<{
    book: BookRecord;
    file: File;
  } | null>(null);
  const books = useLibraryStore((state) => state.books);
  const groups = useLibraryStore((state) => state.groups);
  const readingStates = useReadingStore((state) => state.states);
  const updateBook = useLibraryStore((state) => state.updateBook);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [groupAction, setGroupAction] = useState<{
    type: 'create' | 'rename' | 'delete';
    group: BookGroupRecord | null;
    /** Category a created group lands in (null = uncategorized). */
    category: string | null;
    /** Parent for a created subgroup (ADR-0027). */
    parentId?: string | null;
  } | null>(null);
  const [addBooksGroupId, setAddBooksGroupId] = useState<string | null>(null);
  const [pickGroupBookId, setPickGroupBookId] = useState<string | null>(null);
  /** A book row/card being dragged toward a group drop target (ADR-0025). */
  const [dragBookId, setDragBookId] = useState<string | null>(null);
  const [dropGroupKey, setDropGroupKey] = useState<string | null>(null);

  // Re-derive which books have local bytes whenever the library changes: a
  // sync round (records only) or a per-book download both land here.
  useEffect(() => {
    const refresh = () => {
      void listBookHashes().then(setFileHashes);
    };
    refresh();
    return useLibraryStore.subscribe(refresh);
  }, []);
  const collapsedGroups = useUiStore((state) => state.collapsedGroups);
  const toggleGroup = useUiStore((state) => state.toggleGroup);
  const setCollapsedGroups = useUiStore((state) => state.setCollapsedGroups);
  const extraCategories = useUiStore((state) => state.extraCategories);
  const addExtraCategory = useUiStore((state) => state.addExtraCategory);
  const renameExtraCategory = useUiStore((state) => state.renameExtraCategory);
  const removeExtraCategory = useUiStore((state) => state.removeExtraCategory);
  const order = useUiStore((state) => state.categoryOrder);
  const setCategoryOrder = useUiStore((state) => state.setCategoryOrder);
  const tagSummaries = useMemo<TagSummary[]>(() => {
    const counts = new Map<string, number>();
    for (const book of books) {
      for (const tag of book.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || new Intl.Collator(locale).compare(a[0], b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [books, locale]);
  const tags = useMemo(() => tagSummaries.map((summary) => summary.name), [tagSummaries]);
  const editingBook = editingBookId
    ? (books.find((book) => book.id === editingBookId) ?? null)
    : null;
  const removingBook = removingBookId
    ? (books.find((book) => book.id === removingBookId) ?? null)
    : null;
  const addBook = useLibraryStore((state) => state.addBook);
  const removeBook = useLibraryStore((state) => state.removeBook);
  const saveReadingState = useReadingStore((state) => state.save);
  const removeReadingState = useReadingStore((state) => state.remove);
  const collator = useMemo(
    () => new Intl.Collator(locale, { sensitivity: 'base', numeric: true }),
    [locale],
  );
  /** Every known category path (books + created, ancestors included). */
  const categoryPaths = useMemo(
    () => [...collectCategoryPaths(books, extraCategories)].sort(collator.compare),
    [books, extraCategories, collator],
  );
  /** Dropdown choices in the book dialog: all known paths. */
  const categoryChoices = categoryPaths;
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US'),
    [locale],
  );
  /** Books that pass the rail/chip filters; search and sort run on top. */
  const filteredBooks = useMemo(
    () =>
      books.filter(
        (book) =>
          (statusFilter === 'all' || statusOfBook(book.id, readingStates) === statusFilter) &&
          (formatFilter === 'all' || book.format === formatFilter),
      ),
    [books, formatFilter, readingStates, statusFilter],
  );
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  /** True when any rail/chip filter or search is active: members flatten. */
  const isFiltering =
    query.trim() !== '' || statusFilter !== 'all' || formatFilter !== 'all' || tagFilter.length > 0;
  /** Books whose group row represents them while browsing (ADR-0025). */
  const groupedBookIds = useMemo(
    () =>
      new Set(
        books
          .filter((book) => book.groupId !== null && groupById.has(book.groupId))
          .map((book) => book.id),
      ),
    [books, groupById],
  );
  /** Members per group in display order: group.order first, then addedAt. */
  const membersByGroup = useMemo(() => {
    const map = new Map<string, BookRecord[]>();
    for (const group of groups) {
      map.set(
        group.id,
        orderMembers(
          group,
          books.filter((book) => book.groupId === group.id),
        ),
      );
    }
    return map;
  }, [books, groups]);
  /**
   * Child groups per parent (ADR-0027), in display order. The `null` key is
   * the catalog level: root groups, plus any group whose synced parent is
   * missing or cyclic (displayParentId resolves those to a root).
   */
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, BookGroupRecord[]>();
    for (const group of groups) {
      const parentId = displayParentId(groups, group);
      const list = map.get(parentId) ?? [];
      list.push(group);
      map.set(parentId, list);
    }
    for (const [parentId, list] of map) {
      if (parentId === null) {
        list.sort((a, b) => a.createdAt - b.createdAt);
      } else {
        const parent = groups.find((group) => group.id === parentId);
        if (parent) map.set(parentId, orderSubgroups(parent, list));
      }
    }
    return map;
  }, [groups]);
  const topGroups = childrenByParent.get(null) ?? [];
  /** Files and started files in a group's whole subtree, for counts. */
  const subtreeStats = useMemo(() => {
    const map = new Map<string, { files: number; started: number }>();
    for (const group of groups) {
      const members = subtreeBooks(groups, books, group.id);
      map.set(group.id, {
        files: members.length,
        started: members.filter((book) => (readingStates[book.id]?.fraction ?? 0) > 0).length,
      });
    }
    return map;
  }, [groups, books, readingStates]);
  /** In search mode a group surfaces only when its name matches. */
  const matchedGroups = useMemo(() => matchGroupsByName(groups, query), [groups, query]);
  const visibleBooks = useMemo(() => {
    const source = isFiltering
      ? filteredBooks
      : filteredBooks.filter((book) => !groupedBookIds.has(book.id));
    return filterAndSortBooks(source, query, sort, collator, { tags: tagFilter });
  }, [filteredBooks, groupedBookIds, isFiltering, query, sort, collator, tagFilter]);
  const openGroup = openGroupId ? (groupById.get(openGroupId) ?? null) : null;
  /**
   * An open group follows the active filters like the catalog does (ADR-0025
   * flatten rule applied one level down): member books go through the same
   * query/status/format/tag pipeline, child groups surface by name. While a
   * filter is active the header counts stay whole-subtree, only the list
   * narrows.
   */
  const openGroupContent = useMemo(() => {
    if (!openGroup) return null;
    const children = childrenByParent.get(openGroup.id) ?? [];
    if (!isFiltering) {
      return {
        filtering: false as const,
        members: membersByGroup.get(openGroup.id) ?? [],
        children,
      };
    }
    const members = filterAndSortBooks(
      filteredBooks.filter((book) => book.groupId === openGroup.id),
      query,
      sort,
      collator,
      { tags: tagFilter },
    );
    return {
      filtering: true as const,
      members,
      children: matchGroupsByName(children, query),
    };
  }, [
    openGroup,
    isFiltering,
    filteredBooks,
    query,
    sort,
    collator,
    tagFilter,
    membersByGroup,
    childrenByParent,
  ]);
  /** Groups render on their own even when every book is filed into one. */
  const hasVisibleGroups = isFiltering ? matchedGroups.length > 0 : topGroups.length > 0;
  const statusCounts = useMemo(() => {
    const counts: Record<ReadingStatus | 'all', number> = {
      all: books.length,
      unread: 0,
      reading: 0,
      finished: 0,
    };
    for (const book of books) counts[statusOfBook(book.id, readingStates)] += 1;
    return counts;
  }, [books, readingStates]);
  const formatCounts = useMemo(() => {
    const counts = new Map<BookRecord['format'], number>();
    for (const book of books) counts.set(book.format, (counts.get(book.format) ?? 0) + 1);
    return counts;
  }, [books]);
  /** What the Continue strip shows: started, not finished, newest first. */
  const continueItems = useMemo<ContinueItem[]>(
    () =>
      Object.values(readingStates)
        .filter((state) => state.status === 'reading' && state.fraction > 0 && state.fraction < 1)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4)
        .map((state) => {
          const book = books.find((entry) => entry.id === state.bookId);
          return book ? { book, fraction: state.fraction } : null;
        })
        .filter((item): item is ContinueItem => item !== null),
    [books, readingStates],
  );

  // Grouped sections only when the library actually uses categories.
  const hasCategories = useMemo(
    () => books.some((book) => book.category !== null) || extraCategories.length > 0,
    [books, extraCategories],
  );
  const bookGroups = useMemo(
    () =>
      hasCategories ? groupBooksByCategory(visibleBooks, collator, extraCategories, order) : [],
    [hasCategories, visibleBooks, collator, extraCategories, order],
  );

  /** One shelf per category (or a single shelf for a flat library). */
  const shelves = useMemo<ShelfSection[]>(() => {
    const groups = hasCategories
      ? bookGroups
      : [{ key: '::all', category: null, books: visibleBooks }];
    return groups
      .filter((group) => group.books.length > 0)
      .map((group) => ({
        key: group.key,
        name:
          group.category !== null
            ? categoryName(group.category)
            : hasCategories
              ? t('library.uncategorized')
              : t('library.statusAll'),
        books: group.books,
      }));
  }, [bookGroups, hasCategories, t, visibleBooks]);
  const featuredItem = useMemo(() => {
    const first = continueItems[0];
    if (first) return first;
    const newest = visibleBooks[0];
    return newest ? { book: newest, fraction: readingStates[newest.id]?.fraction ?? 0 } : null;
  }, [continueItems, readingStates, visibleBooks]);
  const upNextItems = useMemo(() => {
    if (continueItems.length > 1) return continueItems.slice(1, 3);
    return visibleBooks.slice(1, 3).map((book) => ({
      book,
      fraction: readingStates[book.id]?.fraction ?? 0,
    }));
  }, [continueItems, readingStates, visibleBooks]);
  /** Categories that exist only because a group lives there (ADR-0025). */
  const groupCategories = useMemo(
    () => [
      ...new Set(groups.map((group) => group.category).filter((c): c is string => c !== null)),
    ],
    [groups],
  );
  const categoryRoots = useMemo(
    () =>
      hasCategories
        ? buildCategoryTree(visibleBooks, [...extraCategories, ...groupCategories], order, collator)
        : [],
    [hasCategories, visibleBooks, extraCategories, groupCategories, order, collator],
  );
  // Flat pre-order rows so each section stays a sibling (existing layouts and
  // locators keep working); a collapsed node hides its descendants.
  const categoryRows = useMemo(() => {
    const rows: Array<{ node: (typeof categoryRoots)[number]; depth: number }> = [];
    const walk = (nodes: typeof categoryRoots, hidden: boolean) => {
      for (const node of nodes) {
        if (!hidden) rows.push({ node, depth: node.depth });
        walk(node.children, hidden || collapsedGroups.includes(node.key));
      }
    };
    walk(categoryRoots, false);
    return rows;
  }, [categoryRoots, collapsedGroups]);
  const uncategorizedGroup = bookGroups.find((group) => group.category === null) ?? null;
  /**
   * Root groups inside one category (ADR-0025/0027). Children belong to their
   * parent group's surface, never to the catalog section directly.
   */
  const groupsInCategory = (category: string | null): BookGroupRecord[] =>
    (isFiltering ? [] : (childrenByParent.get(null) ?? [])).filter(
      (group) => group.category === category,
    );
  /** Filing a book also appends it to the group's display order. */
  const fileBookIntoGroup = async (book: BookRecord, group: BookGroupRecord) => {
    if (book.groupId === group.id) return;
    await addBookToGroupPersisted(book, group);
    const members = (membersByGroup.get(group.id) ?? []).map((member) => member.id);
    if (!members.includes(book.id)) members.push(book.id);
    if (members.join('\u0000') !== group.order.join('\u0000')) {
      await persistGroup({ ...group, order: members, updatedAt: Date.now() });
    }
  };
  const reorderGroupMembers = (group: BookGroupRecord, draggedId: string, targetId: string) => {
    const next = reorderBefore(group.order, draggedId, targetId);
    if (next) void persistGroup({ ...group, order: next, updatedAt: Date.now() });
  };
  /** Apply one of the three delete choices (ADR-0027). */
  const deleteGroupWithMode = (group: BookGroupRecord, mode: GroupDeleteMode) => {
    const plan = planGroupDeletion(groups, books, group.id, mode);
    if (openGroupId && plan.groupIds.includes(openGroupId)) {
      setOpenGroupId(displayParentId(groups, group));
    }
    for (const bookId of plan.deletedBookIds) {
      const book = books.find((item) => item.id === bookId);
      if (book) removeBookAndFile(book);
    }
    void applyGroupDeletionPersisted(plan);
    setGroupAction(null);
  };
  const bookDragProps = (book: BookRecord) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      setDragBookId(book.id);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `book:${book.id}`);
    },
    onDragEnd: () => {
      setDragBookId(null);
      setDropGroupKey(null);
    },
  });
  const groupDropProps = (group: BookGroupRecord) => ({
    isDropTarget: dropGroupKey === group.id && dragBookId !== null,
    onDragOver: (event: React.DragEvent) => {
      if (dragBookId === null) return;
      event.preventDefault();
      if (dropGroupKey !== group.id) setDropGroupKey(group.id);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDropGroupKey(null);
      const book = books.find((candidate) => candidate.id === dragBookId);
      setDragBookId(null);
      if (book) void fileBookIntoGroup(book, group);
    },
  });
  const renderGroupRow = (group: BookGroupRecord, showPath = true) => {
    const stats = subtreeStats.get(group.id) ?? { files: 0, started: 0 };
    return (
      <GroupRow
        key={`group:${group.id}`}
        name={group.name}
        total={stats.files}
        started={stats.started}
        subgroups={(childrenByParent.get(group.id) ?? []).length}
        pathLabel={showPath ? groupPathLabel(groups, group.id) : ''}
        updatedAt={group.updatedAt}
        locale={locale}
        onOpen={() => setOpenGroupId(group.id)}
        {...groupDropProps(group)}
        actions={
          <GroupActionsMenu
            onRename={() => setGroupAction({ type: 'rename', group, category: null })}
            onAddBooks={() => setAddBooksGroupId(group.id)}
            onAddSubgroup={() =>
              setGroupAction({
                type: 'create',
                group: null,
                category: group.category,
                parentId: group.id,
              })
            }
            onDelete={() => setGroupAction({ type: 'delete', group, category: null })}
          />
        }
      />
    );
  };
  const renderGroupCard = (group: BookGroupRecord) => {
    const stats = subtreeStats.get(group.id) ?? { files: 0, started: 0 };
    return (
      <GroupCard
        key={`group:${group.id}`}
        name={group.name}
        total={stats.files}
        started={stats.started}
        subgroups={(childrenByParent.get(group.id) ?? []).length}
        pathLabel={groupPathLabel(groups, group.id)}
        locale={locale}
        onOpen={() => setOpenGroupId(group.id)}
        {...groupDropProps(group)}
        actions={
          <GroupActionsMenu
            onRename={() => setGroupAction({ type: 'rename', group, category: null })}
            onAddBooks={() => setAddBooksGroupId(group.id)}
            onAddSubgroup={() =>
              setGroupAction({
                type: 'create',
                group: null,
                category: group.category,
                parentId: group.id,
              })
            }
            onDelete={() => setGroupAction({ type: 'delete', group, category: null })}
          />
        }
      />
    );
  };
  /** Every group key that exists right now, for Collapse all. */
  const allGroupKeys = useMemo(
    () => [
      ...categoryRows.map((row) => row.node.key),
      ...(uncategorizedGroup ? [uncategorizedGroup.key] : []),
    ],
    [categoryRows, uncategorizedGroup],
  );
  /** Manual order is the pre-order of the whole forest (collapsed or not). */
  const displayedCategoryPaths = useMemo(
    () => flattenCategoryPaths(categoryRoots),
    [categoryRoots],
  );
  const direction = directionFor(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    void i18n.changeLanguage(locale);
  }, [direction, i18n, locale]);

  // The toolbar sync button exists only when a provider is configured; the
  // configuration can change while the settings dialog is open, so re-check
  // when it closes.
  useEffect(() => {
    if (settingsOpen) return;
    const config = loadSyncConfig();
    setHasSyncProvider(
      config.providers.some((entry) => entry.enabled && isProviderConfigured(entry)),
    );
  }, [settingsOpen]);

  const runLibrarySync = async () => {
    setSyncState('syncing');
    try {
      const report = await runSync(loadSyncConfig());
      setSyncState(report.ok ? 'done' : 'failed');
    } catch {
      setSyncState('failed');
    }
  };

  const toggleLocale = () => {
    setLocale(locale === 'en' ? 'fa' : 'en');
  };

  // Global shortcuts: `?` opens the map, `/` focuses library search. Anything
  // typed into a field wins over both. Attached before paint so the first key
  // press after mount is never lost.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || shortcutsOpen) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key === '/' && !readerSession) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, shortcutsOpen, readerSession]);

  const handleFiles = async (fileList: FileList | File[] | null): Promise<void> => {
    if (!fileList) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsImporting(true);
    setErrorCode(null);
    try {
      for (const file of files) {
        if (!isSupportedBook(file)) {
          setErrorCode('UNSUPPORTED_FORMAT');
          continue;
        }
        try {
          const imported = await importBookFile(file);
          addBook(imported.record);
          await persistBook(imported.record, imported.file, imported.cover);
          void storeBookTexts(imported.record.id, imported.file);
        } catch (error) {
          setErrorCode(error instanceof ImportError ? error.code : 'UNKNOWN');
        }
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    // Clearing the value empties the live FileList, so copy it first.
    const files = Array.from(input.files ?? []);
    const isFolderPick = input.hasAttribute('webkitdirectory');
    input.value = '';
    if (files.length === 0) return;
    if (isFolderPick) {
      void handleFolderImport(files);
    } else {
      void handleFiles(files);
    }
  };

  const openFilePicker = () => {
    const input = fileInputRef.current;
    if (!input) return;
    input.removeAttribute('webkitdirectory');
    input.value = '';
    input.click();
  };

  /** Pick a directory; the same input becomes a webkitdirectory input. */
  const openFolderPicker = () => {
    const input = fileInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.value = '';
    input.click();
  };

  useEffect(() => {
    if (!importMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) setImportMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImportMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [importMenuOpen]);

  /**
   * Bulk import a picked folder (design 2026-11-26): the folder tree becomes
   * groups (ADR-0027), every book file imports in order, Cancel stops between
   * files. Partial imports stay, matching plain file import.
   */
  const handleFolderImport = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    let plan: FolderImportPlan;
    try {
      plan = planFolderImport(files);
    } catch (error) {
      if (error instanceof FolderImportError) setFolderErrorCode(error.code);
      else setErrorCode('UNKNOWN');
      return;
    }
    setFolderErrorCode(null);
    setFolderNotice(null);
    setErrorCode(null);
    folderCancelRef.current = false;
    setIsImporting(true);
    setFolderProgress({ done: 0, total: plan.total, name: '' });
    const created = new Map<string, BookGroupRecord>();
    let imported = 0;
    let failed = 0;
    let done = 0;
    try {
      for (const groupPlan of plan.groups) {
        if (folderCancelRef.current) break;
        const now = Date.now();
        const parent = groupPlan.parentPath ? (created.get(groupPlan.parentPath) ?? null) : null;
        const group: BookGroupRecord = {
          id: crypto.randomUUID(),
          name: groupPlan.name,
          category: parent?.category ?? null,
          parentId: parent?.id ?? null,
          order: [],
          createdAt: now,
          updatedAt: now,
        };
        await persistGroup(group);
        created.set(groupPlan.path, group);
        if (parent) {
          const live = useLibraryStore.getState().groups.find((item) => item.id === parent.id);
          if (live) {
            await persistGroup({
              ...live,
              order: withOrderId(live.order, group.id),
              updatedAt: Date.now(),
            });
          }
        }
      }
      const entries = [
        ...plan.rootFiles.map((file) => ({ file, groupPath: null as string | null })),
        ...plan.groups.flatMap((group) =>
          group.files.map((file) => ({ file, groupPath: group.path as string | null })),
        ),
      ];
      for (const entry of entries) {
        if (folderCancelRef.current) break;
        setFolderProgress({ done, total: plan.total, name: entry.file.name });
        try {
          const importedBook = await importBookFile(entry.file);
          addBook(importedBook.record);
          await persistBook(importedBook.record, importedBook.file, importedBook.cover);
          void storeBookTexts(importedBook.record.id, importedBook.file);
          const group = entry.groupPath ? (created.get(entry.groupPath) ?? null) : null;
          if (group) {
            await addBookToGroupPersisted(importedBook.record, group);
            const live = useLibraryStore.getState().groups.find((item) => item.id === group.id);
            if (live && !live.order.includes(importedBook.record.id)) {
              await persistGroup({
                ...live,
                order: [...live.order, importedBook.record.id],
                updatedAt: Date.now(),
              });
            }
          }
          imported += 1;
        } catch {
          failed += 1;
        }
        done += 1;
        setFolderProgress({ done, total: plan.total, name: entry.file.name });
      }
    } finally {
      setIsImporting(false);
      setFolderProgress(null);
      setFolderNotice({
        imported,
        skipped: plan.skipped,
        failed,
        cancelled: folderCancelRef.current,
      });
    }
  };

  /**
   * Add a book from a link. ADR-0019 asked how the book syncs; ADR-0026 made
   * the link mode real: nothing downloads until the user opens the card.
   */
  const handleUrlImport = async (url: string, syncVia: UrlSyncMode) => {
    setUrlImportOpen(false);
    setIsImporting(true);
    setErrorCode(null);
    try {
      if (syncVia === 'url') {
        const parsed = normalizeLinkUrl(url);
        const probe = await probeLink(parsed);
        const record = await pendingBookRecord(parsed, probe);
        addBook(record);
        await persistPendingBook(record);
        return;
      }
      const imported = await importBookFromUrl(url, syncVia);
      addBook(imported.record);
      await persistBook(imported.record, imported.file, imported.cover);
      void storeBookTexts(imported.record.id, imported.file);
    } catch (error) {
      setErrorCode(
        error instanceof LinkImportError
          ? linkErrorCode(error.code)
          : error instanceof UrlImportError
            ? error.code
            : error instanceof ImportError
              ? error.code
              : 'UNKNOWN',
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const saveOrganization = (book: BookRecord, organization: BookOrganization) => {
    updateBook(book.id, organization);
    setEditingBookId(null);
    void persistBookOrganization(book, organization);
  };

  /**
   * Create a category (a name-only segment) at the library root or under an
   * existing node; the path materializes immediately even with no books.
   */
  const createCategory = (name: string, parent: string | null = null) => {
    const path = categoryPathOf(parent, name);
    if (path === '' || categoryPaths.includes(path)) return;
    addExtraCategory(path);
  };

  /**
   * Move a category one position in the DISPLAYED order. The whole displayed
   * sequence is persisted, so categories that were never reordered move
   * correctly too (a sparse order would rank every unordered name as one tie).
   */
  const moveCategoryBy = (path: string, delta: number) => {
    const siblings = siblingCategoryPaths(categoryRoots, path);
    const at = siblings.indexOf(path);
    const target = at + delta;
    if (at === -1 || target < 0 || target >= siblings.length) return;
    const anchor = siblings[target];
    if (!anchor) return;
    const sequence = displayedCategoryPaths.filter((item) => item !== path);
    const base = sequence.indexOf(anchor);
    // Moving up inserts before the anchor; moving down inserts after it.
    const to = base === -1 ? sequence.length : base + (delta > 0 ? 1 : 0);
    sequence.splice(to, 0, path);
    setCategoryOrder(sequence);
  };

  /**
   * Drop `path` before `anchor` in the displayed sequence (null = end).
   * Reordering only happens between siblings; a cross-level drop is ignored.
   */
  const reorderCategoryBefore = (path: string, anchor: string | null) => {
    if (path === anchor) return;
    if (anchor !== null) {
      const siblings = siblingCategoryPaths(categoryRoots, anchor);
      if (!siblings.includes(path)) return;
    }
    const at = displayedCategoryPaths.indexOf(path);
    if (at === -1) return;
    const next = displayedCategoryPaths.filter((item) => item !== path);
    const to = anchor === null ? next.length : Math.max(0, next.indexOf(anchor));
    next.splice(to === -1 ? next.length : to, 0, path);
    setCategoryOrder(next);
  };

  /**
   * Rename one node. `from` is a full path and `to` a new name-only segment;
   * every descendant path moves with it in one pass.
   */
  const renameCategory = (from: string, to: string) => {
    const clean = sanitizeCategoryName(to);
    if (clean === '') return;
    const toPath = categoryPathOf(categoryParent(from), clean);
    if (toPath === from) return;
    const moved = (path: string): string => `${toPath}${path.slice(from.length)}`;
    for (const book of books) {
      if (!book.category || !isCategoryInSubtree(book.category, from)) continue;
      const organization = { category: moved(book.category), tags: book.tags };
      updateBook(book.id, organization);
      void persistBookOrganization(book, organization);
    }
    for (const extra of extraCategories) {
      if (!isCategoryInSubtree(extra, from)) continue;
      renameExtraCategory(extra, moved(extra));
    }
    setCategoryOrder(order.map((item) => (isCategoryInSubtree(item, from) ? moved(item) : item)));
  };

  /** Delete a node and its whole subtree; books there become uncategorized. */
  const deleteCategory = (path: string) => {
    for (const book of books) {
      if (!book.category || !isCategoryInSubtree(book.category, path)) continue;
      const organization = { category: null, tags: book.tags };
      updateBook(book.id, organization);
      void persistBookOrganization(book, organization);
    }
    for (const extra of extraCategories) {
      if (isCategoryInSubtree(extra, path)) removeExtraCategory(extra);
    }
    setCategoryOrder(order.filter((item) => !isCategoryInSubtree(item, path)));
  };

  const renameTag = (from: string, to: string) => {
    if (to === from) return;
    for (const book of books) {
      if (!book.tags.includes(from)) continue;
      const nextTags = [...new Set(book.tags.map((tag) => (tag === from ? to : tag)))];
      const organization = { category: book.category, tags: nextTags };
      updateBook(book.id, organization);
      void persistBookOrganization(book, organization);
    }
    setTagFilter((current) => current.map((tag) => (tag === from ? to : tag)));
  };

  const deleteTag = (tag: string) => {
    for (const book of books) {
      if (!book.tags.includes(tag)) continue;
      const organization = {
        category: book.category,
        tags: book.tags.filter((item) => item !== tag),
      };
      updateBook(book.id, organization);
      void persistBookOrganization(book, organization);
    }
    setTagFilter((current) => current.filter((item) => item !== tag));
  };

  const removeBookAndFile = (book: BookRecord) => {
    if (book.coverPath?.startsWith('blob:')) {
      URL.revokeObjectURL(book.coverPath);
    }
    forgetBookFile(book.hash);
    removeReadingState(book.id);
    removeBook(book.id);
    void removeBookTexts(book.id);
    void deletePersistedBook(book);
  };

  const openingRef = useRef<string | null>(null);

  /**
   * Fetch a pending link's bytes and turn it into a normal book (ADR-0026),
   * with progress and cancel. Returns null when cancelled or failed (the
   * error code is already surfaced).
   */
  const materializeLink = async (book: BookRecord): Promise<BookRecord | null> => {
    if (linkProgress) return null;
    const controller = new AbortController();
    const token = crypto.randomUUID();
    linkAbortRef.current = controller;
    linkTokenRef.current = token;
    setLinkProgress({ bookId: book.id, fraction: null });
    setErrorCode(null);
    try {
      const result = await materializePendingBook(book, {
        signal: controller.signal,
        onProgress: (fraction) => setLinkProgress({ bookId: book.id, fraction }),
      });
      setFileHashes((current) => new Set(current).add(result.book.hash));
      return result.book;
    } catch (error) {
      if (error instanceof LinkImportError && error.code === 'CANCELLED') return null;
      setErrorCode(
        error instanceof LinkImportError ? linkErrorCode(error.code) : 'DOWNLOAD_FAILED',
      );
      return null;
    } finally {
      linkAbortRef.current = null;
      linkTokenRef.current = null;
      setLinkProgress(null);
    }
  };

  const cancelMaterialize = () => {
    linkAbortRef.current?.abort();
    const token = linkTokenRef.current;
    if (token) void cancelLinkDownload(token);
  };

  const openReader = async (book: BookRecord) => {
    if (openingRef.current) return;
    openingRef.current = book.id;
    setOpeningBookId(book.id);
    setErrorCode(null);
    try {
      // A freshly imported book still sits in the runtime cache; the derived
      // set may lag one render behind, so the cache check comes first.
      let target = book;
      let file = getBookFile(target.hash);
      if (!file && fileHashes.has(target.hash)) {
        file = await loadBookFile(target);
      }
      if (!file && isPendingBook(target)) {
        // A pending link materializes on first open (ADR-0026): the fetched
        // bytes become a normal content-hashed book, then the reader opens it.
        const materialized = await materializeLink(target);
        if (!materialized) return;
        target = materialized;
        file = getBookFile(target.hash) ?? (await loadBookFile(target));
      }
      if (!file) {
        // On-demand download (ADR-0020): opening a remote-known book fetches
        // its bytes first, then opens it. With no provider configured there is
        // nothing to fetch from, so fall through to the missing-file report.
        const result = await downloadBook(target);
        if (result.ok) {
          setFileHashes((current) => new Set(current).add(target.hash));
          file = await loadBookFile(target);
        } else if (result.code !== 'CONFIGURATION') {
          setErrorCode('DOWNLOAD_FAILED');
          return;
        }
      }
      if (!file) {
        setErrorCode('BOOK_FILE_MISSING');
        return;
      }
      // Audio books play through the persistent player bar instead of the
      // paginated reader (ADR-0021); video courses watch full-screen
      // (ADR-0023).
      if (target.format === 'audio') {
        setAudioSession({ book: target, file });
        return;
      }
      if (target.format === 'video') {
        setVideoSession({ book: target, file });
        return;
      }
      setReaderSession({
        book: target,
        start: useReadingStore.getState().states[target.id] ?? null,
      });
    } catch {
      setErrorCode('OPEN_FAILED');
    } finally {
      openingRef.current = null;
      setOpeningBookId(null);
    }
  };

  const downloadBookFile = async (book: BookRecord) => {
    if (downloadingHash) return;
    if (isPendingBook(book)) {
      await materializeLink(book);
      return;
    }
    setDownloadingHash(book.hash);
    setErrorCode(null);
    try {
      const result = await downloadBook(book);
      if (result.ok) {
        setFileHashes((current) => new Set(current).add(book.hash));
      } else {
        setErrorCode('DOWNLOAD_FAILED');
      }
    } finally {
      setDownloadingHash(null);
    }
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setContentMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchBookContent(trimmed)
        .then(setContentMatches)
        .catch(() => setContentMatches([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const renderGridCard = (book: BookRecord) => (
    <BookCard
      key={book.id}
      book={book}
      locale={locale}
      fraction={readingStates[book.id]?.fraction ?? 0}
      hasFile={fileHashes.has(book.hash)}
      opening={openingBookId === book.id}
      downloading={downloadingHash === book.hash}
      downloadFraction={linkProgress?.bookId === book.id ? linkProgress.fraction : undefined}
      onCancelDownload={cancelMaterialize}
      onOpen={() => void openReader(book)}
      onEdit={() => setEditingBookId(book.id)}
      onRemove={() => setRemovingBookId(book.id)}
      onDownload={() => void downloadBookFile(book)}
      onAddToGroup={() => setPickGroupBookId(book.id)}
      {...bookDragProps(book)}
    />
  );

  const renderShelfCard = (book: BookRecord) => (
    <BookCard
      key={book.id}
      variant="shelf"
      book={book}
      locale={locale}
      fraction={readingStates[book.id]?.fraction ?? 0}
      hasFile={fileHashes.has(book.hash)}
      opening={openingBookId === book.id}
      downloading={downloadingHash === book.hash}
      downloadFraction={linkProgress?.bookId === book.id ? linkProgress.fraction : undefined}
      onCancelDownload={cancelMaterialize}
      onOpen={() => void openReader(book)}
      onEdit={() => setEditingBookId(book.id)}
      onRemove={() => setRemovingBookId(book.id)}
      onDownload={() => void downloadBookFile(book)}
    />
  );

  const renderBookRow = (book: BookRecord) => (
    <BookRow
      key={book.id}
      book={book}
      locale={locale}
      fraction={readingStates[book.id]?.fraction ?? 0}
      hasFile={fileHashes.has(book.hash)}
      opening={openingBookId === book.id}
      downloading={downloadingHash === book.hash}
      downloadFraction={linkProgress?.bookId === book.id ? linkProgress.fraction : undefined}
      onCancelDownload={cancelMaterialize}
      onOpen={() => void openReader(book)}
      onEdit={() => setEditingBookId(book.id)}
      onRemove={() => setRemovingBookId(book.id)}
      onDownload={() => void downloadBookFile(book)}
      onAddToGroup={() => setPickGroupBookId(book.id)}
      onRemoveFromGroup={
        book.groupId && groupById.has(book.groupId)
          ? () => {
              const group = groupById.get(book.groupId ?? '');
              if (group) void removeBookFromGroupPersisted(book);
            }
          : undefined
      }
      groupLabel={book.groupId ? (groupById.get(book.groupId)?.name ?? null) : null}
      {...bookDragProps(book)}
    />
  );

  const openFile = readerSession ? getBookFile(readerSession.book.hash) : null;
  if (videoSession) {
    return (
      <DirectionProvider dir={direction}>
        <VideoView
          book={videoSession.book}
          file={videoSession.file}
          onClose={() => setVideoSession(null)}
        />
      </DirectionProvider>
    );
  }

  if (readerSession && openFile) {
    const start = readerSession.start;
    return (
      <DirectionProvider dir={direction}>
        <ReaderView
          key={readerSession.book.id}
          book={readerSession.book}
          file={openFile}
          initialLocation={start?.locator?.kind === 'cfi' ? start.locator.cfi : null}
          initialPage={start?.locator?.kind === 'page' ? start.locator.page : null}
          initialFraction={start?.fraction ?? 0}
          onProgress={({ locator, fraction }) => {
            const state = {
              bookId: readerSession.book.id,
              locator,
              fraction,
              status: 'reading' as const,
              updatedAt: Date.now(),
            };
            saveReadingState(state);
            void persistReadingState(state);
          }}
          onClose={() => setReaderSession(null)}
        />
        {audioSession ? (
          <PlayerBar
            book={audioSession.book}
            file={audioSession.file}
            onClose={() => setAudioSession(null)}
          />
        ) : null}
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </DirectionProvider>
    );
  }

  return (
    <DirectionProvider dir={direction}>
      <main className="shell">
        <UpdateBanner />
        {audioSession ? (
          <PlayerBar
            book={audioSession.book}
            file={audioSession.file}
            onClose={() => setAudioSession(null)}
          />
        ) : null}
        <header className="topbar">
          <div className="topbar-brand">
            <h1 className="topbar-title">{t('app.title')}</h1>
            <span className="topbar-sub">{t('app.eyebrow')}</span>
          </div>

          <search className="topbar-search">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder={t('library.search')}
              aria-label={t('library.search')}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </search>

          <div className="topbar-actions">
            <button
              type="button"
              className="ghost-button is-url"
              aria-label={t('library.addFromUrl')}
              onClick={() => setUrlImportOpen(true)}
              disabled={isImporting}
            >
              {/* Phone: icon-only (the label is hidden below 48rem). */}
              <svg
                className="url-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
                <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
              </svg>
              <span className="url-label">{t('library.addFromUrl')}</span>
            </button>
            <div className="import-wrap" ref={importMenuRef}>
              <button
                type="button"
                className={isImporting ? 'import-button is-busy' : 'import-button'}
                aria-haspopup={isPhone ? undefined : 'menu'}
                aria-expanded={isPhone ? undefined : importMenuOpen}
                disabled={isImporting}
                onClick={() => {
                  if (isPhone) openFilePicker();
                  else setImportMenuOpen((open) => !open);
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="import-label">
                  {isImporting ? t('library.importing') : t('library.import')}
                </span>
                <span className="import-label-short">
                  {isImporting ? t('library.importing') : t('library.importShort')}
                </span>
              </button>
              {!isPhone && importMenuOpen ? (
                <div className="book-menu import-menu" role="menu" aria-label={t('library.import')}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      openFilePicker();
                    }}
                  >
                    {t('library.importFiles')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      openFolderPicker();
                    }}
                  >
                    {t('library.importFolder')}
                  </button>
                </div>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".epub,.pdf,.md,.markdown,.mp3,.m4b,.m4a,.flac,.ogg,.opus,.mp4,.mkv,.webm,application/epub+zip,application/pdf,text/markdown,audio/*,video/*"
              multiple
              disabled={isImporting}
              onChange={handleInputChange}
            />
            <button type="button" className="ghost-button locale-toggle" onClick={toggleLocale}>
              {t('app.switch')}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('settings.title')}
              title={t('settings.title')}
              onClick={() => setSettingsOpen(true)}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.86a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.12.62.63 1.03 1.26 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.97Z" />
              </svg>
            </button>
          </div>
        </header>

        <section
          className={[
            'library',
            isDragging ? 'is-dragging' : '',
            viewMode === 'list' ? 'is-list' : '',
            viewMode === 'shelves' ? 'is-shelves' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-labelledby="library-heading"
          aria-busy={isImporting}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <h2 id="library-heading" className="visually-hidden">
            {t('library.heading')}
          </h2>

          {folderProgress ? (
            <div className="update-banner folder-import-banner" role="status">
              <span>
                {t('library.folderImportProgress', {
                  done: numberFormat.format(folderProgress.done),
                  total: numberFormat.format(folderProgress.total),
                  name: folderProgress.name,
                })}
              </span>
              <button
                type="button"
                className="reader-action"
                onClick={() => {
                  folderCancelRef.current = true;
                }}
              >
                {t('reader.cancel')}
              </button>
            </div>
          ) : null}
          {folderNotice ? (
            <div className="update-banner folder-import-banner" role="status">
              <span>
                {t('library.folderImportImported', {
                  count: folderNotice.imported,
                  total: numberFormat.format(folderNotice.imported),
                })}
                {folderNotice.skipped > 0
                  ? ` · ${t('library.folderImportSkipped', {
                      count: folderNotice.skipped,
                      total: numberFormat.format(folderNotice.skipped),
                    })}`
                  : ''}
                {folderNotice.failed > 0
                  ? ` · ${t('library.folderImportFailed', {
                      count: folderNotice.failed,
                      total: numberFormat.format(folderNotice.failed),
                    })}`
                  : ''}
                {folderNotice.cancelled ? ` · ${t('library.folderImportCancelled')}` : ''}
              </span>
              <button type="button" className="reader-action" onClick={() => setFolderNotice(null)}>
                {t('reader.close')}
              </button>
            </div>
          ) : null}
          {folderErrorCode ? (
            <p className="error" role="alert">
              {folderErrorCode === 'EMPTY'
                ? t('library.errors.FOLDER_EMPTY')
                : t('library.errors.FOLDER_TOO_MANY')}
            </p>
          ) : null}

          <div className="library-toolbar">
            <div className="chip-rail">
              <fieldset className="filter-chips" aria-label={t('library.filters')}>
                {(
                  [
                    ['all', 'library.statusAll', statusCounts.all],
                    ['reading', 'library.statusReading', statusCounts.reading],
                    ['finished', 'library.statusFinished', statusCounts.finished],
                    ['unread', 'library.statusUnread', statusCounts.unread],
                  ] as const
                ).map(([value, key, count]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      statusFilter === value ? 'chip chip-status is-selected' : 'chip chip-status'
                    }
                    aria-pressed={statusFilter === value}
                    onClick={() => setStatusFilter(value)}
                  >
                    {t(key)}
                    <span className="chip-count">{numberFormat.format(count)}</span>
                  </button>
                ))}
                <span className="chip-divider" aria-hidden="true" />

                {(
                  [
                    ['epub', 'EPUB'],
                    ['pdf', 'PDF'],
                    ['audio', 'library.audio'],
                    ['video', 'library.video'],
                  ] as const
                )
                  .filter(([value]) => (formatCounts.get(value) ?? 0) > 0)
                  .map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={formatFilter === value ? 'chip is-selected' : 'chip'}
                      aria-pressed={formatFilter === value}
                      onClick={() => setFormatFilter(formatFilter === value ? 'all' : value)}
                    >
                      {label.startsWith('library.') ? t(label) : label}
                    </button>
                  ))}
              </fieldset>
              <span className="chip-rail-fade" aria-hidden="true" />
            </div>

            <div className="toolbar-end">
              <span className="sort-control">
                <select
                  className="sort-select"
                  aria-label={t('library.sort')}
                  value={sort}
                  onChange={(event) => setSort(event.currentTarget.value as BookSort)}
                >
                  <option value="recent">{t('library.sortRecent')}</option>
                  <option value="title">{t('library.sortTitle')}</option>
                  <option value="author">{t('library.sortAuthor')}</option>
                </select>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
              <fieldset className="view-switcher" aria-label={t('library.viewMode')}>
                {(['grid', 'list', 'shelves'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={viewMode === mode ? 'is-selected' : undefined}
                    aria-pressed={viewMode === mode}
                    aria-label={t(`library.${mode}View`)}
                    title={t(`library.${mode}View`)}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode === 'grid' ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        aria-hidden="true"
                      >
                        <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
                        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
                        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
                        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
                      </svg>
                    ) : mode === 'list' ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    ) : (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 6h4M11 6h9M4 12h4M11 12h9M4 18h16" />
                      </svg>
                    )}
                  </button>
                ))}
              </fieldset>
              {hasCategories ? (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('library.expandAll')}
                    title={t('library.expandAll')}
                    onClick={() => setCollapsedGroups([])}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M7 9l5-5 5 5" />
                      <path d="M7 15l5 5 5-5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('library.collapseAll')}
                    title={t('library.collapseAll')}
                    onClick={() => setCollapsedGroups(allGroupKeys)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M7 5l5 5 5-5" />
                      <path d="M7 19l5-5 5 5" />
                    </svg>
                  </button>
                </>
              ) : null}
              {books.length > 0 ? (
                <div className="create-actions">
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => setCategoryAction({ type: 'create', name: '' })}
                  >
                    {t('library.newCategory')}
                  </button>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => setGroupAction({ type: 'create', group: null, category: null })}
                  >
                    {t('library.newGroup')}
                  </button>
                </div>
              ) : null}
              {hasSyncProvider ? (
                <button
                  type="button"
                  className={syncState === 'failed' ? 'view-toggle is-sync-failed' : 'view-toggle'}
                  disabled={syncState === 'syncing'}
                  onClick={() => void runLibrarySync()}
                >
                  {syncState === 'syncing'
                    ? t('library.syncing')
                    : syncState === 'done'
                      ? t('library.syncDone')
                      : syncState === 'failed'
                        ? t('library.syncFailed')
                        : t('library.syncNow')}
                </button>
              ) : null}
            </div>
          </div>

          {books.length > 0 ? (
            <div className="library-filters">
              {tags.length > 0 ? (
                <fieldset className="tag-filter" aria-label={t('library.tags')}>
                  {tags.slice(0, 12).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={tagFilter.includes(tag) ? 'tag-chip is-selected' : 'tag-chip'}
                      aria-pressed={tagFilter.includes(tag)}
                      onClick={() =>
                        setTagFilter((current) =>
                          current.includes(tag)
                            ? current.filter((value) => value !== tag)
                            : [...current, tag],
                        )
                      }
                    >
                      #{tag}
                    </button>
                  ))}
                </fieldset>
              ) : null}
              {tags.length > 0 ? (
                <button type="button" className="text-button" onClick={() => setTagsOpen(true)}>
                  {t('library.manageTags')}
                </button>
              ) : null}
            </div>
          ) : null}

          {isImporting ? (
            <p className="hint" role="status">
              {t('library.importing')}
            </p>
          ) : null}
          {errorCode ? (
            <p className="error" role="alert">
              {t(`library.errors.${errorCode}`)}
            </p>
          ) : null}

          {viewMode !== 'shelves' ? (
            <ContinueReading
              items={continueItems}
              locale={locale}
              onOpen={(book) => void openReader(book)}
            />
          ) : null}

          {books.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t('library.empty')}</p>
              <p className="hint">{t('library.drop')}</p>
            </div>
          ) : (
            <div className="library-body">
              {viewMode === 'list' ? (
                <aside className="library-rail" aria-label={t('library.heading')}>
                  <p className="rail-title">{t('library.heading')}</p>
                  <ul className="rail-nav">
                    {(
                      [
                        ['all', 'library.statusAll', statusCounts.all],
                        ['reading', 'library.statusReading', statusCounts.reading],
                        ['finished', 'library.statusFinished', statusCounts.finished],
                        ['unread', 'library.statusUnread', statusCounts.unread],
                      ] as const
                    ).map(([value, key, count]) => (
                      <li key={value}>
                        <button
                          type="button"
                          aria-current={statusFilter === value}
                          onClick={() => setStatusFilter(value)}
                        >
                          {t(key)}
                          <span className="rail-count">{numberFormat.format(count)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="rail-note">{t('library.railNote')}</p>
                </aside>
              ) : null}

              <div className="library-content">
                {openGroup && openGroupContent ? (
                  <GroupView
                    group={openGroup}
                    members={openGroupContent.members}
                    subgroups={openGroupContent.children}
                    filtering={openGroupContent.filtering}
                    ancestors={groupAncestors(groups, openGroup.id)}
                    totalFiles={subtreeStats.get(openGroup.id)?.files ?? 0}
                    locale={locale}
                    primaryLabelFor={(book) =>
                      primaryActionLabel(
                        book,
                        t,
                        openingBookId === book.id,
                        fileHashes.has(book.hash),
                      )
                    }
                    percentFor={(book) => Math.round((readingStates[book.id]?.fraction ?? 0) * 100)}
                    onBack={() => setOpenGroupId(displayParentId(groups, openGroup))}
                    onNavigate={(groupId) => setOpenGroupId(groupId)}
                    onOpenBook={(book) => void openReader(book)}
                    renderSubgroup={(subgroup) => renderGroupRow(subgroup, false)}
                    onCreateSubgroup={() =>
                      setGroupAction({
                        type: 'create',
                        group: null,
                        category: openGroup.category,
                        parentId: openGroup.id,
                      })
                    }
                    onRename={() =>
                      setGroupAction({ type: 'rename', group: openGroup, category: null })
                    }
                    onAddBooks={() => setAddBooksGroupId(openGroup.id)}
                    onDelete={() =>
                      setGroupAction({ type: 'delete', group: openGroup, category: null })
                    }
                    onRemoveMember={(book) => void removeBookFromGroupPersisted(book)}
                    onReorder={(draggedId, targetId) =>
                      reorderGroupMembers(openGroup, draggedId, targetId)
                    }
                  />
                ) : visibleBooks.length === 0 && !hasVisibleGroups ? (
                  <div className="empty">
                    <p className="empty-title">{t('library.noResults')}</p>
                  </div>
                ) : viewMode === 'shelves' && !isFiltering ? (
                  <ShelvesView
                    featured={featuredItem}
                    featuredIsContinue={continueItems.length > 0}
                    upNext={upNextItems}
                    shelves={shelves}
                    locale={locale}
                    onOpen={(book) => void openReader(book)}
                    renderBook={renderShelfCard}
                  />
                ) : hasCategories ? (
                  <div className="book-groups">
                    {matchedGroups.length > 0 ? (
                      <ul className={viewMode === 'list' ? 'book-grid is-list' : 'book-grid'}>
                        {viewMode === 'list'
                          ? matchedGroups.map((group) => renderGroupRow(group))
                          : matchedGroups.map((group) => renderGroupCard(group))}
                      </ul>
                    ) : null}
                    {categoryRows.map(({ node, depth }) => {
                      const collapsed = collapsedGroups.includes(node.key);
                      // The section is a drag-and-drop target, not a control;
                      // keyboard and touch users reorder with the move buttons.
                      // Drops are accepted only between siblings.
                      return (
                        // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop target
                        <section
                          key={node.key}
                          className="book-group"
                          data-depth={depth}
                          style={
                            depth > 0
                              ? { marginInlineStart: `calc(${depth} * var(--hamesh-space-3))` }
                              : undefined
                          }
                          onDragOver={(event) => {
                            if (dragCategory === null || dragCategory === node.path) return;
                            if (
                              !siblingCategoryPaths(categoryRoots, node.path).includes(dragCategory)
                            ) {
                              return;
                            }
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (dragCategory === null || dragCategory === node.path) return;
                            reorderCategoryBefore(dragCategory, node.path);
                            setDragCategory(null);
                          }}
                        >
                          <div className="book-group-header">
                            <button
                              type="button"
                              className="book-group-toggle"
                              aria-expanded={!collapsed}
                              draggable
                              onDragStart={(event) => {
                                setDragCategory(node.path);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', node.path);
                              }}
                              onDragEnd={() => setDragCategory(null)}
                              onClick={() => toggleGroup(node.key)}
                            >
                              <span className="book-group-chevron" aria-hidden="true">
                                {collapsed ? '▸' : '▾'}
                              </span>
                              <span dir="auto">{node.name}</span>
                              <span className="book-group-count">
                                {t('library.groupCount', {
                                  count: node.total + groupsInCategory(node.path).length,
                                  total: numberFormat.format(
                                    node.total + groupsInCategory(node.path).length,
                                  ),
                                })}
                              </span>
                            </button>
                            <CategoryActionsMenu
                              onAddSubcategory={() =>
                                setCategoryAction({ type: 'create', name: '', parent: node.path })
                              }
                              onAddGroup={
                                viewMode !== 'shelves'
                                  ? () =>
                                      setGroupAction({
                                        type: 'create',
                                        group: null,
                                        category: node.path,
                                      })
                                  : undefined
                              }
                              onMoveUp={() => moveCategoryBy(node.path, -1)}
                              onMoveDown={() => moveCategoryBy(node.path, 1)}
                              onRename={() =>
                                setCategoryAction({ type: 'rename', name: node.path })
                              }
                              onDelete={() =>
                                setCategoryAction({ type: 'delete', name: node.path })
                              }
                            />
                          </div>
                          {collapsed ? null : (
                            <ul className={viewMode === 'list' ? 'book-grid is-list' : 'book-grid'}>
                              {viewMode === 'list'
                                ? groupsInCategory(node.path).map((group) => renderGroupRow(group))
                                : groupsInCategory(node.path).map((group) =>
                                    renderGroupCard(group),
                                  )}
                              {node.books.map((book) =>
                                viewMode === 'list' ? renderBookRow(book) : renderGridCard(book),
                              )}
                            </ul>
                          )}
                        </section>
                      );
                    })}
                    {uncategorizedGroup ? (
                      <section key={uncategorizedGroup.key} className="book-group">
                        <div className="book-group-header">
                          <button
                            type="button"
                            className="book-group-toggle"
                            aria-expanded={!collapsedGroups.includes(uncategorizedGroup.key)}
                            onClick={() => toggleGroup(uncategorizedGroup.key)}
                          >
                            <span className="book-group-chevron" aria-hidden="true">
                              {collapsedGroups.includes(uncategorizedGroup.key) ? '▸' : '▾'}
                            </span>
                            <span dir="auto">{t('library.uncategorized')}</span>
                            <span className="book-group-count">
                              {t('library.groupCount', {
                                count:
                                  uncategorizedGroup.books.length + groupsInCategory(null).length,
                                total: numberFormat.format(
                                  uncategorizedGroup.books.length + groupsInCategory(null).length,
                                ),
                              })}
                            </span>
                          </button>
                        </div>
                        {collapsedGroups.includes(uncategorizedGroup.key) ? null : (
                          <ul className={viewMode === 'list' ? 'book-grid is-list' : 'book-grid'}>
                            {viewMode === 'list'
                              ? groupsInCategory(null).map((group) => renderGroupRow(group))
                              : groupsInCategory(null).map((group) => renderGroupCard(group))}
                            {uncategorizedGroup.books.map((book) =>
                              viewMode === 'list' ? renderBookRow(book) : renderGridCard(book),
                            )}
                          </ul>
                        )}
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <ul className={viewMode === 'list' ? 'book-grid is-list' : 'book-grid'}>
                    {viewMode === 'list'
                      ? groupsInCategory(null).map((group) => renderGroupRow(group))
                      : groupsInCategory(null).map((group) => renderGroupCard(group))}
                    {matchedGroups.length > 0
                      ? viewMode === 'list'
                        ? matchedGroups.map((group) => renderGroupRow(group))
                        : matchedGroups.map((group) => renderGroupCard(group))
                      : null}
                    {visibleBooks.map((book) =>
                      viewMode === 'list' ? renderBookRow(book) : renderGridCard(book),
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}

          {query.trim().length >= 2 && contentMatches.length > 0 ? (
            <div className="content-matches">
              <h3>{t('library.contentMatches')}</h3>
              <ul>
                {contentMatches.map((match) => {
                  const matchBook = books.find((item) => item.id === match.bookId);
                  if (!matchBook) return null;
                  return (
                    <li key={`${match.bookId}:${match.section}`}>
                      <button type="button" onClick={() => void openReader(matchBook)}>
                        <span className="content-match-title">{matchBook.title}</span>
                        <span className="content-match-snippet" dir="auto">
                          {match.snippet}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>

        <BookOrganizationDialog
          book={editingBook}
          categories={categoryChoices}
          onSave={(organization) => {
            if (editingBook) saveOrganization(editingBook, organization);
          }}
          onClose={() => setEditingBookId(null)}
        />
        <TagsDialog
          open={tagsOpen}
          tags={tagSummaries}
          onRename={renameTag}
          onDelete={deleteTag}
          onClose={() => setTagsOpen(false)}
        />
        <PromptDialog
          open={categoryAction?.type === 'create'}
          title={categoryAction?.parent ? t('library.newSubcategory') : t('library.newCategory')}
          label={t('library.categoryName')}
          initialValue=""
          onConfirm={(name) => {
            if (categoryAction?.type === 'create') {
              createCategory(name, categoryAction.parent ?? null);
            }
            setCategoryAction(null);
          }}
          onClose={() => setCategoryAction(null)}
        />
        <PromptDialog
          open={categoryAction?.type === 'rename'}
          title={t('library.renameCategoryTitle')}
          label={t('library.categoryName')}
          initialValue={categoryAction?.name ? categoryName(categoryAction.name) : ''}
          onConfirm={(name) => {
            if (categoryAction?.type === 'rename') renameCategory(categoryAction.name, name);
            setCategoryAction(null);
          }}
          onClose={() => setCategoryAction(null)}
        />
        <ConfirmDialog
          open={categoryAction?.type === 'delete'}
          title={t('library.deleteCategoryTitle')}
          message={t('library.deleteCategoryBody', { name: categoryAction?.name ?? '' })}
          confirmLabel={t('library.removeConfirm')}
          danger
          onConfirm={() => {
            if (categoryAction?.type === 'delete') deleteCategory(categoryAction.name);
            setCategoryAction(null);
          }}
          onClose={() => setCategoryAction(null)}
        />
        <PromptDialog
          open={groupAction?.type === 'create'}
          title={groupAction?.parentId ? t('library.newSubgroup') : t('library.newGroup')}
          label={t('library.groupName')}
          initialValue=""
          onConfirm={(name) => {
            if (groupAction?.type === 'create') {
              const parentId = groupAction.parentId ?? null;
              const parent = parentId ? (groupById.get(parentId) ?? null) : null;
              const now = Date.now();
              const created: BookGroupRecord = {
                id: crypto.randomUUID(),
                name,
                category: parent?.category ?? groupAction.category,
                parentId: parent?.id ?? null,
                order: [],
                createdAt: now,
                updatedAt: now,
              };
              void (async () => {
                await persistGroup(created);
                // Appending to the parent's order keeps subgroups ordered like
                // member books; a stale parent id here is harmless.
                if (parent) {
                  await persistGroup({
                    ...parent,
                    order: withOrderId(parent.order, created.id),
                    updatedAt: Date.now(),
                  });
                }
              })();
            }
            setGroupAction(null);
          }}
          onClose={() => setGroupAction(null)}
        />
        <PromptDialog
          open={groupAction?.type === 'rename'}
          title={t('library.groupRenameTitle')}
          label={t('library.groupName')}
          initialValue={groupAction?.group?.name ?? ''}
          onConfirm={(name) => {
            if (groupAction?.type === 'rename' && groupAction.group) {
              void persistGroup({ ...groupAction.group, name, updatedAt: Date.now() });
            }
            setGroupAction(null);
          }}
          onClose={() => setGroupAction(null)}
        />
        <GroupDeleteDialog
          open={groupAction?.type === 'delete'}
          group={groupAction?.type === 'delete' ? groupAction.group : null}
          subgroupCount={
            groupAction?.type === 'delete' && groupAction.group
              ? subtreeGroupIds(groups, groupAction.group.id).length - 1
              : 0
          }
          fileCount={
            groupAction?.type === 'delete' && groupAction.group
              ? (subtreeStats.get(groupAction.group.id)?.files ?? 0)
              : 0
          }
          onConfirm={(mode) => {
            if (groupAction?.type === 'delete' && groupAction.group) {
              deleteGroupWithMode(groupAction.group, mode);
            } else {
              setGroupAction(null);
            }
          }}
          onClose={() => setGroupAction(null)}
        />
        <BookPickGroupDialog
          open={pickGroupBookId !== null}
          book={
            pickGroupBookId ? (books.find((item) => item.id === pickGroupBookId) ?? null) : null
          }
          groups={groups}
          onPick={(group) => {
            const book = pickGroupBookId
              ? (books.find((item) => item.id === pickGroupBookId) ?? null)
              : null;
            if (book) void fileBookIntoGroup(book, group);
            setPickGroupBookId(null);
          }}
          onClose={() => setPickGroupBookId(null)}
        />
        <GroupAddBooksDialog
          open={addBooksGroupId !== null}
          group={addBooksGroupId ? (groupById.get(addBooksGroupId) ?? null) : null}
          candidates={books.filter((book) => !addBooksGroupId || book.groupId !== addBooksGroupId)}
          onAdd={(book) => {
            const group = addBooksGroupId ? groupById.get(addBooksGroupId) : null;
            if (group) void fileBookIntoGroup(book, group);
          }}
          onClose={() => setAddBooksGroupId(null)}
        />
        <ConfirmDialog
          open={removingBook !== null}
          title={t('library.removeTitle')}
          message={t('library.removeBody', { title: removingBook?.title ?? '' })}
          confirmLabel={t('library.removeConfirm')}
          danger
          onConfirm={() => {
            if (removingBook) removeBookAndFile(removingBook);
            setRemovingBookId(null);
          }}
          onClose={() => setRemovingBookId(null)}
        />
        <UrlImportDialog
          open={urlImportOpen}
          onImport={(url, syncVia) => void handleUrlImport(url, syncVia)}
          onClose={() => setUrlImportOpen(false)}
        />
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </main>
    </DirectionProvider>
  );
};
