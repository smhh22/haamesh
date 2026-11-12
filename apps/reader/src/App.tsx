import type { Direction, ReadingStatus } from '@hamesh/core';
import {
  categoryName,
  categoryParent,
  categoryPathOf,
  isCategoryInSubtree,
  sanitizeCategoryName,
} from '@hamesh/core';
import { ImportError, type ImportErrorCode } from '@hamesh/engine';
import type { BookRecord, ReadingState } from '@hamesh/storage';
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
import { BookRow } from './components/library/BookRow';
import { CategoryActionsMenu } from './components/library/CategoryActionsMenu';
import { type ContinueItem, ContinueReading } from './components/library/ContinueReading';
import { PromptDialog } from './components/PromptDialog';
import { ReaderView } from './components/ReaderView';
import { PlayerBar } from './components/reader/PlayerBar';
import { VideoView } from './components/reader/VideoView';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { type TagSummary, TagsDialog } from './components/TagsDialog';
import { UpdateBanner } from './components/UpdateBanner';
import { UrlImportDialog } from './components/UrlImportDialog';
import { type BookSort, filterAndSortBooks, groupBooksByCategory } from './library/bookList';
import {
  buildCategoryTree,
  collectCategoryPaths,
  findCategoryNode,
  flattenCategoryPaths,
  siblingCategoryPaths,
} from './library/categoryTree';
import { forgetBookFile, getBookFile } from './services/bookFiles';
import {
  type ContentMatch,
  removeBookTexts,
  searchBookContent,
  storeBookTexts,
} from './services/bookTexts';
import {
  importBookFile,
  importBookFromUrl,
  UrlImportError,
  type UrlSyncMode,
} from './services/importBook';
import {
  deletePersistedBook,
  listBookHashes,
  loadBookFile,
  persistBook,
  persistBookOrganization,
  persistReadingState,
} from './services/libraryPersistence';
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

const formatAuthors = (authors: string[], locale: Locale): string => {
  if (authors.length === 0) return '';
  try {
    return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(authors);
  } catch {
    return authors.join(locale === 'fa' ? '، ' : ', ');
  }
};

export const App = () => {
  const { t, i18n } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  // Card progress and dates use the active locale's digits (fa-IR → Persian).
  const percentFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const setLocale = useUiStore((state) => state.setLocale);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorCode, setErrorCode] = useState<
    | ImportErrorCode
    | 'UNKNOWN'
    | 'BOOK_FILE_MISSING'
    | 'OPEN_FAILED'
    | 'URL_INVALID'
    | 'URL_FAILED'
    | 'DOWNLOAD_FAILED'
    | null
  >(null);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  // Books whose bytes exist locally (ADR-0020); synced rounds deliver records
  // and covers only, so a remote-known book starts without its file.
  const [fileHashes, setFileHashes] = useState<Set<string>>(() => new Set());
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);
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
  const readingStates = useReadingStore((state) => state.states);
  const updateBook = useLibraryStore((state) => state.updateBook);

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
  const extraCategories = useUiStore((state) => state.extraCategories);
  const addExtraCategory = useUiStore((state) => state.addExtraCategory);
  const renameExtraCategory = useUiStore((state) => state.renameExtraCategory);
  const removeExtraCategory = useUiStore((state) => state.removeExtraCategory);
  const order = useUiStore((state) => state.categoryOrder);
  const setCategoryOrder = useUiStore((state) => state.setCategoryOrder);
  const renameCategoryOrder = useUiStore((state) => state.renameCategoryOrder);
  const purgeCategoryOrder = useUiStore((state) => state.purgeCategoryOrder);
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
  const visibleBooks = useMemo(
    () => filterAndSortBooks(filteredBooks, query, sort, collator, { tags: tagFilter }),
    [filteredBooks, query, sort, collator, tagFilter],
  );
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
        .filter((state) => state.status === 'reading' && state.fraction > 0)
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
  const categoryRoots = useMemo(
    () => (hasCategories ? buildCategoryTree(visibleBooks, extraCategories, order, collator) : []),
    [hasCategories, visibleBooks, extraCategories, order, collator],
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
    void handleFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  /** Add a book from a link (ADR-0019); the sync mode was chosen in the dialog. */
  const handleUrlImport = async (url: string, syncVia: UrlSyncMode) => {
    setUrlImportOpen(false);
    setIsImporting(true);
    setErrorCode(null);
    try {
      const imported = await importBookFromUrl(url, syncVia);
      addBook(imported.record);
      await persistBook(imported.record, imported.file, imported.cover);
      void storeBookTexts(imported.record.id, imported.file);
    } catch (error) {
      setErrorCode(
        error instanceof UrlImportError
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

  const openReader = async (book: BookRecord) => {
    if (openingRef.current) return;
    openingRef.current = book.id;
    setOpeningBookId(book.id);
    setErrorCode(null);
    try {
      // A freshly imported book still sits in the runtime cache; the derived
      // set may lag one render behind, so the cache check comes first.
      let file = getBookFile(book.hash);
      if (!file && fileHashes.has(book.hash)) {
        file = await loadBookFile(book);
      }
      if (!file) {
        // On-demand download (ADR-0020): opening a remote-known book fetches
        // its bytes first, then opens it. With no provider configured there is
        // nothing to fetch from, so fall through to the missing-file report.
        const result = await downloadBook(book);
        if (result.ok) {
          setFileHashes((current) => new Set(current).add(book.hash));
          file = await loadBookFile(book);
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
      if (book.format === 'audio') {
        setAudioSession({ book, file });
        return;
      }
      if (book.format === 'video') {
        setVideoSession({ book, file });
        return;
      }
      setReaderSession({
        book,
        start: useReadingStore.getState().states[book.id] ?? null,
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

  const renderGridCard = (book: BookRecord) => {
    // Reading progress comes from the reading store, not the record; the card
    // only shows it once the book has actually been opened.
    const fraction = readingStates[book.id]?.fraction ?? 0;
    return (
      <li key={book.id} className="book-card">
        <div className="cover">
          {book.coverPath ? (
            <img src={book.coverPath} alt="" />
          ) : (
            <span className="cover-fallback" aria-hidden="true">
              {book.title.trim().charAt(0) || '?'}
            </span>
          )}
        </div>
        <div className="book-body">
          <h3 dir="auto">{book.title}</h3>
          <p className="authors" dir="auto">
            {formatAuthors(book.authors, locale) || t('library.unknownAuthor')}
          </p>
          {/* Direction is the book's own business, not a badge; language only
             shows when the file actually carries one. The row follows the
             book's direction so the chips line up under the dir="auto" title. */}
          {fraction > 0 || book.language ? (
            <p className="badges" dir={book.direction}>
              {fraction > 0 ? (
                <span className="badge is-progress">
                  {t('library.progress', {
                    percent: percentFormat.format(Math.round(fraction * 100)),
                  })}
                </span>
              ) : null}
              {book.language ? <span className="badge">{book.language}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="book-actions">
          <button
            type="button"
            className="text-button"
            disabled={openingBookId !== null}
            onClick={() => void openReader(book)}
          >
            {openingBookId === book.id
              ? fileHashes.has(book.hash)
                ? t('library.opening')
                : t('library.downloading')
              : book.format === 'audio'
                ? t('library.listen')
                : book.format === 'video'
                  ? t('library.watch')
                  : t('library.read')}
          </button>
          {!fileHashes.has(book.hash) ? (
            <button
              type="button"
              className="text-button"
              disabled={downloadingHash !== null || openingBookId !== null}
              onClick={() => void downloadBookFile(book)}
            >
              {downloadingHash === book.hash ? t('library.downloading') : t('library.download')}
            </button>
          ) : null}
          <button type="button" className="text-button" onClick={() => setEditingBookId(book.id)}>
            {t('library.edit')}
          </button>
          <button type="button" className="text-button" onClick={() => setRemovingBookId(book.id)}>
            {t('library.remove')}
          </button>
        </div>
      </li>
    );
  };

  const renderBookRow = (book: BookRecord) => (
    <BookRow
      key={book.id}
      book={book}
      locale={locale}
      fraction={readingStates[book.id]?.fraction ?? 0}
      hasFile={fileHashes.has(book.hash)}
      opening={openingBookId === book.id}
      downloading={downloadingHash === book.hash}
      onOpen={() => void openReader(book)}
      onEdit={() => setEditingBookId(book.id)}
      onRemove={() => setRemovingBookId(book.id)}
      onDownload={() => void downloadBookFile(book)}
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
              onClick={() => setUrlImportOpen(true)}
              disabled={isImporting}
            >
              {t('library.addFromUrl')}
            </button>
            <label className={isImporting ? 'import-button is-busy' : 'import-button'}>
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
              <input
                className="visually-hidden"
                type="file"
                accept=".epub,.pdf,.md,.markdown,.mp3,.m4b,.m4a,.flac,.ogg,.opus,.mp4,.mkv,.webm,application/epub+zip,application/pdf,text/markdown,audio/*,video/*"
                multiple
                disabled={isImporting}
                onChange={handleInputChange}
              />
            </label>
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

          <div className="library-toolbar">
            <fieldset className="filter-chips chip-status" aria-label={t('library.statusFilter')}>
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
                  className={statusFilter === value ? 'chip is-selected' : 'chip'}
                  aria-pressed={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                >
                  {t(key)}
                  <span className="chip-count">{numberFormat.format(count)}</span>
                </button>
              ))}
            </fieldset>

            <fieldset className="filter-chips is-formats" aria-label={t('library.formatFilter')}>
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

            <div className="toolbar-end">
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
              <button
                type="button"
                className="view-toggle"
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              >
                {viewMode === 'grid' ? t('library.listView') : t('library.gridView')}
              </button>
              {books.length > 0 ? (
                <button
                  type="button"
                  className="view-toggle"
                  onClick={() => setCategoryAction({ type: 'create', name: '' })}
                >
                  {t('library.newCategory')}
                </button>
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

          <ContinueReading
            items={continueItems}
            locale={locale}
            onOpen={(book) => void openReader(book)}
          />

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
                {visibleBooks.length === 0 ? (
                  <div className="empty">
                    <p className="empty-title">{t('library.noResults')}</p>
                  </div>
                ) : hasCategories ? (
                  <div className="book-groups">
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
                                  count: node.total,
                                  total: numberFormat.format(node.total),
                                })}
                              </span>
                            </button>
                            <CategoryActionsMenu
                              onAddSubcategory={() =>
                                setCategoryAction({ type: 'create', name: '', parent: node.path })
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
                                count: uncategorizedGroup.books.length,
                                total: numberFormat.format(uncategorizedGroup.books.length),
                              })}
                            </span>
                          </button>
                        </div>
                        {collapsedGroups.includes(uncategorizedGroup.key) ? null : (
                          <ul className={viewMode === 'list' ? 'book-grid is-list' : 'book-grid'}>
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
