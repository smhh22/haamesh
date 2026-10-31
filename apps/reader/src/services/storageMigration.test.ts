// @vitest-environment node
import { createRequire } from 'node:module';
import { migrate, type SqlDatabase, type SqlValue } from '@hamesh/storage';
import initSqlJs, { type Database } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
});

const port = (db: Database): SqlDatabase => ({
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
});

const version = async (db: SqlDatabase): Promise<number> => {
  const rows = await db.all<{ user_version: number }>('PRAGMA user_version');
  return Number(rows[0]?.user_version ?? 0);
};

const columns = async (db: SqlDatabase): Promise<string[]> => {
  const rows = await db.all<{ name: string }>('PRAGMA table_info(books)');
  return rows.map((row) => row.name);
};

describe('storage migrations', () => {
  it('creates the current schema from scratch', async () => {
    const db = port(new SQL.Database());
    await migrate(db);

    expect(await version(db)).toBe(5);
    expect(await columns(db)).toEqual(expect.arrayContaining(['category', 'tags_json']));
    for (const table of ['sync_clocks', 'book_texts', 'sync_field_clocks']) {
      const rows = await db.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      expect(rows).toHaveLength(1);
    }
  });

  it('upgrades a v4 library without losing rows', async () => {
    const db = port(new SQL.Database());
    await migrate(db);

    // Rewind to the v4 shape: the two v5 columns and the version marker.
    db.run('ALTER TABLE books DROP COLUMN category');
    db.run('ALTER TABLE books DROP COLUMN tags_json');
    db.run('PRAGMA user_version = 4');
    db.run(
      `INSERT INTO books (id, hash, format, title, authors_json, language, publisher, series,
        identifiers_json, direction, file_path, cover_mime, added_at, updated_at)
       VALUES ('b1', 'hash-1', 'epub', 'Book', '[]', NULL, NULL, NULL, '{}', 'ltr',
        'books/hash-1.epub', NULL, 1, 1)`,
    );

    await migrate(db);

    expect(await version(db)).toBe(5);
    expect(await columns(db)).toEqual(expect.arrayContaining(['category', 'tags_json']));
    const rows = await db.all<{ title: string; category: string | null; tags_json: string }>(
      'SELECT title, category, tags_json FROM books WHERE id = ?',
      ['b1'],
    );
    expect(rows[0]).toEqual({ title: 'Book', category: null, tags_json: '[]' });
  });

  it('is idempotent when run again', async () => {
    const db = port(new SQL.Database());
    await migrate(db);
    await migrate(db);
    expect(await version(db)).toBe(5);
  });
});
