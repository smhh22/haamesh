import { HybridLogicalClock } from '@hamesh/core';
import type { DataStorePort } from '@hamesh/platform';
import type { BookNoteRecord, BookRecord, LibrarySnapshot, ReadingState } from '@hamesh/storage';
import { useLibraryStore } from '../stores/libraryStore';
import { useNotesStore } from '../stores/notesStore';
import { useReadingStore } from '../stores/readingStore';
import { rememberBookFile } from './bookFiles';
import { createDataStore } from './dataStore';
import { type ActiveStorage, createActiveStorage } from './sqlStorage';
import { getOrCreateDeviceId, stampRecordClock } from './syncStore';

const MANIFEST = 'library.json';
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

/** Reattach persisted book and cover bytes as runtime File/Blob URLs. */
const hydrateBooks = async (
  books: BookRecord[],
  dataStore: DataStorePort | null,
): Promise<BookRecord[]> => {
  if (!dataStore) return books.map((book) => ({ ...book, coverPath: null }));

  const hydrated: BookRecord[] = [];
  for (const book of books) {
    const bytes = await dataStore.read(bookPath(book.hash, book.format));
    if (!bytes) continue;

    const file = new File([toArrayBuffer(bytes)], book.filePath, {
      type: book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
    });
    rememberBookFile(book.hash, file);

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
 * Load the library. SQLite is authoritative when available; the Phase 1 JSON
 * manifest is read once for migration and kept as a fallback.
 */
export const initLibraryPersistence = async (): Promise<void> => {
  store = await createDataStore();
  const snapshot = store ? await readSnapshot(store) : null;
  if (store) {
    syncClock = new HybridLogicalClock(await getOrCreateDeviceId(store));
  }

  const sql = await createActiveStorage(snapshot);
  if (sql) {
    activeStorage = sql;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void activeStorage?.flush();
      });
    }

    const books = await sql.storage.books.list();
    const hydrated = await hydrateBooks(books, store);
    const reading = await sql.storage.reading.list();
    const notes = await sql.storage.notes.listAll();

    useLibraryStore.setState({ books: hydrated });
    useReadingStore.setState({
      states: Object.fromEntries(reading.map((state) => [state.bookId, state])),
    });
    useNotesStore.setState({ notes });
    return;
  }

  if (!snapshot) return;

  const hydrated = await hydrateBooks(snapshot.books, store);
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
    await stampRecordClock(activeStorage.clocks, syncClock, `book:${book.id}`);
  }
  await activeStorage?.flush();
  await persistNow();
};

export const deletePersistedBook = async (book: BookRecord): Promise<void> => {
  if (store) {
    await store.remove(bookPath(book.hash, book.format));
    await store.remove(coverPath(book.hash));
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
    await stampRecordClock(activeStorage.clocks, syncClock, `reading:${state.bookId}`);
  }
  schedulePersist();
};

export const persistNoteRecord = async (note: BookNoteRecord): Promise<void> => {
  await activeStorage?.storage.notes.upsert(note);
  if (activeStorage && syncClock) {
    await stampRecordClock(activeStorage.clocks, syncClock, `note:${note.id}`);
  }
  await activeStorage?.flush();
  schedulePersist();
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
