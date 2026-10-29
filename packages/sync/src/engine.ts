/**
 * The sync engine (ADR-0006): pull every provider's index, merge, apply
 * remote-wins fields locally, transfer content-addressed book blobs, then
 * write the merged index back as the commit point. Provider-agnostic: it
 * only sees StorageProvider and the SyncStore port implemented by the app.
 */
import { compareHlc, formatHlc, type HybridLogicalClock } from '@hamesh/core';
import type { Envelope } from './envelope';
import type { IndexDoc, RecordDoc } from './indexDoc';
import {
  decodeIndexDoc,
  diffPull,
  emptyIndexDoc,
  encodeIndexDoc,
  mergeIndexDoc,
  SCHEMA_VERSION,
} from './indexDoc';
import type { StorageProvider } from './provider';
import { ProviderError } from './provider';

export type SyncKind = 'book' | 'reading' | 'note';

/**
 * Kind-neutral record exchanged between the engine and the app store.
 * `reading` records use the book id as their id; their fields are stored on
 * the book's index entry behind a `reading.` prefix.
 */
export interface SyncRecord {
  id: string;
  kind: SyncKind;
  fields: Record<string, unknown>;
  deleted: boolean;
  /** Wall-clock ms of the last local edit; bootstrap HLC derivation. */
  updatedAt: number;
}

/**
 * The app-side store seen by the engine. Field writes from `apply` must be
 * merged into existing local records (only the given fields change).
 *
 * Clock contract: the app stamps `${kind}:${id}` with `clock.now()` on every
 * LOCAL write; the engine stamps it with the pulled timestamp on every REMOTE
 * apply. A record with no clock entry bootstraps from its `updatedAt`.
 */
export interface SyncStore {
  list(): Promise<SyncRecord[]>;
  apply(record: SyncRecord): Promise<void>;
  /** Persisted per-record clocks, keyed `${kind}:${id}`; `:deleted` marks tombstones. */
  clocks(): Promise<Record<string, string>>;
  setClocks(entries: Array<readonly [string, string]>): Promise<void>;
  bookFile(sha256: string): Promise<{ ext: string; data: Uint8Array } | null>;
  saveBookFile(sha256: string, ext: string, data: Uint8Array): Promise<void>;
}

export interface SyncOptions {
  deviceId: string;
  clock: HybridLogicalClock;
  store: SyncStore;
  providers: StorageProvider[];
}

export interface SyncProviderReport {
  providerId: string;
  ok: boolean;
  error?: string;
  pulledRecords: number;
  uploadedBlobs: number;
  downloadedBlobs: number;
}

export interface SyncReport {
  ok: boolean;
  providers: SyncProviderReport[];
}

export const REMOTE_ROOT = 'Hamesh';
export const INDEX_PATH = `${REMOTE_ROOT}/index.json`;
export const bookBlobPath = (sha256: string, ext: string): string =>
  `${REMOTE_ROOT}/books/${sha256}/book.${ext}`;
export const bookMetaPath = (sha256: string): string => `${REMOTE_ROOT}/books/${sha256}/meta.json`;

const READING_PREFIX = 'reading.';

const recordKey = (record: SyncRecord): string => `${record.kind}:${record.id}`;
const deletedKey = (record: SyncRecord): string => `${record.kind}:${record.id}:deleted`;

/** HLC for a record without a persisted clock: derived from its updatedAt. */
export const legacyTimestamp = (record: SyncRecord, deviceId: string): string =>
  formatHlc({ physical: Math.max(0, record.updatedAt), counter: 0, deviceId });

export const buildLocalDoc = (
  records: SyncRecord[],
  clocks: Record<string, string>,
  deviceId: string,
): IndexDoc => {
  const doc = emptyIndexDoc();
  const ensureBook = (id: string): RecordDoc => {
    const existing = doc.books[id];
    if (existing) return existing;
    const fresh = { fields: {}, deletedAt: null };
    doc.books[id] = fresh;
    return fresh;
  };
  for (const record of records) {
    const base = clocks[recordKey(record)] ?? legacyTimestamp(record, deviceId);
    if (record.kind === 'reading') {
      const book = ensureBook(record.id);
      for (const [field, value] of Object.entries(record.fields)) {
        book.fields[`${READING_PREFIX}${field}`] = { v: value, t: base };
      }
      continue;
    }
    const target = record.kind === 'note' ? doc.notes : doc.books;
    const fields: Record<string, Envelope> = {};
    for (const [field, value] of Object.entries(record.fields)) {
      fields[field] = { v: value, t: base };
    }
    target[record.id] = {
      fields,
      deletedAt: record.deleted ? { v: base, t: clocks[deletedKey(record)] ?? base } : null,
    };
  }
  return doc;
};

const maxTimestamp = (doc: RecordDoc): string | null => {
  let max: string | null = doc.deletedAt?.t ?? null;
  for (const envelope of Object.values(doc.fields)) {
    if (!max || compareHlc(envelope.t, max) > 0) max = envelope.t;
  }
  return max;
};

/** Split a pulled book entry into plain fields and `reading.*` fields. */
const splitBookFields = (
  fields: Record<string, Envelope>,
): { book: Record<string, unknown>; reading: Record<string, unknown> } => {
  const book: Record<string, unknown> = {};
  const reading: Record<string, unknown> = {};
  for (const [field, envelope] of Object.entries(fields)) {
    if (field.startsWith(READING_PREFIX)) {
      reading[field.slice(READING_PREFIX.length)] = envelope.v;
    } else {
      book[field] = envelope.v;
    }
  }
  return { book, reading };
};

export const createSyncEngine = (options: SyncOptions) => {
  const { deviceId, clock, store, providers } = options;

  const syncWithProvider = async (
    provider: StorageProvider,
    localDoc: IndexDoc,
  ): Promise<SyncProviderReport> => {
    const report: SyncProviderReport = {
      providerId: provider.id,
      ok: true,
      pulledRecords: 0,
      uploadedBlobs: 0,
      downloadedBlobs: 0,
    };
    try {
      await provider.ensureDir([REMOTE_ROOT, `${REMOTE_ROOT}/books`, `${REMOTE_ROOT}/devices`]);

      let remote = emptyIndexDoc();
      const remoteRaw = await provider.readText(INDEX_PATH).catch((error: unknown) => {
        if (error instanceof ProviderError && error.code === 'NOT_FOUND') return null;
        throw error;
      });
      if (remoteRaw !== null) remote = decodeIndexDoc(JSON.parse(remoteRaw));

      // 1. Pull remote-wins fields into the local store.
      const pullBooks = diffPull(localDoc.books, remote.books);
      const pullNotes = diffPull(localDoc.notes, remote.notes);
      const clockEntries: Array<readonly [string, string]> = [];
      for (const [id, entry] of Object.entries(pullBooks)) {
        const { book, reading } = splitBookFields(entry.fields);
        if (Object.keys(book).length > 0) {
          await store.apply({
            id,
            kind: 'book',
            fields: book,
            deleted: Boolean(entry.deletedAt),
            updatedAt: 0,
          });
          report.pulledRecords += 1;
        }
        if (Object.keys(reading).length > 0) {
          await store.apply({ id, kind: 'reading', fields: reading, deleted: false, updatedAt: 0 });
          report.pulledRecords += 1;
        }
        const stamp = maxTimestamp(entry);
        if (stamp) {
          clock.observe(stamp);
          clockEntries.push([`book:${id}`, stamp] as const);
        }
      }
      for (const [id, entry] of Object.entries(pullNotes)) {
        if (Object.keys(entry.fields).length > 0 || entry.deletedAt) {
          await store.apply({
            id,
            kind: 'note',
            fields: Object.fromEntries(Object.entries(entry.fields).map(([k, e]) => [k, e.v])),
            deleted: Boolean(entry.deletedAt),
            updatedAt: 0,
          });
          report.pulledRecords += 1;
          const stamp = maxTimestamp(entry);
          if (stamp) {
            clock.observe(stamp);
            clockEntries.push([`note:${id}`, stamp] as const);
          }
        }
      }
      if (clockEntries.length > 0) await store.setClocks(clockEntries);

      // 2. Transfer content-addressed blobs against the merged state.
      const merged = mergeIndexDoc(localDoc, remote);
      for (const [id, entry] of Object.entries(merged.books)) {
        if (entry.deletedAt) continue;
        const sha256 = entry.fields.sha256?.v;
        const ext = entry.fields.ext?.v;
        if (typeof sha256 !== 'string' || typeof ext !== 'string') continue;
        const blobPath = bookBlobPath(sha256, ext);
        const remoteBlob = await provider.head(blobPath);
        const localBlob = await store.bookFile(sha256);
        if (!remoteBlob && localBlob) {
          const copy = new Uint8Array(localBlob.data.byteLength);
          copy.set(localBlob.data);
          await provider.writeBinary(blobPath, copy.buffer);
          await provider.writeText(
            bookMetaPath(sha256),
            JSON.stringify({ schemaVersion: SCHEMA_VERSION, bookId: id, sha256, ext }),
          );
          report.uploadedBlobs += 1;
        } else if (remoteBlob && !localBlob) {
          const data = await provider.readBinary(blobPath);
          if (data) {
            await store.saveBookFile(sha256, ext, new Uint8Array(data));
            report.downloadedBlobs += 1;
          }
        }
      }

      // 3. Write the merged index last — it is the commit point.
      const devices = {
        ...merged.devices,
        [deviceId]: { lastWrite: { v: clock.now(), t: clock.peek() } },
      };
      await provider.writeText(INDEX_PATH, encodeIndexDoc({ ...merged, devices }));
      return report;
    } catch (error) {
      report.ok = false;
      report.error = error instanceof Error ? error.message : String(error);
      return report;
    }
  };

  return {
    /** Run a full sync round across every enabled provider. */
    sync: async (): Promise<SyncReport> => {
      const records = await store.list();
      const clocks = await store.clocks();
      const localDoc = buildLocalDoc(records, clocks, deviceId);
      const reports: SyncProviderReport[] = [];
      for (const provider of providers) {
        reports.push(await syncWithProvider(provider, localDoc));
      }
      return { ok: reports.every((report) => report.ok), providers: reports };
    },
  };
};

export type SyncEngine = ReturnType<typeof createSyncEngine>;
