import { TranslationError, type TranslationProvider } from '@hamesh/ai';
import { describe, expect, it } from 'vitest';
import { chunkText, runTranslation } from './translateService';

const fakeProvider = (
  id: string,
  translate: TranslationProvider['translate'],
  maxChars = 1000,
): TranslationProvider => ({
  id,
  label: id,
  capabilities: { maxChars, needsKey: false, worksInWeb: true },
  translate,
});

const memoryCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (entry: { key: string; value: string }) => {
      store.set(entry.key, entry.value);
    },
    prune: async () => undefined,
  };
};

const request = { text: 'hello world', sourceLang: 'en', targetLang: 'fa' };

describe('chunkText', () => {
  it('passes short text through untouched', () => {
    expect(chunkText('سلام دنیا', 100)).toEqual(['سلام دنیا']);
  });

  it('splits Persian sentences at their own punctuation', () => {
    const text = 'جملهٔ اول است. جملهٔ دوم است؟ جملهٔ سوم است!';
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('hard-splits a single oversized sentence', () => {
    const chunks = chunkText('x'.repeat(45), 20);
    expect(chunks).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(5)]);
  });
});

describe('runTranslation', () => {
  it('returns cached results without touching the network', async () => {
    const cache = memoryCache();
    let calls = 0;
    const provider = fakeProvider('a', async () => {
      calls += 1;
      return { text: 'ترجمه' };
    });
    await runTranslation([provider], cache, request);
    const second = await runTranslation([provider], cache, request);
    expect(second).toMatchObject({ text: 'ترجمه', providerId: 'a', cached: true });
    expect(calls).toBe(1);
  });

  it('falls through to the next provider on quota errors', async () => {
    const cache = memoryCache();
    const failing = fakeProvider('first', async () => {
      throw new TranslationError('QUOTA');
    });
    const working = fakeProvider('second', async () => ({ text: 'ترجمه' }));
    const outcome = await runTranslation([failing, working], cache, request);
    expect(outcome.providerId).toBe('second');
    expect(outcome.cached).toBe(false);
    expect(cache.store.size).toBe(1);
  });

  it('stops immediately on cancellation', async () => {
    const second = fakeProvider('second', async () => ({ text: 'unused' }));
    const cancelled = fakeProvider('first', async () => {
      throw new TranslationError('CANCELLED');
    });
    await expect(runTranslation([cancelled, second], memoryCache(), request)).rejects.toMatchObject(
      {
        code: 'CANCELLED',
      },
    );
  });

  it('surfaces the last failure when every provider fails', async () => {
    const first = fakeProvider('first', async () => {
      throw new TranslationError('AUTH');
    });
    const second = fakeProvider('second', async () => {
      throw new TranslationError('RATE_LIMITED');
    });
    await expect(runTranslation([first, second], null, request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('chunks oversized text and reassembles it', async () => {
    const seen: string[] = [];
    const provider = fakeProvider(
      'chunky',
      async (incoming) => {
        seen.push(incoming.text);
        return { text: `<${incoming.text}>` };
      },
      10,
    );
    const long = { ...request, text: 'aaaa bbbb cccc dddd' };
    const outcome = await runTranslation([provider], null, long);
    expect(seen.length).toBeGreaterThan(1);
    expect(outcome.text.startsWith('<')).toBe(true);
    expect(outcome.text).toContain('aaaa');
  });

  it('does not reuse cached results across models of the same provider id', async () => {
    const cache = memoryCache();
    let calls = 0;
    const provider = (model: string) => ({
      ...fakeProvider('openai-compatible', async () => {
        calls += 1;
        return { text: model };
      }),
      model,
    });
    const first = await runTranslation([provider('model-a')], cache, request);
    const second = await runTranslation([provider('model-b')], cache, request);
    expect(first.text).toBe('model-a');
    expect(second.text).toBe('model-b');
    expect(calls).toBe(2);
    expect(cache.store.size).toBe(2);
  });

  it('rejects when no provider is configured', async () => {
    await expect(runTranslation([], null, request)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });
});
