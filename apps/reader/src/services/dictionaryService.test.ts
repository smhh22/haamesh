import { type DictionaryEntry, DictionaryError } from '@hamesh/ai';
import type { DictionaryCacheEntry, DictionaryCacheRepository } from '@hamesh/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  type DictionaryCachePort,
  type DictionaryLookupDeps,
  lookupWithCache,
  runDictionaryLookup,
} from './dictionaryService';

vi.mock('./libraryPersistence', () => ({
  getActiveStorage: vi.fn(),
}));

const { getActiveStorage } = await import('./libraryPersistence');

const entry = (overrides: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
  title: 'کتاب',
  source: 'wiktionary-native',
  sourceLabel: 'ویکی‌واژه',
  license: 'CC BY-SA 4.0',
  url: 'https://fa.wiktionary.org/wiki/کتاب',
  dir: 'rtl',
  lines: ['دفتر', 'نامِ نوشته'],
  ...overrides,
});

const hitRow = (
  key: string,
  overrides: Partial<DictionaryCacheEntry> = {},
): DictionaryCacheEntry => ({
  key,
  source: 'wiktionary-native',
  entryJson: JSON.stringify(entry()),
  errorCode: null,
  expiresAt: Date.now() + 60_000,
  createdAt: Date.now(),
  ...overrides,
});

const missRow = (key: string, code: string, overrides: Partial<DictionaryCacheEntry> = {}) =>
  hitRow(key, { source: null, entryJson: null, errorCode: code, ...overrides });

const fakeCache = (rows: DictionaryCacheEntry[] = []) => {
  const store = new Map(rows.map((row) => [row.key, row]));
  const cache = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (row: DictionaryCacheEntry) => {
      store.set(row.key, row);
    }),
    prune: vi.fn(async () => undefined),
    pruneExpired: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    count: vi.fn(async () => store.size),
    clear: vi.fn(async () => undefined),
  } satisfies DictionaryCacheRepository;
  return { cache: cache as DictionaryCacheRepository & DictionaryCachePort, store };
};

const deps = (
  overrides: Partial<DictionaryLookupDeps> & { cache?: DictionaryCachePort | null } = {},
): DictionaryLookupDeps & { fetchEntry: ReturnType<typeof vi.fn> } =>
  ({
    now: () => 1_000,
    fetchEntry: vi.fn(async () => entry()),
    cache: null,
    memory: new Map(),
    ...overrides,
  }) as DictionaryLookupDeps & { fetchEntry: ReturnType<typeof vi.fn> };

describe('dictionary lookup cache', () => {
  it('serves a live memory hit without touching SQLite or the network', async () => {
    const { cache, store } = fakeCache();
    const memory = new Map();
    const context = deps({ cache, memory });
    memory.set('کتاب', { entry: entry(), expiresAt: 2_000 });

    expect(await runDictionaryLookup('  کتاب ', context)).toMatchObject({ title: 'کتاب' });
    expect(context.fetchEntry).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('replays a cached miss from memory', async () => {
    const memory = new Map();
    const context = deps({ memory });
    memory.set('ناشناس', { errorCode: 'NO_DEFINITION', expiresAt: 2_000 });

    await expect(runDictionaryLookup('ناشناس', context)).rejects.toMatchObject({
      code: 'NO_DEFINITION',
    });
    expect(context.fetchEntry).not.toHaveBeenCalled();
  });

  it('falls back to a SQLite hit after a restart and refills memory', async () => {
    const { cache } = fakeCache([hitRow('کتاب')]);
    const memory = new Map();
    const context = deps({ cache, memory });

    expect(await runDictionaryLookup('کتاب', context)).toMatchObject({ title: 'کتاب' });
    expect(context.fetchEntry).not.toHaveBeenCalled();
    expect(memory.get('کتاب')?.entry?.title).toBe('کتاب');

    // Second lookup in the same session comes from memory.
    await runDictionaryLookup('کتاب', context);
    expect(cache.get).toHaveBeenCalledTimes(1);
  });

  it('replays a SQLite miss without a network call', async () => {
    const { cache } = fakeCache([missRow('ناشناس', 'RATE_LIMITED')]);
    const context = deps({ cache });

    await expect(runDictionaryLookup('ناشناس', context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(context.fetchEntry).not.toHaveBeenCalled();
  });

  it('treats an unknown stored error code as NO_DEFINITION', async () => {
    const { cache } = fakeCache([missRow('ناشناس', 'SOMETHING_NEW')]);
    const context = deps({ cache });

    await expect(runDictionaryLookup('ناشناس', context)).rejects.toMatchObject({
      code: 'NO_DEFINITION',
    });
  });

  it('ignores expired rows and corrupt JSON, then fetches again', async () => {
    const { cache, store } = fakeCache([
      hitRow('کهنه', { expiresAt: 500 }),
      hitRow('خراب', { entryJson: '{"title":42}' }),
    ]);
    const context = deps({ cache });

    await expect(runDictionaryLookup('کهنه', context)).resolves.toMatchObject({ title: 'کتاب' });
    await expect(runDictionaryLookup('خراب', context)).resolves.toMatchObject({ title: 'کتاب' });
    expect(context.fetchEntry).toHaveBeenCalledTimes(2);
    expect(store.get('کهنه')?.expiresAt).toBe(1_000 + 24 * 60 * 60_000);
  });

  it('persists a hit with its source, TTL, and a prune', async () => {
    const { cache, store } = fakeCache();
    const context = deps({ cache, now: () => 5_000 });

    await runDictionaryLookup('کتاب', context);

    const row = store.get('کتاب');
    expect(row).toMatchObject({
      source: 'wiktionary-native',
      errorCode: null,
      expiresAt: 5_000 + 24 * 60 * 60_000,
      createdAt: 5_000,
    });
    expect(JSON.parse(row?.entryJson ?? 'null')).toMatchObject({ title: 'کتاب' });
    expect(cache.prune).toHaveBeenCalled();
  });

  it('persists typed misses with the short TTL and no source', async () => {
    const { cache, store } = fakeCache();
    const context = deps({
      cache,
      now: () => 5_000,
      fetchEntry: vi.fn(async () => {
        throw new DictionaryError('NO_DEFINITION');
      }),
    });

    await expect(runDictionaryLookup('ناشناس', context)).rejects.toMatchObject({
      code: 'NO_DEFINITION',
    });
    expect(store.get('ناشناس')).toMatchObject({
      source: null,
      entryJson: null,
      errorCode: 'NO_DEFINITION',
      expiresAt: 5_000 + 10 * 60_000,
    });
  });

  it('does not cache aborts or unexpected failures', async () => {
    const { cache, store } = fakeCache();
    const abort = new DOMException('aborted', 'AbortError');
    const context = deps({
      cache,
      fetchEntry: vi.fn(async () => {
        throw abort;
      }),
    });

    await expect(runDictionaryLookup('کتاب', context)).rejects.toBe(abort);
    expect(store.size).toBe(0);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('never fails a lookup because the cache failed', async () => {
    const { cache } = fakeCache();
    cache.get = vi.fn(async () => {
      throw new Error('disk gone');
    });
    cache.set = vi.fn(async () => {
      throw new Error('disk gone');
    });
    const context = deps({ cache });

    await expect(runDictionaryLookup('کتاب', context)).resolves.toMatchObject({ title: 'کتاب' });
  });

  it('works with no SQLite cache at all', async () => {
    const context = deps({ cache: null });

    await expect(runDictionaryLookup('کتاب', context)).resolves.toMatchObject({ title: 'کتاب' });
  });
});

describe('lookupWithCache wiring', () => {
  it('sweeps expired rows once per session and reads the active storage cache', async () => {
    const { cache } = fakeCache([hitRow('wired-a'), hitRow('wired-b')]);
    vi.mocked(getActiveStorage).mockReturnValue({
      dictionaryCache: cache,
    } as unknown as ReturnType<typeof getActiveStorage>);

    await expect(lookupWithCache('wired-a')).resolves.toMatchObject({ title: 'کتاب' });
    await expect(lookupWithCache('wired-b')).resolves.toMatchObject({ title: 'کتاب' });

    expect(cache.pruneExpired).toHaveBeenCalledTimes(1);
    expect(cache.get).toHaveBeenCalledWith('wired-a');
    expect(cache.get).toHaveBeenCalledWith('wired-b');
  });
});
