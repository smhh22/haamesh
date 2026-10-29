import type { Direction, Locator, ReadingStatus } from '@hamesh/core';
import type {
  BookNoteRecord,
  BookRecord,
  BookRepository,
  LibrarySnapshot,
  NoteRepository,
  ReadingState,
  ReadingStateRepository,
  Storage,
} from './index';

export type SqlValue = string | number | null | Uint8Array;

/** Thin SQL port implemented by Tauri (rusqlite) and web (sql.js). */
export interface SqlDatabase {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL,
  language TEXT,
  publisher TEXT,
  series TEXT,
  identifiers_json TEXT NOT NULL,
  direction TEXT NOT NULL,
  file_path TEXT NOT NULL,
  cover_mime TEXT,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reading (
  book_id TEXT PRIMARY KEY,
  locator_json TEXT,
  fraction REAL NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  type TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  fraction REAL NOT NULL,
  color TEXT,
  text TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS notes_book ON notes(book_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
`;

export const migrate = async (db: SqlDatabase): Promise<void> => {
  const rows = await db.all<{ user_version: number }>('PRAGMA user_version');
  const version = Number(rows[0]?.user_version ?? 0);
  if (version < 1) await db.exec(SCHEMA);
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const parseLocator = (value: unknown): Locator | null =>
  value == null ? null : parseJson<Locator | null>(value, null);

const mapBook = (row: Record<string, unknown>): BookRecord => ({
  id: String(row.id ?? ''),
  hash: String(row.hash ?? ''),
  format: row.format === 'pdf' ? 'pdf' : 'epub',
  title: String(row.title ?? ''),
  authors: parseJson<string[]>(row.authors_json, []),
  language: row.language == null ? null : String(row.language),
  publisher: row.publisher == null ? null : String(row.publisher),
  series: row.series == null ? null : String(row.series),
  identifiers: parseJson<Record<string, string>>(row.identifiers_json, {}),
  direction: (row.direction === 'rtl' ? 'rtl' : 'ltr') as Direction,
  filePath: String(row.file_path ?? ''),
  coverPath: null,
  coverMime: row.cover_mime == null ? null : String(row.cover_mime),
  addedAt: Number(row.added_at ?? 0),
  updatedAt: Number(row.updated_at ?? 0),
});

const mapReading = (row: Record<string, unknown>): ReadingState => ({
  bookId: String(row.book_id ?? ''),
  locator: parseLocator(row.locator_json),
  fraction: Number(row.fraction ?? 0),
  status: (row.status === 'finished' || row.status === 'unread'
    ? row.status
    : 'reading') as ReadingStatus,
  updatedAt: Number(row.updated_at ?? 0),
});

const mapNote = (row: Record<string, unknown>): BookNoteRecord => ({
  id: String(row.id ?? ''),
  bookId: String(row.book_id ?? ''),
  type: (row.type === 'bookmark' || row.type === 'note'
    ? row.type
    : 'highlight') as BookNoteRecord['type'],
  locator: parseLocator(row.locator_json) ?? { kind: 'cfi', cfi: '', fraction: 0 },
  color: row.color == null ? null : String(row.color),
  text: row.text == null ? null : String(row.text),
  note: row.note == null ? null : String(row.note),
  createdAt: Number(row.created_at ?? 0),
  updatedAt: Number(row.updated_at ?? 0),
  deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
});

const createBookRepository = (db: SqlDatabase): BookRepository => ({
  async list() {
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM books ORDER BY added_at DESC',
    );
    return rows.map(mapBook);
  },

  async get(id) {
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM books WHERE id = ?', [id]);
    const row = rows[0];
    return row ? mapBook(row) : null;
  },

  async upsert(book) {
    await db.run(
      `INSERT INTO books (
        id, hash, format, title, authors_json, language, publisher, series,
        identifiers_json, direction, file_path, cover_mime, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        hash = excluded.hash, format = excluded.format, title = excluded.title,
        authors_json = excluded.authors_json, language = excluded.language,
        publisher = excluded.publisher, series = excluded.series,
        identifiers_json = excluded.identifiers_json, direction = excluded.direction,
        file_path = excluded.file_path, cover_mime = excluded.cover_mime,
        added_at = excluded.added_at, updated_at = excluded.updated_at`,
      [
        book.id,
        book.hash,
        book.format,
        book.title,
        JSON.stringify(book.authors),
        book.language,
        book.publisher,
        book.series,
        JSON.stringify(book.identifiers),
        book.direction,
        book.filePath,
        book.coverMime ?? null,
        book.addedAt,
        book.updatedAt,
      ],
    );
  },

  async remove(id) {
    await db.run('DELETE FROM reading WHERE book_id = ?', [id]);
    await db.run('DELETE FROM notes WHERE book_id = ?', [id]);
    await db.run('DELETE FROM books WHERE id = ?', [id]);
  },
});

const createReadingRepository = (db: SqlDatabase): ReadingStateRepository => ({
  async list() {
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM reading ORDER BY updated_at DESC',
    );
    return rows.map(mapReading);
  },

  async get(bookId) {
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM reading WHERE book_id = ?', [
      bookId,
    ]);
    const row = rows[0];
    return row ? mapReading(row) : null;
  },

  async save(state) {
    await db.run(
      `INSERT INTO reading (book_id, locator_json, fraction, status, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         locator_json = excluded.locator_json, fraction = excluded.fraction,
         status = excluded.status, updated_at = excluded.updated_at`,
      [
        state.bookId,
        state.locator ? JSON.stringify(state.locator) : null,
        state.fraction,
        state.status,
        state.updatedAt,
      ],
    );
  },
});

const createNoteRepository = (db: SqlDatabase): NoteRepository => ({
  async list(bookId) {
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM notes WHERE book_id = ? ORDER BY created_at ASC',
      [bookId],
    );
    return rows.map(mapNote);
  },

  async listAll() {
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM notes ORDER BY created_at ASC',
    );
    return rows.map(mapNote);
  },

  async upsert(note) {
    await db.run(
      `INSERT INTO notes (
        id, book_id, type, locator_json, fraction, color, text, note,
        created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        book_id = excluded.book_id, type = excluded.type,
        locator_json = excluded.locator_json, fraction = excluded.fraction,
        color = excluded.color, text = excluded.text, note = excluded.note,
        created_at = excluded.created_at, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at`,
      [
        note.id,
        note.bookId,
        note.type,
        JSON.stringify(note.locator),
        note.locator.fraction,
        note.color,
        note.text,
        note.note,
        note.createdAt,
        note.updatedAt,
        note.deletedAt,
      ],
    );
  },
});

export const createSqlStorage = (db: SqlDatabase): Storage => ({
  books: createBookRepository(db),
  reading: createReadingRepository(db),
  notes: createNoteRepository(db),
});

/** One-way import of the Phase 1 JSON manifest into SQLite. */
export const migrateJsonSnapshot = async (
  db: SqlDatabase,
  snapshot: LibrarySnapshot,
): Promise<void> => {
  const marker = await db.all<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'json_migrated'",
  );
  if (marker[0]?.value === '1') return;

  const storage = createSqlStorage(db);
  await db.exec('BEGIN');
  try {
    for (const book of snapshot.books) await storage.books.upsert(book);
    for (const state of Object.values(snapshot.reading ?? {})) {
      await storage.reading.save(state);
    }
    for (const note of snapshot.notes ?? []) await storage.notes.upsert(note);
    await db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('json_migrated', '1')");
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
};
