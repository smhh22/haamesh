import type { Direction } from '@hamesh/core';
import { HybridLogicalClock } from '@hamesh/core';
import type { DataStorePort } from '@hamesh/platform';
import type { BookNoteRecord, BookRecord, LibrarySnapshot, ReadingState } from '@hamesh/storage';
import { useLibraryStore } from '../stores/libraryStore';
import { useNotesStore } from '../stores/notesStore';
import { useReadingStore } from '../stores/readingStore';
import { cachedBookHashes, getBookFile, rememberBookFile } from './bookFiles';
import { createDataStore } from './dataStore';
import { type ActiveStorage, createActiveStorage } from './sqlStorage';
import { markStartup } from './startupTrace';
import { getOrCreateDeviceId, stampFieldClocks, stampRecordClock } from './syncStore';

const MANIFEST = 'library.json';

/** Wire field names written by persistBook / persistNoteRecord (ADR-0011). */
const BOOK_SYNC_FIELDS = [
  'title',
  'authors',
  'language',
  'publisher',
  'series',
  'identifiers',
  'direction',
  'category',
  'tags',
  'sha256',
  'ext',
] as const;
const NOTE_SYNC_FIELDS = ['bookId', 'type', 'locator', 'color', 'text', 'note'] as const;
let store: DataStorePort | null = null;
let activeStorage: ActiveStorage | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let syncClock: HybridLogicalClock | null = null;

const bookPath = (hash: string, format: BookRecord['format']): string => `books/${hash}.${format}`;
const coverPath = (hash: string): string => `covers/${hash}`;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
};

const readSnapshot = async (dataStore: DataStorePort): Promise<LibrarySnapshot | null> => {
  const raw = await dataStore.read(MANIFEST);
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(new TextDecoder().decode(raw)) as LibrarySnapshot;
    return snapshot.version === 1 ? snapshot : null;
  } catch {
    return null;
  }
};

/** Reattach persisted covers as runtime blob URLs. Book bytes load on open. */
const hydrateCovers = async (
  books: BookRecord[],
  dataStore: DataStorePort | null,
): Promise<BookRecord[]> => {
  if (!dataStore) return books.map((book) => ({ ...book, coverPath: null }));

  const hydrated: BookRecord[] = [];
  for (const book of books) {
    const coverBytes = await dataStore.read(coverPath(book.hash));
    const runtimeCover = coverBytes
      ? URL.createObjectURL(
          new Blob([toArrayBuffer(coverBytes)], { type: book.coverMime ?? 'image/jpeg' }),
        )
      : null;

    hydrated.push({ ...book, coverPath: runtimeCover, coverMime: book.coverMime ?? null });
  }
  return hydrated;
};

/**
 * Read a book's bytes the first time it is opened. Opening every book at
 * startup meant large PDFs crossed the IPC bridge and sat in memory even when
 * the reader never opened them.
 */
export const loadBookFile = async (book: BookRecord): Promise<File | null> => {
  const cached = getBookFile(book.hash);
  if (cached) return cached;
  if (!store) return null;
  const bytes = await store.read(bookPath(book.hash, book.format));
  if (!bytes) return null;
  const file = new File([toArrayBuffer(bytes)], book.filePath, {
    type: book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
  });
  rememberBookFile(book.hash, file);
  return file;
};

/**
 * Hashes whose bytes exist locally — the device-local "downloaded" state of
 * ADR-0020, derived from one directory listing plus the runtime cache (a
 * freshly imported book has a file before it is ever written to the store).
 */
export const listBookHashes = async (): Promise<Set<string>> => {
  const hashes = cachedBookHashes();
  if (!store) return hashes;
  const names = await store.list('books');
  for (const name of names) {
    const hash = (name.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
    if (/^[0-9a-f]{64}$/.test(hash)) hashes.add(hash);
  }
  return hashes;
};

/**
 * Load the library. SQLite is authoritative when available; the Phase 1 JSON
 * manifest is read once for migration and kept as a fallback.
 */
export const initLibraryPersistence = async (): Promise<void> => {
  markStartup('data-store-opening');
  store = await createDataStore();
  markStartup('data-store-open');
  const snapshot = store ? await readSnapshot(store) : null;
  if (store) {
    syncClock = new HybridLogicalClock(await getOrCreateDeviceId(store));
  }

  const sql = await createActiveStorage(snapshot);
  markStartup('sql-storage-open');
  if (sql) {
    activeStorage = sql;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void activeStorage?.flush();
      });
    }

    await reloadLibraryFromStorage();
    markStartup('library-loaded');
    return;
  }

  if (!snapshot) return;

  const hydrated = await hydrateCovers(snapshot.books, store);
  useLibraryStore.setState({ books: hydrated });
  useReadingStore.setState({ states: snapshot.reading ?? {} });
  useNotesStore.setState({ notes: snapshot.notes ?? [] });
};

const persistNow = async (): Promise<void> => {
  if (!store) return;
  const snapshot: LibrarySnapshot = {
    version: 1,
    books: useLibraryStore.getState().books.map((book) => ({ ...book, coverPath: null })),
    reading: useReadingStore.getState().states,
    notes: useNotesStore.getState().notes,
  };
  await store.write(MANIFEST, new TextEncoder().encode(JSON.stringify(snapshot)));
};

/** Write a newly imported book's bytes and cover, then commit both stores. */
export const persistBook = async (
  book: BookRecord,
  file: File,
  cover: Blob | null,
): Promise<void> => {
  if (store) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await store.write(bookPath(book.hash, book.format), bytes);

    if (cover) {
      await store.write(coverPath(book.hash), new Uint8Array(await cover.arrayBuffer()));
    }
  }

  await activeStorage?.storage.books.upsert(book);
  if (activeStorage && syncClock) {
    // Re-importing a previously deleted file revives it locally: drop the
    // record-level tombstone so the next sync does not delete it again.
    await activeStorage.clocks.remove([`book:${book.id}:deleted`]);
    await stampFieldClocks(activeStorage.clocks, syncClock, `book:${book.id}`, BOOK_SYNC_FIELDS);
  }
  await activeStorage?.flush();
  await persistNow();
};

/**
 * Persist a book details edit (ADR-0013, plus language/direction overrides).
 * Only the fields present in `organization` are stamped, so a concurrent
 * progress write on another device is not clobbered.
 */
export const persistBookOrganization = async (
  book: BookRecord,
  organization: {
    title?: string;
    authors?: string[];
    series?: string | null;
    publisher?: string | null;
    category: string | null;
    tags: string[];
    language?: string | null;
    direction?: Direction;
  },
): Promise<void> => {
  const updated: BookRecord = { ...book, ...organization, updatedAt: Date.now() };
  await activeStorage?.storage.books.upsert(updated);
  if (activeStorage && syncClock) {
    const stamped: string[] = ['category', 'tags'];
    if (organization.language !== undefined) stamped.push('language');
    if (organization.direction !== undefined) stamped.push('direction');
    if (organization.title !== undefined) stamped.push('title');
    if (organization.authors !== undefined) stamped.push('authors');
    if (organization.series !== undefined) stamped.push('series');
    if (organization.publisher !== undefined) stamped.push('publisher');
    await stampFieldClocks(activeStorage.clocks, syncClock, `book:${book.id}`, stamped);
  }
  await activeStorage?.flush();
  // The JSON manifest remains the reload fallback; keep it in step.
  await persistNow();
};

/**
 * Persist a detected (or manually edited) language and direction. Only those
 * two fields are stamped, so a concurrent progress write on another device is
 * not clobbered.
 */
export const persistBookLanguage = async (
  book: BookRecord,
  language: string,
  direction: Direction,
): Promise<void> => {
  const updated: BookRecord = { ...book, language, direction, updatedAt: Date.now() };
  await activeStorage?.storage.books.upsert(updated);
  if (activeStorage && syncClock) {
    await stampFieldClocks(activeStorage.clocks, syncClock, `book:${book.id}`, [
      'language',
      'direction',
    ]);
  }
  await activeStorage?.flush();
  // The JSON manifest remains the reload fallback; keep it in step.
  await persistNow();
};

export const deletePersistedBook = async (book: BookRecord): Promise<void> => {
  if (store) {
    await store.remove(bookPath(book.hash, book.format));
    await store.remove(coverPath(book.hash));
  }
  // Tombstone the book's notes before the cascade removes their rows, so a
  // later pull cannot resurrect them as orphans (ADR-0006 remove-wins).
  if (activeStorage && syncClock) {
    const notes = (await activeStorage.storage.notes.listAll()).filter(
      (note) => note.bookId === book.id && note.deletedAt === null,
    );
    for (const note of notes) {
      await activeStorage.storage.notes.upsert({ ...note, deletedAt: Date.now() });
      await stampFieldClocks(activeStorage.clocks, syncClock, `note:${note.id}`, NOTE_SYNC_FIELDS);
      await stampRecordClock(activeStorage.clocks, syncClock, `note:${note.id}:deleted`);
    }
  }
  await activeStorage?.storage.books.remove(book.id);
  if (activeStorage && syncClock) {
    // The row is gone; the tombstone lives in the clock table (ADR-0006).
    await stampRecordClock(activeStorage.clocks, syncClock, `book:${book.id}:deleted`);
  }
  await activeStorage?.flush();
  await persistNow();
};

export const persistReadingState = async (state: ReadingState): Promise<void> => {
  await activeStorage?.storage.reading.save(state);
  if (activeStorage && syncClock) {
    await stampFieldClocks(activeStorage.clocks, syncClock, `book:${state.bookId}`, [
      'reading.locator',
      'reading.fraction',
      'reading.status',
    ]);
  }
  schedulePersist();
};

export const persistNoteRecord = async (note: BookNoteRecord): Promise<void> => {
  await activeStorage?.storage.notes.upsert(note);
  if (activeStorage && syncClock) {
    await stampFieldClocks(activeStorage.clocks, syncClock, `note:${note.id}`, NOTE_SYNC_FIELDS);
    if (note.deletedAt !== null) {
      await stampRecordClock(activeStorage.clocks, syncClock, `note:${note.id}:deleted`);
    }
  }
  await activeStorage?.flush();
  schedulePersist();
};

/**
 * Rehydrate the in-memory stores from SQLite. Called after init and after a
 * sync round that pulled changes — otherwise SQL writes never reach the UI.
 */
export const reloadLibraryFromStorage = async (): Promise<void> => {
  if (!activeStorage) return;
  const books = await activeStorage.storage.books.list();
  const hydrated = await hydrateCovers(books, store);
  const reading = await activeStorage.storage.reading.list();
  const notes = await activeStorage.storage.notes.listAll();
  // Covers are replaced on every reload; release the previous blob URLs or a
  // long session leaks one cover per book per sync round.
  for (const book of useLibraryStore.getState().books) {
    if (book.coverPath?.startsWith('blob:')) URL.revokeObjectURL(book.coverPath);
  }
  useLibraryStore.setState({ books: hydrated });
  useReadingStore.setState({
    states: Object.fromEntries(reading.map((state) => [state.bookId, state])),
  });
  useNotesStore.setState({ notes });
};

/** Runtime accessors for the sync service (null before init or on JSON fallback). */
export const getActiveStorage = (): ActiveStorage | null => activeStorage;
export const getSyncClock = (): HybridLogicalClock | null => syncClock;

/** Debounced JSON backup for reading-state and note changes. */
export const schedulePersist = (): void => {
  if (!store) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow();
  }, 400);
};
