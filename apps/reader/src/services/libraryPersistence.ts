import type { DataStorePort } from '@hamesh/platform';
import type { BookRecord, LibrarySnapshot } from '@hamesh/storage';
import { useLibraryStore } from '../stores/libraryStore';
import { useReadingStore } from '../stores/readingStore';
import { rememberBookFile } from './bookFiles';
import { createDataStore } from './dataStore';

const MANIFEST = 'library.json';
let store: DataStorePort | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const bookPath = (hash: string): string => `books/${hash}.epub`;
const coverPath = (hash: string): string => `covers/${hash}`;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
};

/** Load the persisted library, if this platform has a data store. */
export const initLibraryPersistence = async (): Promise<void> => {
  store = await createDataStore();
  if (!store) return;

  const raw = await store.read(MANIFEST);
  if (!raw) return;

  let snapshot: LibrarySnapshot;
  try {
    snapshot = JSON.parse(new TextDecoder().decode(raw)) as LibrarySnapshot;
  } catch {
    return;
  }
  if (snapshot.version !== 1) return;

  const books: BookRecord[] = [];
  for (const book of snapshot.books) {
    const bytes = await store.read(bookPath(book.hash));
    if (!bytes) continue;

    const file = new File([toArrayBuffer(bytes)], book.filePath, {
      type: 'application/epub+zip',
    });
    rememberBookFile(book.hash, file);

    const coverBytes = await store.read(coverPath(book.hash));
    const runtimeCover = coverBytes
      ? URL.createObjectURL(
          new Blob([toArrayBuffer(coverBytes)], { type: book.coverMime ?? 'image/jpeg' }),
        )
      : null;

    books.push({ ...book, coverPath: runtimeCover, coverMime: book.coverMime ?? null });
  }

  useLibraryStore.setState({ books });
  useReadingStore.setState({ states: snapshot.reading ?? {} });
};

const persistNow = async (): Promise<void> => {
  if (!store) return;
  const snapshot: LibrarySnapshot = {
    version: 1,
    books: useLibraryStore.getState().books.map((book) => ({ ...book, coverPath: null })),
    reading: useReadingStore.getState().states,
  };
  await store.write(MANIFEST, new TextEncoder().encode(JSON.stringify(snapshot)));
};

/** Write a newly imported book's bytes and cover, then commit the manifest. */
export const persistBook = async (
  book: BookRecord,
  file: File,
  cover: Blob | null,
): Promise<void> => {
  if (!store) return;

  const bytes = new Uint8Array(await file.arrayBuffer());
  await store.write(bookPath(book.hash), bytes);

  if (cover) {
    await store.write(coverPath(book.hash), new Uint8Array(await cover.arrayBuffer()));
  }

  await persistNow();
};

export const deletePersistedBook = async (book: BookRecord): Promise<void> => {
  if (!store) return;
  await store.remove(bookPath(book.hash));
  await store.remove(coverPath(book.hash));
  await persistNow();
};

/** Debounced save for reading-state changes. */
export const schedulePersist = (): void => {
  if (!store) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow();
  }, 400);
};
