import type { Direction, Locator, ReadingStatus } from '@hamesh/core';
import { normalizeForSearch } from '@hamesh/core';
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
PRAGMA user_version = 4;
`;

const BOOK_TEXTS_TABLE = `CREATE TABLE IF NOT EXISTS book_texts (
  book_id TEXT NOT NULL,
  section INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (book_id, section)
);`;

// ADR-0011: per-field clocks. Record-level clocks stay for legacy rows,
// bootstrap, and remove-wins tombstones.
const SYNC_FIELD_CLOCKS_TABLE = `CREATE TABLE IF NOT EXISTS sync_field_clocks (
  record_key TEXT NOT NULL,
  field TEXT NOT NULL,
  hlc TEXT NOT NULL,
  PRIMARY KEY (record_key, field)
);`;

const SYNC_CLOCKS_TABLE = `CREATE TABLE IF NOT EXISTS sync_clocks (
  key TEXT PRIMARY KEY,
  hlc TEXT NOT NULL
);`;

export const migrate = async (db: SqlDatabase): Promise<void> => {
  const rows = await db.all<{ user_version: number }>('PRAGMA user_version');
  const version = Number(rows[0]?.user_version ?? 0);
  if (version < 1) await db.exec(SCHEMA);
  // v2 adds the per-record sync clock table (ADR-0006).
  if (version < 2) {
    await db.exec(SYNC_CLOCKS_TABLE);
    await db.exec('PRAGMA user_version = 2');
  }
  // v3 adds per-section extracted book text for content search.
  if (version < 3) {
    await db.exec(BOOK_TEXTS_TABLE);
    await db.exec('PRAGMA user_version = 3');
  }
  // v4 adds per-field sync clocks (ADR-0011).
  if (version < 4) {
    await db.exec(SYNC_FIELD_CLOCKS_TABLE);
    await db.exec('PRAGMA user_version = 4');
  }
  // v5 adds user categories and tags (ADR-0012). Check the columns first so a
  // crash between the ALTERs cannot wedge the next start; the whole step is
  // idempotent.
  if (version < 5) {
    const columns = await db.all<{ name: string }>('PRAGMA table_info(books)');
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('category')) await db.exec('ALTER TABLE books ADD COLUMN category TEXT');
    if (!names.has('tags_json')) {
      await db.exec("ALTER TABLE books ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
    }
    await db.exec('PRAGMA user_version = 5');
  }
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
  category: row.category == null ? null : String(row.category),
  tags: parseJson<string[]>(row.tags_json, []).filter((tag) => typeof tag === 'string'),
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
        identifiers_json, direction, category, tags_json, file_path, cover_mime,
        added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        hash = excluded.hash, format = excluded.format, title = excluded.title,
        authors_json = excluded.authors_json, language = excluded.language,
        publisher = excluded.publisher, series = excluded.series,
        identifiers_json = excluded.identifiers_json, direction = excluded.direction,
        category = excluded.category, tags_json = excluded.tags_json,
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
        book.category ?? null,
        JSON.stringify(book.tags ?? []),
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
  texts: createContentTextRepository(db),
});

/**
 * Per-section extracted book text for library content search. Stored in v3
 * (`book_texts`); search filters in JS so Persian normalization matches the
 * library filter exactly and no server-side FTS is needed at this scale.
 */
export interface ContentTextRepository {
  replace(bookId: string, sections: string[]): Promise<void>;
  remove(bookId: string): Promise<void>;
  /** True when extracted text exists for the book (used by sync reconciliation). */
  has(bookId: string): Promise<boolean>;
  search(
    query: string,
    limit?: number,
  ): Promise<Array<{ bookId: string; section: number; snippet: string }>>;
}

const SNIPPET_RADIUS = 70;

/**
 * Pure content-search core (unit-tested): normalize both sides with
 * {@link normalizeForSearch}, keep only rows whose normalized text contains
 * the needle, and cut a snippet from the original text around the match.
 */
export const searchBookTexts = (
  rows: Array<{ bookId: string; section: number; content: string }>,
  query: string,
  limit: number,
): Array<{ bookId: string; section: number; snippet: string }> => {
  const needle = normalizeForSearch(query.trim());
  // Single-character queries would flood the results; require two.
  if (needle.length < 2) return [];
  const out: Array<{ bookId: string; section: number; snippet: string }> = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    const normalized = normalizeForSearch(row.content);
    const index = normalized.indexOf(needle);
    if (index < 0) continue;
    // Normalization is length-preserving for the folded characters, so the
    // normalized index maps onto the original text for the snippet window.
    const start = Math.max(0, index - SNIPPET_RADIUS);
    const end = Math.min(row.content.length, index + needle.length + SNIPPET_RADIUS);
    const snippet = `${start > 0 ? '…' : ''}${row.content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < row.content.length ? '…' : ''}`;
    out.push({ bookId: row.bookId, section: row.section, snippet });
  }
  return out;
};

export const createContentTextRepository = (db: SqlDatabase): ContentTextRepository => ({
  async replace(bookId, sections) {
    await db.run('DELETE FROM book_texts WHERE book_id = ?', [bookId]);
    for (const [section, content] of sections.entries()) {
      if (!content) continue;
      await db.run('INSERT INTO book_texts (book_id, section, content) VALUES (?, ?, ?)', [
        bookId,
        section,
        content,
      ]);
    }
  },

  async remove(bookId) {
    await db.run('DELETE FROM book_texts WHERE book_id = ?', [bookId]);
  },

  async has(bookId: string) {
    const rows = await db.all<{ present: number }>(
      'SELECT 1 AS present FROM book_texts WHERE book_id = ? LIMIT 1',
      [bookId],
    );
    return rows.length > 0;
  },

  async search(query, limit = 20) {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const rows = await db.all<{ book_id: string; section: number; content: string }>(
      'SELECT book_id, section, content FROM book_texts',
    );
    return searchBookTexts(
      rows.map((row) => ({ bookId: row.book_id, section: row.section, content: row.content })),
      trimmed,
      limit,
    );
  },
});

/**
 * Per-record sync clocks (ADR-0006): `${kind}:${id}` -> packed HLC. The app
 * stamps on local writes, the sync engine stamps with the pulled timestamp on
 * remote applies. A `:deleted` suffix marks tombstones for records whose rows
 * are gone.
 */
export interface SyncClockRepository {
  /** Record-level clocks: legacy rows, bootstrap, and `:deleted` tombstones. */
  list(): Promise<Record<string, string>>;
  set(entries: Array<readonly [string, string]>): Promise<void>;
  /** Per-field clocks (ADR-0011): record key -> field -> packed HLC. */
  listFields(): Promise<Record<string, Record<string, string>>>;
  setFields(entries: Array<readonly [string, string, string]>): Promise<void>;
  /** Drop record-level clocks (used to clear a tombstone on re-import). */
  remove(keys: string[]): Promise<void>;
}

export const createSyncClockRepository = (db: SqlDatabase): SyncClockRepository => ({
  async list() {
    const rows = await db.all<{ key: string; hlc: string }>('SELECT key, hlc FROM sync_clocks');
    return Object.fromEntries(rows.map((row) => [row.key, row.hlc]));
  },
  async set(entries) {
    for (const [key, hlc] of entries) {
      await db.run(
        'INSERT INTO sync_clocks (key, hlc) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET hlc = excluded.hlc',
        [key, hlc],
      );
    }
  },
  async listFields() {
    const rows = await db.all<{ record_key: string; field: string; hlc: string }>(
      'SELECT record_key, field, hlc FROM sync_field_clocks',
    );
    const out: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      const bucket = out[row.record_key] ?? {};
      bucket[row.field] = row.hlc;
      out[row.record_key] = bucket;
    }
    return out;
  },
  async setFields(entries) {
    for (const [key, field, hlc] of entries) {
      await db.run(
        'INSERT INTO sync_field_clocks (record_key, field, hlc) VALUES (?, ?, ?) ON CONFLICT(record_key, field) DO UPDATE SET hlc = excluded.hlc',
        [key, field, hlc],
      );
    }
  },
  async remove(keys) {
    for (const key of keys) {
      await db.run('DELETE FROM sync_clocks WHERE key = ?', [key]);
    }
  },
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
