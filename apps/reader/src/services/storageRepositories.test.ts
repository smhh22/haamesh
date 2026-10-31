// @vitest-environment node
import { createRequire } from 'node:module';
import {
  type BookNoteRecord,
  type BookRecord,
  createSqlStorage,
  createSyncClockRepository,
  type LibrarySnapshot,
  migrate,
  migrateJsonSnapshot,
  type SqlDatabase,
  type SqlValue,
} from '@hamesh/storage';
import initSqlJs, { type Database } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
});

const openDb = async (): Promise<SqlDatabase> => {
  const db = new SQL.Database();
  const port: SqlDatabase = {
    async exec(sql) {
      db.run(sql);
    },
    async run(sql, params = []) {
      db.run(sql, params);
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      const statement = db.prepare(sql);
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      statement.free();
      return rows;
    },
  };
  await migrate(port);
  return port;
};

const book = (overrides: Partial<BookRecord> = {}): BookRecord => ({
  id: 'book-1',
  hash: 'a'.repeat(64),
  format: 'epub',
  title: 'کتاب نمونه',
  authors: ['نویسنده'],
  language: 'fa',
  publisher: null,
  series: null,
  identifiers: { isbn: '978-0' },
  direction: 'rtl',
  category: 'تاریخ',
  tags: ['ایران', 'تاریخ'],
  filePath: 'sample.epub',
  coverPath: null,
  coverMime: 'image/jpeg',
  addedAt: 1,
  updatedAt: 2,
  ...overrides,
});

describe('SQL repositories', () => {
  it('round-trips books including category and tags', async () => {
    const storage = createSqlStorage(await openDb());
    await storage.books.upsert(book());

    const loaded = await storage.books.get('book-1');
    expect(loaded).toMatchObject({
      id: 'book-1',
      title: 'کتاب نمونه',
      authors: ['نویسنده'],
      direction: 'rtl',
      category: 'تاریخ',
      tags: ['ایران', 'تاریخ'],
      identifiers: { isbn: '978-0' },
      coverMime: 'image/jpeg',
    });
    expect(loaded?.coverPath).toBeNull();

    await storage.books.upsert(book({ category: null, tags: [], title: 'ویرایش' }));
    const updated = await storage.books.get('book-1');
    expect(updated?.title).toBe('ویرایش');
    expect(updated?.category).toBeNull();
    expect(updated?.tags).toEqual([]);
    expect(await storage.books.list()).toHaveLength(1);
  });

  it('removes a book together with its reading state and notes', async () => {
    const storage = createSqlStorage(await openDb());
    await storage.books.upsert(book());
    await storage.reading.save({
      bookId: 'book-1',
      locator: { kind: 'cfi', cfi: 'epubcfi(/6/2)', fraction: 0.25 },
      fraction: 0.25,
      status: 'reading',
      updatedAt: 3,
    });
    await storage.notes.upsert({
      id: 'note-1',
      bookId: 'book-1',
      type: 'highlight',
      locator: { kind: 'cfi', cfi: 'epubcfi(/6/4)', fraction: 0.5 },
      color: 'yellow',
      text: 'متن',
      note: null,
      createdAt: 4,
      updatedAt: 4,
      deletedAt: null,
    });

    await storage.books.remove('book-1');

    expect(await storage.books.get('book-1')).toBeNull();
    expect(await storage.reading.get('book-1')).toBeNull();
    expect(await storage.notes.list('book-1')).toEqual([]);
  });

  it('round-trips reading state with and without a locator', async () => {
    const storage = createSqlStorage(await openDb());
    await storage.reading.save({
      bookId: 'book-1',
      locator: { kind: 'page', page: 7, fraction: 0.5 },
      fraction: 0.5,
      status: 'reading',
      updatedAt: 5,
    });
    await storage.reading.save({
      bookId: 'book-2',
      locator: null,
      fraction: 0,
      status: 'unread',
      updatedAt: 6,
    });

    expect(await storage.reading.get('book-1')).toMatchObject({
      locator: { kind: 'page', page: 7 },
      fraction: 0.5,
      status: 'reading',
    });
    expect((await storage.reading.get('book-2'))?.locator).toBeNull();
    expect(await storage.reading.list()).toHaveLength(2);
  });

  it('round-trips notes and keeps soft-deleted rows', async () => {
    const storage = createSqlStorage(await openDb());
    const note: BookNoteRecord = {
      id: 'note-1',
      bookId: 'book-1',
      type: 'note',
      locator: { kind: 'cfi', cfi: 'epubcfi(/6/8)', fraction: 0.75 },
      color: null,
      text: 'نقل‌قول',
      note: 'یادداشت من',
      createdAt: 7,
      updatedAt: 8,
      deletedAt: null,
    };
    await storage.notes.upsert(note);
    await storage.notes.upsert({ ...note, id: 'note-2', deletedAt: 9 });

    expect(await storage.notes.list('book-1')).toHaveLength(2);
    expect(await storage.notes.listAll()).toHaveLength(2);
    const deleted = await storage.notes.listAll();
    expect(deleted.find((item) => item.id === 'note-2')?.deletedAt).toBe(9);
    expect(deleted.find((item) => item.id === 'note-1')?.note).toBe('یادداشت من');
  });

  it('searches extracted text across Arabic/Persian letter variants', async () => {
    const storage = createSqlStorage(await openDb());
    await storage.texts.replace('book-1', ['فصل نخست دربارهٔ كتاب', '']);
    await storage.texts.replace('book-2', ['فصل دوم']);

    expect(await storage.texts.has('book-1')).toBe(true);
    expect(await storage.texts.has('book-3')).toBe(false);

    const matches = await storage.texts.search('کتاب');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.bookId).toBe('book-1');
    expect(matches[0]?.snippet).toContain('كتاب');

    await storage.texts.remove('book-1');
    expect(await storage.texts.has('book-1')).toBe(false);
  });

  it('stores record and per-field clocks and can drop a tombstone', async () => {
    const clocks = createSyncClockRepository(await openDb());
    await clocks.set([
      ['book:book-1', '0001:0'],
      ['book:book-2:deleted', '0002:0'],
    ]);
    await clocks.set([['book:book-1', '0003:0']]);
    await clocks.setFields([
      ['book:book-1', 'title', '0004:0'],
      ['book:book-1', 'tags', '0005:0'],
    ]);

    expect(await clocks.list()).toEqual({
      'book:book-1': '0003:0',
      'book:book-2:deleted': '0002:0',
    });
    expect(await clocks.listFields()).toEqual({
      'book:book-1': { title: '0004:0', tags: '0005:0' },
    });

    await clocks.remove(['book:book-2:deleted']);
    expect(await clocks.list()).toEqual({ 'book:book-1': '0003:0' });
  });
});

describe('JSON manifest migration', () => {
  const note: BookNoteRecord = {
    id: 'note-1',
    bookId: 'book-1',
    type: 'highlight',
    locator: { kind: 'cfi', cfi: 'epubcfi(/6/4)', fraction: 0.5 },
    color: 'yellow',
    text: 'متن',
    note: null,
    createdAt: 4,
    updatedAt: 4,
    deletedAt: null,
  };

  const snapshot = (books: BookRecord[]): LibrarySnapshot => ({
    version: 1,
    books,
    reading: {
      'book-1': {
        bookId: 'book-1',
        locator: { kind: 'cfi', cfi: 'epubcfi(/6/2)', fraction: 0.1 },
        fraction: 0.1,
        status: 'reading',
        updatedAt: 3,
      },
    },
    notes: [note],
  });

  it('imports books, reading state, and notes exactly once', async () => {
    const db = await openDb();
    const storage = createSqlStorage(db);
    await migrateJsonSnapshot(db, snapshot([book()]));

    expect(await storage.books.list()).toHaveLength(1);
    expect(await storage.reading.list()).toHaveLength(1);
    expect(await storage.notes.listAll()).toHaveLength(1);

    // The marker makes the import one-way; a later snapshot is ignored.
    await migrateJsonSnapshot(
      db,
      snapshot([book({ id: 'book-2', hash: 'b'.repeat(64), title: 'دیگر' })]),
    );
    expect(await storage.books.list()).toHaveLength(1);
  });

  it('rolls back and can retry after a failed import', async () => {
    const db = await openDb();
    const storage = createSqlStorage(db);
    // Two rows share the unique hash, so the second insert aborts the import.
    await expect(
      migrateJsonSnapshot(db, snapshot([book(), book({ id: 'book-2' })])),
    ).rejects.toThrow();

    expect(await storage.books.list()).toEqual([]);
    expect(await storage.notes.listAll()).toEqual([]);

    // The marker rolled back with the transaction, so a valid snapshot imports.
    await migrateJsonSnapshot(db, snapshot([book()]));
    expect(await storage.books.list()).toHaveLength(1);
  });
});
