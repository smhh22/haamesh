import { HybridLogicalClock } from '@hamesh/core';
import { describe, expect, it } from 'vitest';
import type { SyncRecord, SyncStore } from './engine';
import { createSyncEngine } from './engine';
import type { StorageProvider } from './provider';
import { createMemoryProvider } from './providers/memory';

interface MemoryStore extends SyncStore {
  clock: HybridLogicalClock;
  records: Map<string, SyncRecord>;
  localEdit(record: SyncRecord): Promise<void>;
}

/**
 * Minimal SyncStore over plain maps: records merge field-wise on apply.
 * `localEdit` mirrors the real app write path — every local write stamps the
 * record clock (the engine stamps clocks only for remote pulls).
 */
const createMemoryStore = (deviceId: string, now: () => number): MemoryStore => {
  const clock = new HybridLogicalClock(deviceId, now);
  const records = new Map<string, SyncRecord>();
  const clocks = new Map<string, string>();
  const fieldClocks = new Map<string, Map<string, string>>();
  const key = (kind: string, id: string) => `${kind}:${id}`;
  const build: MemoryStore = {
    clock,
    records,
    async list() {
      return [...records.values()];
    },
    async apply(record: SyncRecord) {
      const id = key(record.kind, record.id);
      const existing = records.get(id);
      if (existing) {
        existing.fields = { ...existing.fields, ...record.fields };
        existing.updatedAt = Math.max(existing.updatedAt, now());
        // Tombstones are sticky; revival uses a new id (ADR-0006).
        existing.deleted = existing.deleted || record.deleted;
      } else {
        records.set(id, { ...record, fields: { ...record.fields } });
      }
    },
    async clocks() {
      return {
        records: Object.fromEntries(clocks),
        fields: Object.fromEntries(
          [...fieldClocks.entries()].map(([k, map]) => [k, Object.fromEntries(map)]),
        ),
      };
    },
    async setClocks(entries: Array<readonly [string, string]>) {
      for (const [k, t] of entries) clocks.set(k, t);
    },
    async setFieldClocks(entries: Array<readonly [string, string, string]>) {
      for (const [k, field, t] of entries) {
        const bucket = fieldClocks.get(k) ?? new Map<string, string>();
        bucket.set(field, t);
        fieldClocks.set(k, bucket);
      }
    },
    async bookFile(sha256: string) {
      const record = [...records.values()].find(
        (item) => item.kind === 'book' && item.fields.sha256 === sha256 && !item.deleted,
      );
      const data = blobs.get(sha256);
      if (!record || !data) return null;
      return { ext: String(record.fields.ext ?? 'epub'), data };
    },
    async saveBookFile(sha256: string, ext: string, data: Uint8Array) {
      blobs.set(sha256, data);
      void ext;
    },
    /** Local write: merges the given fields and stamps exactly those (ADR-0011). */
    async localEdit(record: SyncRecord) {
      const key = `${record.kind}:${record.id}`;
      const existing = records.get(key);
      records.set(key, {
        ...record,
        fields: { ...existing?.fields, ...record.fields },
      });
      const stamps: Array<readonly [string, string, string]> = Object.keys(record.fields).map(
        (field) => [key, field, clock.now()] as const,
      );
      await build.setFieldClocks(stamps);
      if (record.deleted) {
        await build.setClocks([[`${key}:deleted`, clock.now()]]);
      }
    },
  };
  return build;
};

const blobs = new Map<string, Uint8Array>();

const bookRecord = (id: string, title: string, updatedAt: number): SyncRecord => ({
  id,
  kind: 'book',
  fields: { sha256: `sha-${id}`, ext: 'epub', title },
  deleted: false,
  updatedAt,
});

describe('sync engine', () => {
  it('propagates a new book from device A to device B', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    await storeA.localEdit(bookRecord('1', 'Persian Book', 1000));
    const storeB = createMemoryStore('device-b', now);

    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    wall = 2000;
    const report = await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    expect(report.ok).toBe(true);
    expect(report.providers[0]?.pulledRecords).toBeGreaterThan(0);
    const pulled = storeB.records.get('book:1');
    expect(pulled?.fields.title).toBe('Persian Book');
    expect(pulled?.fields.sha256).toBe('sha-1');
  });

  it('converges concurrent title edits to one winner', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    const storeB = createMemoryStore('device-b', now);

    await storeA.localEdit(bookRecord('1', 'from-a', 1000));
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    wall = 2000;
    await storeA.localEdit(bookRecord('1', 'edited-on-a', 2000));
    await storeB.localEdit(bookRecord('1', 'edited-on-b', 2000));
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();

    const titleA = storeA.records.get('book:1')?.fields.title;
    const titleB = storeB.records.get('book:1')?.fields.title;
    expect(titleA).toBe(titleB);
    expect(['edited-on-a', 'edited-on-b']).toContain(titleA);
  });

  it('keeps concurrent edits to different fields of the same book', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    const storeB = createMemoryStore('device-b', now);

    await storeA.localEdit(bookRecord('1', 'Original', 1000));
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    wall = 2000;
    // Device A renames; device B edits a different field of the same book.
    await storeA.localEdit({
      id: '1',
      kind: 'book',
      fields: { title: 'Renamed' },
      deleted: false,
      updatedAt: 2000,
    });
    await storeB.localEdit({
      id: '1',
      kind: 'book',
      fields: { series: 'Series B' },
      deleted: false,
      updatedAt: 2000,
    });
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();

    for (const store of [storeA, storeB]) {
      expect(store.records.get('book:1')?.fields.title).toBe('Renamed');
      expect(store.records.get('book:1')?.fields.series).toBe('Series B');
    }
  });

  it('propagates reading state as book fields', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    await storeA.localEdit(bookRecord('1', 'Book', 1000));
    await storeA.localEdit({
      id: '1',
      kind: 'reading',
      fields: { fraction: 0.42, status: 'reading' },
      deleted: false,
      updatedAt: 1100,
    });
    const storeB = createMemoryStore('device-b', now);

    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    wall = 3000;
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    const reading = storeB.records.get('reading:1');
    expect(reading?.fields.fraction).toBe(0.42);
  });

  it('transfers the book blob to a provider that lacks it', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    await storeA.localEdit(bookRecord('1', 'Book', 1000));
    blobs.set('sha-1', new Uint8Array([1, 2, 3]));
    const storeB = createMemoryStore('device-b', now);

    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    expect(await provider.head('Hamesh/books/sha-1/book.epub')).not.toBeNull();

    wall = 2000;
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    const file = await storeB.bookFile('sha-1');
    expect([...(file?.data ?? [])]).toEqual([1, 2, 3]);
  });

  it('propagates a note tombstone as remove-wins', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    await storeA.localEdit(bookRecord('1', 'Book', 1000));
    await storeA.localEdit({
      id: 'note-1',
      kind: 'note',
      fields: { bookId: '1', text: 'highlighted text' },
      deleted: false,
      updatedAt: 1100,
    });
    const storeB = createMemoryStore('device-b', now);
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    expect(storeB.records.get('note:note-1')?.fields.text).toBe('highlighted text');

    wall = 2000;
    await storeA.localEdit({
      id: 'note-1',
      kind: 'note',
      fields: {},
      deleted: true,
      updatedAt: 2000,
    });
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    wall = 2500;
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    const note = storeB.records.get('note:note-1');
    expect(note?.deleted).toBe(true);
  });

  it('does not resurrect a locally deleted book from remote fields', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    const storeB = createMemoryStore('device-b', now);

    // Remote (B) still holds the live book with all fields.
    await storeB.localEdit(bookRecord('1', 'Live Book', 1000));
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    // A never saw the book, deletes nothing... simulate a local import-then-
    // delete: A pulls nothing yet; delete means a tombstone record.
    await storeA.localEdit({ id: '1', kind: 'book', fields: {}, deleted: true, updatedAt: 1200 });
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();

    expect(storeA.records.get('book:1')?.deleted).toBe(true);
    expect(storeA.records.get('book:1')?.fields.title).toBeUndefined();

    // The tombstone must now reach B and delete the live record there.
    wall = 3000;
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    expect(storeB.records.get('book:1')?.deleted).toBe(true);

    // And a second A round must not re-create anything.
    wall = 4000;
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    expect(storeA.records.get('book:1')?.deleted).toBe(true);
  });

  it('retries the index write when a concurrent writer wins the race', async () => {
    const provider = createMemoryProvider();
    const wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    const storeB = createMemoryStore('device-b', now);
    await storeA.localEdit(bookRecord('1', 'Mine', 1000));
    await storeB.localEdit(bookRecord('2', 'Theirs', 1000));
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    // Inject a concurrent writer into A's first read: A must notice the
    // etag stomp on commit, re-read, and merge instead of clobbering book 2.
    let injected = false;
    const racing: StorageProvider = {
      ...provider,
      async readText(path: string) {
        const result = await provider.readText(path);
        if (!injected && path.endsWith('index.json')) {
          injected = true;
          await storeB.localEdit(bookRecord('3', 'Late', 1500));
          await createSyncEngine({
            deviceId: 'device-b',
            clock: storeB.clock,
            store: storeB,
            providers: [provider],
          }).sync();
        }
        return result;
      },
    };

    const report = await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [racing],
    }).sync();

    expect(report.ok).toBe(true);
    expect(injected).toBe(true);
    const raw = await provider.readText('Hamesh/index.json');
    const doc = JSON.parse(raw ?? '{}') as { books: Record<string, unknown> };
    expect(Object.keys(doc.books).sort()).toEqual(['1', '2', '3']);
  });

  it('reports a failed provider without failing the others', async () => {
    const failing = createMemoryProvider({ id: 'flaky', failFirst: 1 });
    const healthy = createMemoryProvider({ id: 'solid' });
    const wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    await storeA.localEdit(bookRecord('1', 'Book', 1000));

    const report = await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [failing, healthy],
    }).sync();

    expect(report.ok).toBe(false);
    expect(report.providers.find((r) => r.providerId === 'flaky')?.ok).toBe(false);
    expect(report.providers.find((r) => r.providerId === 'solid')?.ok).toBe(true);
    expect(await healthy.readText('Hamesh/index.json')).not.toBeNull();
  });

  it('a second sync round is a no-op (idempotent convergence)', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    await storeA.localEdit(bookRecord('1', 'Book', 1000));
    const engineA = createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    });
    await engineA.sync();
    wall = 1500;
    const first = await engineA.sync();
    const second = await engineA.sync();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.providers[0]?.pulledRecords).toBe(0);
    expect(second.providers[0]?.uploadedBlobs).toBe(0);
  });

  it('keeps books added concurrently on both replicas', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    const storeB = createMemoryStore('device-b', now);
    await storeA.localEdit(bookRecord('a', 'From A', 1000));
    await storeB.localEdit(bookRecord('b', 'From B', 1000));

    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    wall = 2000;
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    wall = 3000;
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();

    const titles = (store: MemoryStore) =>
      [...store.records.values()]
        .filter((record) => record.kind === 'book' && !record.deleted)
        .map((record) => String(record.fields.title))
        .sort();
    expect(titles(storeA)).toEqual(['From A', 'From B']);
    expect(titles(storeB)).toEqual(['From A', 'From B']);
  });

  it('keeps a delete even when the other replica edits concurrently', async () => {
    const provider = createMemoryProvider();
    let wall = 1000;
    const now = () => wall;
    const storeA = createMemoryStore('device-a', now);
    const storeB = createMemoryStore('device-b', now);
    await storeA.localEdit(bookRecord('1', 'Book', 1000));
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    wall = 2000;
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    wall = 3000;
    await storeA.localEdit({ id: '1', kind: 'book', fields: {}, deleted: true, updatedAt: 3000 });
    await storeB.localEdit(bookRecord('1', 'Renamed on B', 3000));

    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();
    wall = 4000;
    await createSyncEngine({
      deviceId: 'device-a',
      clock: storeA.clock,
      store: storeA,
      providers: [provider],
    }).sync();
    wall = 5000;
    await createSyncEngine({
      deviceId: 'device-b',
      clock: storeB.clock,
      store: storeB,
      providers: [provider],
    }).sync();

    const book = (store: MemoryStore) =>
      [...store.records.values()].find((record) => record.kind === 'book' && record.id === '1');
    expect(book(storeA)?.deleted).toBe(true);
    expect(book(storeB)?.deleted).toBe(true);
  });
});
