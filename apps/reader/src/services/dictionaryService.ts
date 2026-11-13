import {
  type DictionaryEntry,
  DictionaryError,
  type DictionaryErrorCode,
  lookupWord,
} from '@hamesh/ai';
import type { DictionaryCacheRepository } from '@hamesh/storage';
import { providerFetch } from './httpFetch';
import { getActiveStorage } from './libraryPersistence';

/**
 * Dictionary lookup service (ADR-0024): memory → SQLite → network.
 *
 * Hits live for a day and misses for ten minutes, in both layers. The SQLite
 * cache (storage v7) survives restarts so paging through a book offline still
 * resolves words looked up earlier; every write is best-effort — a failed
 * cache must never fail a lookup. `runDictionaryLookup` takes injected deps
 * and is unit-tested; `lookupWithCache` wires the app's storage and fetch.
 */

export type { DictionaryEntry, DictionaryErrorCode };
export { DictionaryError };

interface CacheEntry {
  entry?: DictionaryEntry;
  errorCode?: DictionaryErrorCode;
  expiresAt: number;
}

/** The SQLite cache subset a lookup needs. */
export type DictionaryCachePort = Pick<
  DictionaryCacheRepository,
  'get' | 'set' | 'pruneExpired' | 'prune'
>;

export interface DictionaryLookupDeps {
  now: () => number;
  fetchEntry: (word: string, signal?: AbortSignal) => Promise<DictionaryEntry>;
  cache: DictionaryCachePort | null;
  /** Session cache; tests pass their own. */
  memory: Map<string, CacheEntry>;
}

const HIT_TTL_MS = 24 * 60 * 60_000;
const MISS_TTL_MS = 10 * 60_000;
const MAX_MEMORY_ENTRIES = 200;
/** Oldest rows beyond this are dropped on write; rows are a few hundred bytes. */
const MAX_PERSISTED_ENTRIES = 2000;

const ERROR_CODES: ReadonlySet<string> = new Set([
  'NO_DEFINITION',
  'NETWORK',
  'RATE_LIMITED',
  'PARSE_FAILED',
]);

const sessionMemory = new Map<string, CacheEntry>();

const cacheKey = (word: string): string => word.trim().toLocaleLowerCase();

/** A row written by an older build (or a corrupt one) is a miss, not a crash. */
const parseEntry = (json: string | null): DictionaryEntry | null => {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<DictionaryEntry> | null;
    if (
      value &&
      typeof value.title === 'string' &&
      typeof value.source === 'string' &&
      typeof value.sourceLabel === 'string' &&
      typeof value.license === 'string' &&
      typeof value.url === 'string' &&
      (value.dir === 'rtl' || value.dir === 'ltr') &&
      Array.isArray(value.lines) &&
      value.lines.every((line) => typeof line === 'string')
    ) {
      return value as DictionaryEntry;
    }
  } catch {
    // Fall through: re-fetch.
  }
  return null;
};

const remember = (memory: Map<string, CacheEntry>, key: string, value: CacheEntry): void => {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
};

/** Best-effort persistence: a storage failure never surfaces to the reader. */
const persist = (
  cache: DictionaryCachePort,
  row: {
    key: string;
    source: string | null;
    entryJson: string | null;
    errorCode: DictionaryErrorCode | null;
    expiresAt: number;
    createdAt: number;
  },
): Promise<void> =>
  cache
    .set(row)
    .then(() => cache.prune(MAX_PERSISTED_ENTRIES))
    .catch(() => undefined);

export const runDictionaryLookup = async (
  word: string,
  deps: DictionaryLookupDeps,
  signal?: AbortSignal,
): Promise<DictionaryEntry> => {
  const key = cacheKey(word);
  const now = deps.now();

  const hit = deps.memory.get(key);
  if (hit) {
    if (hit.expiresAt > now) {
      if (hit.entry) return hit.entry;
      throw new DictionaryError(hit.errorCode ?? 'NO_DEFINITION');
    }
    deps.memory.delete(key);
  }

  const stored = deps.cache ? await deps.cache.get(key).catch(() => null) : null;
  if (stored && stored.expiresAt > now) {
    const entry = parseEntry(stored.entryJson);
    if (entry) {
      remember(deps.memory, key, { entry, expiresAt: stored.expiresAt });
      return entry;
    }
    // A hit row that no longer parses (older build, corrupt JSON) is refetched;
    // only a row that recorded a miss replays it.
    if (stored.errorCode) {
      const errorCode = ERROR_CODES.has(stored.errorCode)
        ? (stored.errorCode as DictionaryErrorCode)
        : 'NO_DEFINITION';
      remember(deps.memory, key, { errorCode, expiresAt: stored.expiresAt });
      throw new DictionaryError(errorCode);
    }
  }

  let entry: DictionaryEntry;
  try {
    entry = await deps.fetchEntry(word, signal);
  } catch (error) {
    // Aborts and unexpected failures are not cached; a typed miss is.
    if (error instanceof DictionaryError) {
      const expiresAt = now + MISS_TTL_MS;
      remember(deps.memory, key, { errorCode: error.code, expiresAt });
      if (deps.cache) {
        await persist(deps.cache, {
          key,
          source: null,
          entryJson: null,
          errorCode: error.code,
          expiresAt,
          createdAt: now,
        });
      }
    }
    throw error;
  }

  const expiresAt = now + HIT_TTL_MS;
  remember(deps.memory, key, { entry, expiresAt });
  if (deps.cache) {
    await persist(deps.cache, {
      key,
      source: entry.source,
      entryJson: JSON.stringify(entry),
      errorCode: null,
      expiresAt,
      createdAt: now,
    });
  }
  return entry;
};

const defaultFetchEntry = (word: string, signal?: AbortSignal): Promise<DictionaryEntry> => {
  const fetchPort = providerFetch('') as Parameters<typeof lookupWord>[1];
  return lookupWord(
    word,
    fetchPort,
    (html) => new DOMParser().parseFromString(html, 'text/html'),
    signal,
  );
};

let expiredPruned = false;

/**
 * Storage accessor for lookups. Expired rows are swept once per session, off
 * the lookup path; the core still checks `expiresAt` so a stale row never wins.
 */
const activeCache = (): DictionaryCachePort | null => {
  const cache = getActiveStorage()?.dictionaryCache ?? null;
  if (cache && !expiredPruned) {
    expiredPruned = true;
    void cache.pruneExpired(Date.now()).catch(() => undefined);
  }
  return cache;
};

export const lookupWithCache = (word: string, signal?: AbortSignal): Promise<DictionaryEntry> =>
  runDictionaryLookup(
    word,
    {
      now: Date.now,
      fetchEntry: defaultFetchEntry,
      cache: activeCache(),
      memory: sessionMemory,
    },
    signal,
  );
