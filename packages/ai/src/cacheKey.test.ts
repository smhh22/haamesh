import { describe, expect, it } from 'vitest';
import { translationCacheKey } from './cacheKey';

describe('translationCacheKey', () => {
  const base = {
    provider: 'mymemory',
    sourceLang: 'en',
    targetLang: 'fa',
    text: 'The quick brown fox',
  };

  it('is stable for identical input', () => {
    expect(translationCacheKey(base)).toBe(translationCacheKey({ ...base }));
  });

  it('is insensitive to Persian/Arabic yeh and kaf variants and whitespace', () => {
    const arabic = { ...base, text: 'كتابي  براى  من' };
    const persian = { ...base, text: 'کتابی براى من' };
    expect(translationCacheKey(arabic)).toBe(translationCacheKey(persian));
  });

  it('separates providers, languages, models, and texts', () => {
    const key = translationCacheKey(base);
    expect(translationCacheKey({ ...base, provider: 'libretranslate' })).not.toBe(key);
    expect(translationCacheKey({ ...base, targetLang: 'ar' })).not.toBe(key);
    expect(translationCacheKey({ ...base, model: 'gpt' })).not.toBe(key);
    expect(translationCacheKey({ ...base, text: 'Different' })).not.toBe(key);
  });

  it('carries the prompt-independent prefix', () => {
    expect(translationCacheKey(base)).toMatch(/^v1:mymemory::en>fa:[0-9a-f]{64}$/);
  });
});
