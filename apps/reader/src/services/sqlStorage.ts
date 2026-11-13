import type { DataStorePort } from '@hamesh/platform';
import {
  createDictionaryCacheRepository,
  createSqlStorage,
  createSyncClockRepository,
  createTranslationCacheRepository,
  type DictionaryCacheRepository,
  type LibrarySnapshot,
  migrate,
  migrateJsonSnapshot,
  type SqlDatabase,
  type SqlValue,
  type Storage,
  type SyncClockRepository,
  type TranslationCacheRepository,
} from '@hamesh/storage';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createDataStore, isTauriRuntime } from './dataStore';

export interface ActiveStorage {
  storage: Storage;
  clocks: SyncClockRepository;
  /** Device-local translation cache (ADR-0016); never synced. */
  translationCache: TranslationCacheRepository;
  /** Device-local dictionary cache (ADR-0024); never synced. */
  dictionaryCache: DictionaryCacheRepository;
  migrate: () => Promise<void>;
  migrateJson: (snapshot: LibrarySnapshot) => Promise<void>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

const createTauriDatabase = async (): Promise<{
  db: SqlDatabase;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}> => {
  const { invoke } = await import('@tauri-apps/api/core');

  return {
    db: {
      async exec(sql) {
        await invoke('db_execute_batch', { sql });
      },
      async run(sql, params = []) {
        await invoke('db_execute', { sql, params });
      },
      async all<T>(sql: string, params: SqlValue[] = []) {
        const rows = await invoke<Array<Record<string, unknown>>>('db_select', { sql, params });
        return rows as T[];
      },
    },
    flush: async () => undefined,
    close: async () => undefined,
  };
};

const createWebDatabase = async (
  store: DataStorePort,
): Promise<{
  db: SqlDatabase;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}> => {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const existing = await store.read('hamesh.db');
  const database = existing ? new SQL.Database(existing) : new SQL.Database();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await store.write('hamesh.db', database.export());
  };

  const scheduleFlush = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void store.write('hamesh.db', database.export());
    }, 300);
  };

  return {
    db: {
      async exec(sql) {
        database.exec(sql);
        scheduleFlush();
      },
      async run(sql, params = []) {
        database.run(sql, params as never);
        scheduleFlush();
      },
      async all<T>(sql: string, params: SqlValue[] = []) {
        const statement = database.prepare(sql);
        statement.bind(params as never);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        statement.free();
        return rows;
      },
    },
    flush,
    close: async () => {
      await flush();
      database.close();
    },
  };
};

const buildActiveStorage = async (
  db: SqlDatabase,
  flush: () => Promise<void>,
  close: () => Promise<void>,
  snapshot: LibrarySnapshot | null,
): Promise<ActiveStorage> => {
  await migrate(db);
  if (snapshot) await migrateJsonSnapshot(db, snapshot);
  await flush();

  return {
    storage: createSqlStorage(db),
    clocks: createSyncClockRepository(db),
    translationCache: createTranslationCacheRepository(db),
    dictionaryCache: createDictionaryCacheRepository(db),
    migrate: () => migrate(db),
    migrateJson: (value) => migrateJsonSnapshot(db, value),
    flush,
    close,
  };
};

/**
 * SQLite on desktop (rusqlite) and sql.js with OPFS on web. Returns null when
 * neither environment is available; callers then keep the JSON path.
 */
export const createActiveStorage = async (
  snapshot: LibrarySnapshot | null,
): Promise<ActiveStorage | null> => {
  if (isTauriRuntime()) {
    const { db, flush, close } = await createTauriDatabase();
    return buildActiveStorage(db, flush, close, snapshot);
  }

  const store = await createDataStore();
  if (!store) return null;

  const { db, flush, close } = await createWebDatabase(store);
  return buildActiveStorage(db, flush, close, snapshot);
};
