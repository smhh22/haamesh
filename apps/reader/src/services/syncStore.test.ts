import { HybridLogicalClock } from '@hamesh/core';
import type { DataStorePort } from '@hamesh/platform';
import type {
  BookNoteRecord,
  BookRecord,
  ReadingState,
  SyncClockRepository,
} from '@hamesh/storage';
import { describe, expect, it } from 'vitest';
import type { ActiveStorage } from './sqlStorage';
import { createSqlSyncStore, getOrCreateDeviceId } from './syncStore';

const createFakeDataStore = (): DataStorePort & { files: Map<string, Uint8Array> } => {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, data) {
      files.set(path, data);
    },
    async remove(path) {
      files.delete(path);
    },
    async list(dir) {
      const prefix = dir === '' ? '' : `${dir}/`;
      return [...files.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
  };
};

interface FakeRepos {
  books: Map<string, BookRecord>;
  reading: Map<string, ReadingState>;
  notes: Map<string, BookNoteRecord>;
}

const createFakeStorage = (repos: FakeRepos, clockMap: Map<string, string>): ActiveStorage => {
  const clockRepo: SyncClockRepository = {
    async list() {
      return Object.fromEntries(clockMap);
    },
    async set(entries) {
      for (const [key, hlc] of entries) clockMap.set(key, hlc);
    },
  };
  return {
    storage: {
      books: {
        async list() {
          return [...repos.books.values()];
        },
        async get(id) {
          return repos.books.get(id) ?? null;
        },
        async upsert(book) {
          repos.books.set(book.id, book);
        },
        async remove(id) {
          repos.books.delete(id);
          repos.reading.delete(id);
        },
      },
      reading: {
        async list() {
          return [...repos.reading.values()];
        },
        async get(bookId) {
          return repos.reading.get(bookId) ?? null;
        },
        async save(state) {
          repos.reading.set(state.bookId, state);
        },
      },
      notes: {
        async list(bookId: string) {
          return [...repos.notes.values()].filter((note) => note.bookId === bookId);
        },
        async listAll() {
          return [...repos.notes.values()];
        },
        async upsert(note) {
          repos.notes.set(note.id, note);
        },
      },
    },
    clocks: clockRepo,
    migrate: async () => undefined,
    migrateJson: async () => undefined,
    flush: async () => undefined,
    close: async () => undefined,
  };
};

const baseBook = (): BookRecord => ({
  id: 'b1',
  hash: 'sha-b1',
  format: 'epub',
  title: 'Original',
  authors: ['Author'],
  language: 'fa',
  publisher: null,
  series: null,
  identifiers: {},
  direction: 'rtl',
  filePath: 'books/sha-b1.epub',
  coverPath: null,
  coverMime: null,
  addedAt: 1000,
  updatedAt: 1000,
});

describe('sql sync store adapter', () => {
  it('lists books, reading state, and notes as sync records', async () => {
    const repos: FakeRepos = {
      books: new Map([['b1', baseBook()]]),
      reading: new Map([
        [
          'b1',
          {
            bookId: 'b1',
            locator: { kind: 'cfi', cfi: 'epubcfi(/6/4)', fraction: 0.5 },
            fraction: 0.5,
            status: 'reading',
            updatedAt: 1100,
          },
        ],
      ]),
      notes: new Map([
        [
          'n1',
          {
            id: 'n1',
            bookId: 'b1',
            type: 'highlight',
            locator: { kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2)', fraction: 0.5 },
            color: '#ff0',
            text: 'tt',
            note: null,
            createdAt: 1,
            updatedAt: 2,
            deletedAt: null,
          },
        ],
      ]),
    };
    const store = createSqlSyncStore(
      createFakeStorage(repos, new Map()),
      createFakeDataStore(),
      new HybridLogicalClock('device-x', () => 1),
    );
    const records = await store.list();
    const book = records.find((record) => record.kind === 'book');
    expect(book?.fields.sha256).toBe('sha-b1');
    expect(book?.fields.ext).toBe('epub');
    expect(book?.fields.direction).toBe('rtl');
    const reading = records.find((record) => record.kind === 'reading');
    expect(reading?.id).toBe('b1');
    expect(reading?.fields.fraction).toBe(0.5);
    const note = records.find((record) => record.kind === 'note');
    expect(note?.fields.text).toBe('tt');
    expect(note?.deleted).toBe(false);
  });

  it('merges remote book fields into the existing record without clobbering others', async () => {
    const repos: FakeRepos = {
      books: new Map([['b1', baseBook()]]),
      reading: new Map(),
      notes: new Map(),
    };
    const store = createSqlSyncStore(
      createFakeStorage(repos, new Map()),
      createFakeDataStore(),
      new HybridLogicalClock('device-x', () => 1),
    );
    await store.apply({
      id: 'b1',
      kind: 'book',
      fields: { title: 'Updated', sha256: 'sha-b1', ext: 'epub' },
      deleted: false,
      updatedAt: 0,
    });
    const book = repos.books.get('b1');
    expect(book?.title).toBe('Updated');
    expect(book?.authors).toEqual(['Author']);
    expect(book?.language).toBe('fa');
    expect(book?.filePath).toBe('books/sha-b1.epub');
  });

  it('creates a book record from remote fields when it does not exist locally', async () => {
    const repos: FakeRepos = { books: new Map(), reading: new Map(), notes: new Map() };
    const store = createSqlSyncStore(
      createFakeStorage(repos, new Map()),
      createFakeDataStore(),
      new HybridLogicalClock('device-x', () => 1),
    );
    await store.apply({
      id: 'remote-1',
      kind: 'book',
      fields: {
        title: 'From Cloud',
        sha256: 'sha-r1',
        ext: 'pdf',
        authors: ['A', 'B'],
        direction: 'ltr',
      },
      deleted: false,
      updatedAt: 0,
    });
    const book = repos.books.get('remote-1');
    expect(book?.title).toBe('From Cloud');
    expect(book?.format).toBe('pdf');
    expect(book?.filePath).toBe('books/sha-r1.pdf');
    expect(book?.direction).toBe('ltr');
  });

  it('removes the local book when a tombstone arrives', async () => {
    const repos: FakeRepos = {
      books: new Map([['b1', baseBook()]]),
      reading: new Map(),
      notes: new Map(),
    };
    repos.reading.set('b1', {
      bookId: 'b1',
      locator: null,
      fraction: 0.1,
      status: 'reading',
      updatedAt: 1,
    });
    const store = createSqlSyncStore(
      createFakeStorage(repos, new Map()),
      createFakeDataStore(),
      new HybridLogicalClock('device-x', () => 1),
    );
    await store.apply({ id: 'b1', kind: 'book', fields: {}, deleted: true, updatedAt: 0 });
    expect(repos.books.has('b1')).toBe(false);
  });

  it('applies remote reading state and note tombstones', async () => {
    const repos: FakeRepos = { books: new Map(), reading: new Map(), notes: new Map() };
    const store = createSqlSyncStore(
      createFakeStorage(repos, new Map()),
      createFakeDataStore(),
      new HybridLogicalClock('device-x', () => 1),
    );
    await store.apply({
      id: 'b1',
      kind: 'reading',
      fields: {
        locator: { kind: 'page', page: 3, fraction: 0.7 },
        fraction: 0.7,
        status: 'reading',
      },
      deleted: false,
      updatedAt: 0,
    });
    expect(repos.reading.get('b1')?.fraction).toBe(0.7);
    expect(repos.reading.get('b1')?.locator).toEqual({ kind: 'page', page: 3, fraction: 0.7 });

    await store.apply({
      id: 'n1',
      kind: 'note',
      fields: { bookId: 'b1', text: 'hi' },
      deleted: false,
      updatedAt: 0,
    });
    expect(repos.notes.get('n1')?.text).toBe('hi');
    await store.apply({ id: 'n1', kind: 'note', fields: {}, deleted: true, updatedAt: 0 });
    expect(repos.notes.get('n1')?.deletedAt).not.toBeNull();
  });

  it('round-trips book blobs through the data store', async () => {
    const dataStore = createFakeDataStore();
    const store = createSqlSyncStore(
      createFakeStorage({ books: new Map(), reading: new Map(), notes: new Map() }, new Map()),
      dataStore,
      new HybridLogicalClock('device-x', () => 1),
    );
    expect(await store.bookFile('sha-x')).toBeNull();
    await store.saveBookFile('sha-x', 'epub', new Uint8Array([9, 8, 7]));
    const file = await store.bookFile('sha-x');
    expect(file?.ext).toBe('epub');
    expect([...(file?.data ?? [])]).toEqual([9, 8, 7]);
  });

  it('exposes book tombstones from the clock table as deleted records', async () => {
    const clockMap = new Map([['book:gone:deleted', '0000000000001-00000000-device-a']]);
    const store = createSqlSyncStore(
      createFakeStorage({ books: new Map(), reading: new Map(), notes: new Map() }, clockMap),
      createFakeDataStore(),
      new HybridLogicalClock('device-x', () => 1),
    );
    const records = await store.list();
    const tombstone = records.find((record) => record.kind === 'book' && record.id === 'gone');
    expect(tombstone?.deleted).toBe(true);
  });

  it('persists and reuses a stable device id', async () => {
    const dataStore = createFakeDataStore();
    const first = await getOrCreateDeviceId(dataStore);
    const second = await getOrCreateDeviceId(dataStore);
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  });
});
