/**
 * App-side SyncStore adapter: bridges the provider-agnostic sync engine to
 * SQLite storage, the content-addressed data store, and the per-record sync
 * clocks. Local writes must stamp the clock (see SyncStore contract) — the
 * persistence layer calls `stampRecordClock` for that.
 */
import type { HybridLogicalClock, Locator, ReadingStatus } from '@hamesh/core';
import type { DataStorePort } from '@hamesh/platform';
import type { BookNoteRecord, BookRecord } from '@hamesh/storage';
import type { SyncRecord, SyncStore } from '@hamesh/sync';
import type { ActiveStorage } from './sqlStorage';

const clockFor = (clock: HybridLogicalClock): string => clock.now();

/** Stamp (or overwrite) the sync clock of one record after a local write. */
export const stampRecordClock = async (
  clocks: ActiveStorage['clocks'],
  clock: HybridLogicalClock,
  key: string,
): Promise<void> => {
  await clocks.set([[key, clockFor(clock)]]);
};

/** ADR-0011: stamp exactly the fields a local write touches. */
export const stampFieldClocks = async (
  clocks: ActiveStorage['clocks'],
  clock: HybridLogicalClock,
  key: string,
  fields: readonly string[],
): Promise<void> => {
  await clocks.setFields(fields.map((field) => [key, field, clockFor(clock)] as const));
};

const isLocator = (value: unknown): value is Locator =>
  typeof value === 'object' && value !== null && 'kind' in value;

export const createSqlSyncStore = (
  activeStorage: ActiveStorage,
  dataStore: DataStorePort,
): SyncStore => {
  const { storage, clocks } = activeStorage;

  const listBooks = async (): Promise<SyncRecord[]> => {
    const books = await storage.books.list();
    return books.map((book) => ({
      id: book.id,
      kind: 'book',
      fields: {
        title: book.title,
        authors: book.authors,
        language: book.language,
        publisher: book.publisher,
        series: book.series,
        identifiers: book.identifiers,
        direction: book.direction,
        sha256: book.hash,
        ext: book.format,
      },
      deleted: false,
      updatedAt: book.updatedAt,
    }));
  };

  const listReading = async (): Promise<SyncRecord[]> => {
    const states = await storage.reading.list();
    return states.map((state) => ({
      id: state.bookId,
      kind: 'reading',
      fields: { locator: state.locator, fraction: state.fraction, status: state.status },
      deleted: false,
      updatedAt: state.updatedAt,
    }));
  };

  const listNotes = async (): Promise<SyncRecord[]> => {
    const notes = await storage.notes.listAll();
    return notes.map((note) => ({
      id: note.id,
      kind: 'note',
      fields: {
        bookId: note.bookId,
        type: note.type,
        locator: note.locator,
        color: note.color,
        text: note.text,
        note: note.note,
      },
      deleted: note.deletedAt !== null,
      updatedAt: note.updatedAt,
    }));
  };

  /** Books deleted locally keep only a `book:<id>:deleted` clock tombstone. */
  const listBookTombstones = async (live: Set<string>): Promise<SyncRecord[]> => {
    const all = await clocks.list();
    const out: SyncRecord[] = [];
    for (const key of Object.keys(all)) {
      const match = /^book:([^:]+):deleted$/.exec(key);
      if (match?.[1] && !live.has(match[1])) {
        out.push({ id: match[1], kind: 'book', fields: {}, deleted: true, updatedAt: 0 });
      }
    }
    return out;
  };

  return {
    async list() {
      const books = await listBooks();
      const live = new Set(books.map((book) => book.id));
      const tombstones = await listBookTombstones(live);
      return [...books, ...(await listReading()), ...(await listNotes()), ...tombstones];
    },

    async apply(record) {
      const now = Date.now();
      if (record.kind === 'book') {
        const existing = await storage.books.get(record.id);
        const fields = record.fields as Record<string, unknown>;
        const hash =
          typeof fields.sha256 === 'string'
            ? fields.sha256
            : (existing?.hash ?? `sync-${record.id}`);
        const format = fields.ext === 'pdf' ? 'pdf' : 'epub';
        const book: BookRecord = {
          id: record.id,
          hash,
          format,
          title: typeof fields.title === 'string' ? fields.title : (existing?.title ?? record.id),
          authors: Array.isArray(fields.authors)
            ? (fields.authors as string[])
            : (existing?.authors ?? []),
          language:
            typeof fields.language === 'string' ? fields.language : (existing?.language ?? null),
          publisher:
            typeof fields.publisher === 'string' ? fields.publisher : (existing?.publisher ?? null),
          series: typeof fields.series === 'string' ? fields.series : (existing?.series ?? null),
          identifiers:
            typeof fields.identifiers === 'object' && fields.identifiers !== null
              ? (fields.identifiers as Record<string, string>)
              : (existing?.identifiers ?? {}),
          direction: fields.direction === 'rtl' ? 'rtl' : 'ltr',
          filePath: existing?.filePath ?? `books/${hash}.${format}`,
          coverPath: existing?.coverPath ?? null,
          coverMime: existing?.coverMime ?? null,
          addedAt: existing?.addedAt ?? now,
          updatedAt: now,
        };
        if (record.deleted) {
          await storage.books.remove(record.id);
          await storage.reading.save({
            bookId: record.id,
            locator: null,
            fraction: 0,
            status: 'unread' satisfies ReadingStatus,
            updatedAt: now,
          });
          return;
        }
        await storage.books.upsert(book);
        return;
      }

      if (record.kind === 'reading') {
        if (record.deleted) return;
        const fields = record.fields as Record<string, unknown>;
        await storage.reading.save({
          bookId: record.id,
          locator: isLocator(fields.locator) ? fields.locator : null,
          fraction: typeof fields.fraction === 'number' ? fields.fraction : 0,
          status: (fields.status === 'finished' || fields.status === 'unread'
            ? fields.status
            : 'reading') as ReadingStatus,
          updatedAt: now,
        });
        return;
      }

      const fields = record.fields as Record<string, unknown>;
      const notes = await storage.notes.listAll();
      const existing = notes.find((note) => note.id === record.id) ?? null;
      const note: BookNoteRecord = {
        id: record.id,
        bookId: typeof fields.bookId === 'string' ? fields.bookId : (existing?.bookId ?? ''),
        type:
          fields.type === 'bookmark' || fields.type === 'note'
            ? fields.type
            : (existing?.type ?? 'highlight'),
        locator: isLocator(fields.locator)
          ? fields.locator
          : (existing?.locator ?? { kind: 'cfi', cfi: '', fraction: 0 }),
        color: typeof fields.color === 'string' ? fields.color : (existing?.color ?? null),
        text: typeof fields.text === 'string' ? fields.text : (existing?.text ?? null),
        note: typeof fields.note === 'string' ? fields.note : (existing?.note ?? null),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: record.deleted ? now : (existing?.deletedAt ?? null),
      };
      await storage.notes.upsert(note);
    },

    async clocks() {
      return { records: await clocks.list(), fields: await clocks.listFields() };
    },

    async setClocks(entries) {
      await clocks.set([...entries]);
    },

    async setFieldClocks(entries) {
      await clocks.setFields([...entries]);
    },

    async bookFile(sha256) {
      const entries = await dataStore.list('books');
      const match = entries.find((entry) => entry.startsWith(`${sha256}.`));
      if (!match) return null;
      const ext = match.slice(sha256.length + 1);
      const data = await dataStore.read(`books/${match}`);
      return data ? { ext, data } : null;
    },

    async saveBookFile(sha256, ext, data) {
      await dataStore.write(`books/${sha256}.${ext}`, data);
    },
  };
};

/** Stable per-install device id for HLC tie-breaks (ADR-0006). */
export const getOrCreateDeviceId = async (dataStore: DataStorePort): Promise<string> => {
  const existing = await dataStore.read('device-id');
  if (existing) {
    const id = new TextDecoder().decode(existing).trim();
    if (id) return id;
  }
  const id = crypto.randomUUID();
  await dataStore.write('device-id', new TextEncoder().encode(id));
  return id;
};
