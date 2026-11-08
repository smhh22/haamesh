import {
  type DictionaryEntry,
  DictionaryError,
  type DictionaryErrorCode,
  lookupWord,
} from '@hamesh/ai';
import { providerFetch } from './httpFetch';

/**
 * Dictionary lookup service (ADR-0024): the online keyless chain with an
 * in-memory session cache. Hits and short-lived misses both cache so paging
 * through a book does not hammer the APIs; the SQLite cache (storage v7)
 * follows in its own migration PR.
 */

export type { DictionaryEntry, DictionaryErrorCode };
export { DictionaryError };

interface CacheEntry {
  entry?: DictionaryEntry;
  errorCode?: DictionaryErrorCode;
  expiresAt: number;
}

const HIT_TTL_MS = 24 * 60 * 60_000;
const MISS_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 200;

const cache = new Map<string, CacheEntry>();

const cacheKey = (word: string): string => word.trim().toLocaleLowerCase();

export const lookupDefinition = async (
  word: string,
  signal?: AbortSignal,
): Promise<DictionaryEntry> => {
  const key = cacheKey(word);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    if (hit.entry) return hit.entry;
    throw new DictionaryError(hit.errorCode ?? 'NO_DEFINITION');
  }
  const fetchPort = providerFetch('') as Parameters<typeof lookupWord>[1];
  const entry = await lookupWord(word, fetchPort, (html) =>
    new DOMParser().parseFromString(html, 'text/html'),
  );
  cache.set(key, { entry, expiresAt: Date.now() + HIT_TTL_MS });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return entry;
};

/** A miss is cached briefly so unknown words do not re-hit the APIs. */
export const rememberLookupMiss = (word: string, code: DictionaryErrorCode): void => {
  cache.set(cacheKey(word), { errorCode: code, expiresAt: Date.now() + MISS_TTL_MS });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
};

export const lookupWithCache = async (
  word: string,
  signal?: AbortSignal,
): Promise<DictionaryEntry> => {
  try {
    return await lookupDefinition(word, signal);
  } catch (error) {
    if (error instanceof DictionaryError) rememberLookupMiss(word, error.code);
    throw error;
  }
};
