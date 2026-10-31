import type { Direction } from '@hamesh/core';
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
import { BookOrganizationDialog } from './components/BookOrganizationDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PromptDialog } from './components/PromptDialog';
import { ReaderView } from './components/ReaderView';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { type TagSummary, TagsDialog } from './components/TagsDialog';
import { UpdateBanner } from './components/UpdateBanner';
import { type BookSort, type BookView, filterAndSortBooks } from './library/bookList';
import { forgetBookFile, getBookFile } from './services/bookFiles';
import {
  type ContentMatch,
  removeBookTexts,
  searchBookContent,
  storeBookTexts,
} from './services/bookTexts';
import { importBookFile } from './services/importBook';
import {
  deletePersistedBook,
  loadBookFile,
  persistBook,
  persistBookOrganization,
  persistReadingState,
} from './services/libraryPersistence';
import { useLibraryStore } from './stores/libraryStore';
import { useReadingStore } from './stores/readingStore';
import { type UiLocale as Locale, useUiStore } from './stores/uiStore';

const directionFor = (locale: Locale): Direction => (locale === 'fa' ? 'rtl' : 'ltr');

const isSupportedBook = (file: File): boolean =>
  file.type === 'application/epub+zip' ||
  file.type === 'application/pdf' ||
  file.type === 'text/markdown' ||
  /\.(epub|pdf|md|markdown)$/i.test(file.name);

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
  const setLocale = useUiStore((state) => state.setLocale);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorCode, setErrorCode] = useState<
    ImportErrorCode | 'UNKNOWN' | 'BOOK_FILE_MISSING' | 'OPEN_FAILED' | null
  >(null);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null | undefined>(undefined);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [removingBookId, setRemovingBookId] = useState<string | null>(null);
  const [categoryAction, setCategoryAction] = useState<'rename' | 'delete' | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [sort, setSort] = useState<BookSort>('recent');
  const [viewMode, setViewMode] = useState<BookView>('grid');
  const [contentMatches, setContentMatches] = useState<ContentMatch[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [readerSession, setReaderSession] = useState<{
    book: BookRecord;
    start: ReadingState | null;
  } | null>(null);
  const books = useLibraryStore((state) => state.books);
  const updateBook = useLibraryStore((state) => state.updateBook);
  const categories = useMemo(
    () =>
      [
        ...new Set(
          books.map((book) => book.category).filter((value): value is string => Boolean(value)),
        ),
      ].sort((a, b) => new Intl.Collator(locale).compare(a, b)),
    [books, locale],
  );
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
  const visibleBooks = useMemo(
    () =>
      filterAndSortBooks(
        books,
        query,
        sort,
        new Intl.Collator(locale, { sensitivity: 'base', numeric: true }),
        { category: categoryFilter, tags: tagFilter },
      ),
    [books, query, sort, locale, categoryFilter, tagFilter],
  );
  const direction = directionFor(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    void i18n.changeLanguage(locale);
  }, [direction, i18n, locale]);

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

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const saveOrganization = (
    book: BookRecord,
    organization: { category: string | null; tags: string[] },
  ) => {
    updateBook(book.id, organization);
    setEditingBookId(null);
    void persistBookOrganization(book, organization);
  };

  const renameCategory = (from: string, to: string) => {
    if (to === from) return;
    for (const book of books.filter((item) => item.category === from)) {
      const organization = { category: to, tags: book.tags };
      updateBook(book.id, organization);
      void persistBookOrganization(book, organization);
    }
    setCategoryFilter(to);
  };

  const deleteCategory = (name: string) => {
    for (const book of books.filter((item) => item.category === name)) {
      const organization = { category: null, tags: book.tags };
      updateBook(book.id, organization);
      void persistBookOrganization(book, organization);
    }
    setCategoryFilter(undefined);
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
      const file = await loadBookFile(book);
      if (!file) {
        setErrorCode('BOOK_FILE_MISSING');
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

  const openFile = readerSession ? getBookFile(readerSession.book.hash) : null;
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
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </DirectionProvider>
    );
  }

  return (
    <DirectionProvider dir={direction}>
      <main className="shell">
        <UpdateBanner />
        <header className="masthead">
          <div>
            <p className="eyebrow">{t('app.eyebrow')}</p>
            <h1>{t('app.title')}</h1>
            <p className="lede">{t('app.lede')}</p>
          </div>
          <div className="masthead-actions">
            <button type="button" className="locale-toggle" onClick={toggleLocale}>
              {t('app.switch')}
            </button>
            <button
              type="button"
              className="locale-toggle"
              aria-label={t('settings.title')}
              onClick={() => setSettingsOpen(true)}
            >
              {t('settings.open')}
            </button>
          </div>
        </header>

        <section
          className={isDragging ? 'library is-dragging' : 'library'}
          aria-labelledby="library-heading"
          aria-busy={isImporting}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="library-header">
            <h2 id="library-heading">{t('library.heading')}</h2>
            <label className="import-button">
              {t('library.import')}
              <input
                className="visually-hidden"
                type="file"
                accept=".epub,.pdf,.md,.markdown,application/epub+zip,application/pdf,text/markdown"
                multiple
                disabled={isImporting}
                onChange={handleInputChange}
              />
            </label>
          </div>

          <div className="library-tools">
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder={t('library.search')}
              aria-label={t('library.search')}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
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
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode((mode) => (mode === 'grid' ? 'list' : 'grid'))}
            >
              {viewMode === 'grid' ? t('library.listView') : t('library.gridView')}
            </button>
          </div>

          {books.length > 0 ? (
            <div className="library-filters">
              <label className="filter-label" htmlFor="category-filter">
                {t('library.categories')}
              </label>
              <select
                id="category-filter"
                className="sort-select"
                value={categoryFilter === undefined ? '__all__' : (categoryFilter ?? '__none__')}
                onChange={(event) => {
                  const value = event.target.value;
                  setCategoryFilter(
                    value === '__all__' ? undefined : value === '__none__' ? null : value,
                  );
                }}
              >
                <option value="__all__">{t('library.allCategories')}</option>
                <option value="__none__">{t('library.uncategorized')}</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {typeof categoryFilter === 'string' ? (
                <div className="category-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setCategoryAction('rename')}
                  >
                    {t('library.renameCategory')}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setCategoryAction('delete')}
                  >
                    {t('library.deleteCategory')}
                  </button>
                </div>
              ) : null}
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

          {books.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t('library.empty')}</p>
              <p className="hint">{t('library.drop')}</p>
            </div>
          ) : visibleBooks.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t('library.noResults')}</p>
            </div>
          ) : (
            <ul className={viewMode === 'list' ? 'book-grid is-list' : 'book-grid'}>
              {visibleBooks.map((book) => (
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
                    <p className="badges">
                      <span className="badge">
                        {book.direction === 'rtl' ? t('library.rtl') : t('library.ltr')}
                      </span>
                      <span className="badge">{book.language ?? t('library.unknownLanguage')}</span>
                    </p>
                    <div className="book-actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={openingBookId !== null}
                        onClick={() => void openReader(book)}
                      >
                        {openingBookId === book.id ? t('library.opening') : t('library.read')}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setEditingBookId(book.id)}
                      >
                        {t('library.edit')}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setRemovingBookId(book.id)}
                      >
                        {t('library.remove')}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
          categories={categories}
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
          open={categoryAction === 'rename' && typeof categoryFilter === 'string'}
          title={t('library.renameCategoryTitle')}
          label={t('library.categoryName')}
          initialValue={typeof categoryFilter === 'string' ? categoryFilter : ''}
          onConfirm={(name) => {
            if (typeof categoryFilter === 'string') renameCategory(categoryFilter, name);
            setCategoryAction(null);
          }}
          onClose={() => setCategoryAction(null)}
        />
        <ConfirmDialog
          open={categoryAction === 'delete' && typeof categoryFilter === 'string'}
          title={t('library.deleteCategoryTitle')}
          message={t('library.deleteCategoryBody', {
            name: typeof categoryFilter === 'string' ? categoryFilter : '',
          })}
          confirmLabel={t('library.removeConfirm')}
          danger
          onConfirm={() => {
            if (typeof categoryFilter === 'string') deleteCategory(categoryFilter);
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
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </main>
    </DirectionProvider>
  );
};
