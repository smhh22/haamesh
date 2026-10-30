/**
 * The sync engine (ADR-0006): pull every provider's index, merge, apply
 * remote-wins fields locally, transfer content-addressed book blobs, then
 * write the merged index back as the commit point. Provider-agnostic: it
 * only sees StorageProvider and the SyncStore port implemented by the app.
 */
import { formatHlc, type HybridLogicalClock } from '@hamesh/core';
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
import { sha256Hex } from './providers/awsV4';

/** Downloads larger than this are rejected before they reach storage. */
const MAX_BLOB_BYTES = 1024 * 1024 * 1024;

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

/** Local clock state: record-level (legacy, bootstrap, tombstones) and per-field (ADR-0011). */
export interface SyncClocks {
  /** `${kind}:${id}` -> packed HLC; `:deleted` suffix marks tombstones. */
  records: Record<string, string>;
  /** `${kind}:${id}` -> doc field name -> packed HLC. */
  fields: Record<string, Record<string, string>>;
}

/**
 * The app-side store seen by the engine. Field writes from `apply` must be
 * merged into existing local records (only the given fields change).
 *
 * Clock contract: the app stamps the FIELDS a local write touches with
 * `clock.now()` (ADR-0011) and the `:deleted` record key on removal; the
 * engine stamps arriving fields with the remote timestamps. Missing clocks
 * fall back to the record clock and then to the record's `updatedAt`.
 */
export interface SyncStore {
  list(): Promise<SyncRecord[]>;
  apply(record: SyncRecord): Promise<void>;
  clocks(): Promise<SyncClocks>;
  setClocks(entries: Array<readonly [string, string]>): Promise<void>;
  setFieldClocks(entries: Array<readonly [string, string, string]>): Promise<void>;
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
  clocks: SyncClocks,
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
  /** ADR-0011 resolution: field clock -> record clock -> legacy updatedAt.
   * Reading fields are written under the book's key (book:<id>), not the
   * reading record key, so the caller can pass the key explicitly. */
  const stampFor = (
    record: SyncRecord,
    docField: string,
    clockKey: string = recordKey(record),
  ): string =>
    clocks.fields[clockKey]?.[docField] ??
    clocks.records[recordKey(record)] ??
    legacyTimestamp(record, deviceId);

  for (const record of records) {
    if (record.kind === 'reading') {
      const book = ensureBook(record.id);
      const clockKey = `book:${record.id}`;
      for (const [field, value] of Object.entries(record.fields)) {
        const docField = `${READING_PREFIX}${field}`;
        book.fields[docField] = { v: value, t: stampFor(record, docField, clockKey) };
      }
      continue;
    }
    const target = record.kind === 'note' ? doc.notes : doc.books;
    const fields: Record<string, Envelope> = {};
    for (const [field, value] of Object.entries(record.fields)) {
      fields[field] = { v: value, t: stampFor(record, field) };
    }
    const recordClock = clocks.records[recordKey(record)] ?? legacyTimestamp(record, deviceId);
    target[record.id] = {
      fields,
      deletedAt: record.deleted
        ? { v: recordClock, t: clocks.records[deletedKey(record)] ?? recordClock }
        : null,
    };
  }
  return doc;
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

  const INDEX_WRITE_ATTEMPTS = 3;

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

      for (let attempt = 1; attempt <= INDEX_WRITE_ATTEMPTS; attempt += 1) {
        // Counters describe the successful attempt only.
        report.pulledRecords = 0;
        report.uploadedBlobs = 0;
        report.downloadedBlobs = 0;

        // Etag first: if another writer lands between HEAD and GET, the
        // commit's If-Match fails and we retry — reading the etag after the
        // body could adopt the concurrent writer's etag and clobber it.
        const rawEtag = (await provider.head(INDEX_PATH))?.etag ?? null;
        let remote = emptyIndexDoc();
        const remoteRaw = await provider.readText(INDEX_PATH).catch((error: unknown) => {
          if (error instanceof ProviderError && error.code === 'NOT_FOUND') return null;
          throw error;
        });
        if (remoteRaw !== null) remote = decodeIndexDoc(JSON.parse(remoteRaw));
        const indexExists = remoteRaw !== null;
        // Weak validators cannot satisfy If-Match; when the object exists but
        // has no usable validator, fall back to an unconditional commit
        // instead of a create-only write that would conflict forever.
        const indexEtag = rawEtag && !rawEtag.startsWith('W/') ? rawEtag : null;

        // 1. Pull remote-wins fields into the local store.
        const pullBooks = diffPull(localDoc.books, remote.books);
        const pullNotes = diffPull(localDoc.notes, remote.notes);
        const fieldClockEntries: Array<readonly [string, string, string]> = [];
        const recordClockEntries: Array<readonly [string, string]> = [];
        /** Stamp exactly the fields that arrived, with their remote timestamps. */
        const stampPulled = (kind: string, id: string, entry: RecordDoc): void => {
          for (const [field, envelope] of Object.entries(entry.fields)) {
            clock.observe(envelope.t);
            fieldClockEntries.push([`${kind}:${id}`, field, envelope.t] as const);
          }
          if (entry.deletedAt) {
            clock.observe(entry.deletedAt.t);
            recordClockEntries.push([`${kind}:${id}:deleted`, entry.deletedAt.t] as const);
          }
        };
        for (const [id, entry] of Object.entries(pullBooks)) {
          const { book, reading } = splitBookFields(entry.fields);
          // A tombstone-only diff (no fields) must still delete the local book.
          if (Object.keys(book).length > 0 || entry.deletedAt) {
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
            await store.apply({
              id,
              kind: 'reading',
              fields: reading,
              deleted: false,
              updatedAt: 0,
            });
            report.pulledRecords += 1;
          }
          stampPulled('book', id, entry);
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
            stampPulled('note', id, entry);
          }
        }
        if (fieldClockEntries.length > 0) await store.setFieldClocks(fieldClockEntries);
        if (recordClockEntries.length > 0) await store.setClocks(recordClockEntries);

        // 2. Transfer content-addressed blobs against the merged state.
        const merged = mergeIndexDoc(localDoc, remote);
        for (const [id, entry] of Object.entries(merged.books)) {
          if (entry.deletedAt) continue;
          const sha256 = entry.fields.sha256?.v;
          const ext = entry.fields.ext?.v;
          // The index is untrusted remote data: only hash-shaped ids and known
          // formats may be used to build paths.
          if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) continue;
          if (ext !== 'epub' && ext !== 'pdf') continue;
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
              if (data.byteLength > MAX_BLOB_BYTES) {
                report.ok = false;
                report.error = `blob too large: ${sha256}`;
                continue;
              }
              const digest = await sha256Hex(new Uint8Array(data));
              if (digest !== sha256) {
                report.ok = false;
                report.error = `blob hash mismatch: ${sha256}`;
                continue;
              }
              await store.saveBookFile(sha256, ext, new Uint8Array(data));
              report.downloadedBlobs += 1;
            }
          }
        }

        // Commit point. A conditional writer detects a concurrent writer and
        // forces a fresh read + merge instead of clobbering it (ADR-0006).
        const devices = {
          ...merged.devices,
          [deviceId]: { lastWrite: { v: clock.now(), t: clock.peek() } },
        };
        const body = encodeIndexDoc({ ...merged, devices });
        if (provider.writeTextConditional && (!indexExists || indexEtag)) {
          const result = await provider.writeTextConditional(INDEX_PATH, body, indexEtag);
          if (result === 'conflict') continue;
        } else {
          await provider.writeText(INDEX_PATH, body);
        }
        return report;
      }
      report.ok = false;
      report.error = 'index write conflict after retries';
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
      const reports: SyncProviderReport[] = [];
      for (const provider of providers) {
        // Rebuild after each provider: an earlier pull mutates the local store
        // and the next provider must be merged against that state, not a
        // stale snapshot (two mirrors could otherwise regress each other).
        const records = await store.list();
        const clocks = await store.clocks();
        const localDoc = buildLocalDoc(records, clocks, deviceId);
        reports.push(await syncWithProvider(provider, localDoc));
      }
      return { ok: reports.every((report) => report.ok), providers: reports };
    },
  };
};

export type SyncEngine = ReturnType<typeof createSyncEngine>;
