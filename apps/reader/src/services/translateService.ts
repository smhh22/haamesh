/**
 * Translation pipeline: cache-first, provider fallback chain, sentence-aware
 * chunking (ADR-0016). The pure core (`runTranslation`) takes injected
 * providers + cache and is unit-testable; `translateText` wires the app's
 * settings, keychain, HTTP port, and SQLite cache.
 */
import {
  createLibreTranslateProvider,
  createMyMemoryProvider,
  createOpenAiCompatibleTranslationProvider,
  type FetchPort,
  TranslationError,
  type TranslationProvider,
  translationCacheKey,
} from '@hamesh/ai';
import type { TranslationCacheRepository } from '@hamesh/storage';
import { loadAiSettings, resolveAiSecrets, type TranslationProviderConfig } from './aiSettings';
import { providerFetch } from './httpFetch';
import { getActiveStorage } from './libraryPersistence';

export interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  bookTitle?: string | null;
  bookAuthor?: string | null;
  signal?: AbortSignal;
}

export interface TranslateOutcome {
  text: string;
  providerId: string;
  /** True when the result came from the local cache (no network). */
  cached: boolean;
}

interface CachePort {
  get(key: string): Promise<string | null>;
  set(entry: {
    key: string;
    provider: string;
    sourceLang: string;
    targetLang: string;
    value: string;
    createdAt: number;
  }): Promise<void>;
  prune(maxEntries: number): Promise<void>;
}

const CACHE_LIMIT = 2000;

/**
 * Split text above `maxChars` on sentence boundaries, then hard-split any
 * remaining oversized sentence. Persian/Arabic punctuation included.
 */
export const chunkText = (text: string, maxChars: number): string[] => {
  if (text.length <= maxChars) return [text];
  const sentences: string[] = [];
  const segmenter =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'sentence' })
      : null;
  if (segmenter) {
    for (const part of segmenter.segment(text)) sentences.push(part.segment);
  } else {
    sentences.push(...text.split(/(?<=[.!?؟۔…؛])\s+/));
  }
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      pushCurrent();
      for (let index = 0; index < sentence.length; index += maxChars) {
        chunks.push(sentence.slice(index, index + maxChars));
      }
      continue;
    }
    if (current.length + sentence.length > maxChars) pushCurrent();
    current += sentence;
  }
  pushCurrent();
  return chunks;
};

/** Cache key includes the chunk count so chunked results stay distinguishable. */
const bookCacheKey = (
  provider: TranslationProvider,
  model: string | null,
  request: TranslateRequest,
  chunkCount: number,
): string =>
  translationCacheKey({
    provider: provider.id,
    model,
    sourceLang: request.sourceLang,
    targetLang: request.targetLang,
    text: chunkCount > 1 ? `${chunkCount}\u0000${request.text}` : request.text,
  });

/**
 * Core pipeline over an ordered provider list. Returns the first success; a
 * quota/auth/language failure falls through to the next provider, while a
 * user cancellation stops immediately.
 */
export const runTranslation = async (
  providers: TranslationProvider[],
  cache: CachePort | null,
  request: TranslateRequest,
): Promise<TranslateOutcome> => {
  if (providers.length === 0) {
    throw new TranslationError('PROVIDER_ERROR', 'no translation provider enabled');
  }
  let lastError: TranslationError | null = null;
  for (const provider of providers) {
    const chunks = chunkText(request.text, provider.capabilities.maxChars);
    const cacheKey = bookCacheKey(provider, null, request, chunks.length);
    if (cache) {
      const hit = await cache.get(cacheKey).catch(() => null);
      if (hit !== null) return { text: hit, providerId: provider.id, cached: true };
    }
    try {
      const parts: string[] = [];
      for (const chunk of chunks) {
        const result = await provider.translate({
          text: chunk,
          sourceLang: request.sourceLang,
          targetLang: request.targetLang,
          signal: request.signal,
        });
        parts.push(result.text);
      }
      const text = parts.join(chunks.length > 1 ? ' ' : '');
      if (cache) {
        await cache
          .set({
            key: cacheKey,
            provider: provider.id,
            sourceLang: request.sourceLang,
            targetLang: request.targetLang,
            value: text,
            createdAt: Date.now(),
          })
          .then(() => cache.prune(CACHE_LIMIT))
          .catch(() => undefined);
      }
      return { text, providerId: provider.id, cached: false };
    } catch (error) {
      const failure =
        error instanceof TranslationError
          ? error
          : new TranslationError('PROVIDER_ERROR', String(error));
      if (failure.code === 'CANCELLED') throw failure;
      lastError = failure;
      // Try the next provider for anything recoverable; TOO_LONG is already
      // handled by chunking, so it only appears for a single oversized chunk.
    }
  }
  throw lastError ?? new TranslationError('PROVIDER_ERROR');
};

/** Build the configured providers in their saved order (enabled ones only). */
export const buildTranslationProviders = async (): Promise<TranslationProvider[]> => {
  const settings = loadAiSettings(
    typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en',
  );
  const providers: TranslationProvider[] = [];
  for (const config of settings.providers) {
    if (!config.enabled) continue;
    const resolved = await resolveAiSecrets(config);
    const fetchPort: FetchPort = providerFetch(config.proxy) as FetchPort;
    const provider = providerFromConfig(resolved, fetchPort);
    if (provider) providers.push(provider);
  }
  return providers;
};

export const providerFromConfig = (
  config: TranslationProviderConfig,
  fetchPort: FetchPort,
): TranslationProvider | null => {
  switch (config.kind) {
    case 'mymemory':
      return createMyMemoryProvider({ email: config.email || undefined }, fetchPort);
    case 'libretranslate':
      return config.baseUrl
        ? createLibreTranslateProvider(
            { baseUrl: config.baseUrl, apiKey: config.apiKey || undefined },
            fetchPort,
          )
        : null;
    case 'openai-compatible':
      return config.baseUrl && config.model
        ? createOpenAiCompatibleTranslationProvider(
            { baseUrl: config.baseUrl, apiKey: config.apiKey || undefined, model: config.model },
            fetchPort,
          )
        : null;
    default:
      return null;
  }
};

/** Translate with the user's configured providers; cache lives in SQLite. */
export const translateText = async (request: TranslateRequest): Promise<TranslateOutcome> => {
  const providers = await buildTranslationProviders();
  const cache = (getActiveStorage()?.translationCache ?? null) as TranslationCacheRepository | null;
  return runTranslation(providers, cache, request);
};
