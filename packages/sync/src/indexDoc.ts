/**
 * The remote index document is the whole sync state: one JSON file per
 * provider root (ADR-0006). Records are envelope maps keyed by stable ids;
 * merge is per-field LWW with remove-wins tombstones. Merge must be
 * commutative, associative, and idempotent (verified by property tests).
 */
import { compareHlc } from '@hamesh/core';

import type { Envelope } from './envelope';
import { mergeEnvelope, mergeEnvelopeOpt } from './envelope';

export const SCHEMA_VERSION = 1 as const;

export class SyncError extends Error {
  readonly code: 'SCHEMA_VERSION' | 'MALFORMED';
  constructor(code: 'SCHEMA_VERSION' | 'MALFORMED', message: string) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

/**
 * A synced record. `fields` carries every syncable value except the id
 * (the map key). `deletedAt` is the tombstone: once present, field writes
 * never revive the record (ADR-0006); revival uses a new id.
 */
export interface RecordDoc {
  fields: Record<string, Envelope>;
  deletedAt: Envelope<string> | null;
}

export interface DeviceDoc {
  /** Packed HLC of the last index write by this device. */
  lastWrite: Envelope<string> | null;
}

export interface IndexDoc {
  schemaVersion: typeof SCHEMA_VERSION;
  devices: Record<string, DeviceDoc>;
  books: Record<string, RecordDoc>;
  notes: Record<string, RecordDoc>;
}

export const emptyIndexDoc = (): IndexDoc => ({
  schemaVersion: SCHEMA_VERSION,
  devices: {},
  books: {},
  notes: {},
});

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  'v' in value &&
  't' in value &&
  typeof (value as Envelope).t === 'string';

const decodeRecordDoc = (input: unknown, path: string): RecordDoc => {
  if (typeof input !== 'object' || input === null) {
    throw new SyncError('MALFORMED', `${path} is not an object`);
  }
  const raw = input as { fields?: unknown; deletedAt?: unknown };
  if (typeof raw.fields !== 'object' || raw.fields === null) {
    throw new SyncError('MALFORMED', `${path}.fields is not an object`);
  }
  const fields: Record<string, Envelope> = {};
  for (const [key, value] of Object.entries(raw.fields)) {
    if (!isEnvelope(value))
      throw new SyncError('MALFORMED', `${path}.fields.${key} is not an envelope`);
    fields[key] = value as Envelope;
  }
  const deletedAt =
    raw.deletedAt === null || raw.deletedAt === undefined
      ? null
      : isEnvelope(raw.deletedAt)
        ? (raw.deletedAt as Envelope<string>)
        : null;
  if (raw.deletedAt != null && deletedAt === null) {
    throw new SyncError('MALFORMED', `${path}.deletedAt is not an envelope`);
  }
  return { fields, deletedAt };
};

/** Decode with permissive forward-compatibility: unknown top-level keys are ignored, records are validated. */
export const decodeIndexDoc = (input: unknown): IndexDoc => {
  if (typeof input !== 'object' || input === null) {
    throw new SyncError('MALFORMED', 'index document is not an object');
  }
  const raw = input as {
    schemaVersion?: unknown;
    devices?: unknown;
    books?: unknown;
    notes?: unknown;
  };
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new SyncError(
      'SCHEMA_VERSION',
      `unsupported schemaVersion: ${String(raw.schemaVersion)}`,
    );
  }
  const doc = emptyIndexDoc();
  for (const [key, value] of Object.entries((raw.devices ?? {}) as Record<string, unknown>)) {
    const lastWrite = (value as DeviceDoc | undefined)?.lastWrite;
    doc.devices[key] = { lastWrite: lastWrite && isEnvelope(lastWrite) ? lastWrite : null };
  }
  for (const [key, value] of Object.entries((raw.books ?? {}) as Record<string, unknown>)) {
    doc.books[key] = decodeRecordDoc(value, `books.${key}`);
  }
  for (const [key, value] of Object.entries((raw.notes ?? {}) as Record<string, unknown>)) {
    doc.notes[key] = decodeRecordDoc(value, `notes.${key}`);
  }
  return doc;
};

export const encodeIndexDoc = (doc: IndexDoc): string => JSON.stringify(doc);

/** Merge two record docs field-wise; tombstones are sticky (remove wins). */
export const mergeRecordDoc = (a: RecordDoc, b: RecordDoc): RecordDoc => {
  const fields: Record<string, Envelope> = { ...a.fields };
  for (const [key, envelope] of Object.entries(b.fields)) {
    const mine = fields[key];
    fields[key] = mine ? mergeEnvelope(mine, envelope) : envelope;
  }
  return {
    fields,
    deletedAt: mergeEnvelopeOpt(a.deletedAt, b.deletedAt),
  };
};

export const mergeIndexDoc = (a: IndexDoc, b: IndexDoc): IndexDoc => {
  if (a.schemaVersion !== b.schemaVersion) {
    throw new SyncError(
      'SCHEMA_VERSION',
      `cannot merge schemaVersion ${a.schemaVersion} with ${b.schemaVersion}`,
    );
  }
  const mergeMaps = (
    first: Record<string, RecordDoc>,
    second: Record<string, RecordDoc>,
  ): Record<string, RecordDoc> => {
    const out: Record<string, RecordDoc> = { ...first };
    for (const [key, doc] of Object.entries(second)) {
      out[key] = out[key] ? mergeRecordDoc(out[key], doc) : doc;
    }
    return out;
  };
  const devices: Record<string, DeviceDoc> = { ...a.devices };
  for (const [key, device] of Object.entries(b.devices)) {
    devices[key] = {
      lastWrite: mergeEnvelopeOpt(devices[key]?.lastWrite ?? null, device.lastWrite),
    };
  }
  return {
    schemaVersion: a.schemaVersion,
    devices,
    books: mergeMaps(a.books, b.books),
    notes: mergeMaps(a.notes, b.notes),
  };
};

/** Merge N docs in any order (used by the engine and by property tests). */
export const mergeAllIndexDocs = (docs: IndexDoc[]): IndexDoc =>
  docs.reduce((acc, doc) => mergeIndexDoc(acc, doc), emptyIndexDoc());

/**
 * Fields of `remote` that are strictly newer than `local` (per record),
 * i.e. what the local store should pull. Tombstoned records are pulled
 * wholesale so deletions propagate.
 */
export const diffPull = (
  local: Record<string, RecordDoc>,
  remote: Record<string, RecordDoc>,
): Record<string, RecordDoc> => {
  const out: Record<string, RecordDoc> = {};
  for (const [key, remoteDoc] of Object.entries(remote)) {
    const localDoc = local[key];
    if (!localDoc) {
      out[key] = remoteDoc;
      continue;
    }
    const fields: Record<string, Envelope> = {};
    for (const [field, envelope] of Object.entries(remoteDoc.fields)) {
      const mine = localDoc.fields[field];
      if (!mine || compareHlc(mine.t, envelope.t) < 0) fields[field] = envelope;
    }
    const deletedAt =
      remoteDoc.deletedAt &&
      (!localDoc.deletedAt || compareHlc(localDoc.deletedAt.t, remoteDoc.deletedAt.t) < 0)
        ? remoteDoc.deletedAt
        : null;
    if (Object.keys(fields).length > 0 || deletedAt) out[key] = { fields, deletedAt };
  }
  return out;
};
