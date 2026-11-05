/**
 * Translation cache keys (ADR-0016): v1:provider:model:src>tgt:sha256(text).
 * Hashing normalizes Persian/Arabic variants so the same sentence typed or
 * lifted from different typography shares a cache entry; the payload itself is
 * never modified.
 */
import { sha256Hex } from './hash';

export interface CacheKeyInput {
  provider: string;
  model?: string | null;
  sourceLang: string;
  targetLang: string;
  text: string;
}

/** Normalization is for the cache key only (never for what is sent). */
const normalizeForCache = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();

export const translationCacheKey = (input: CacheKeyInput): string => {
  const digest = sha256Hex(normalizeForCache(input.text));
  const model = input.model ?? '';
  return `v1:${input.provider}:${model}:${input.sourceLang}>${input.targetLang}:${digest}`;
};
