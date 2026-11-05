import { describe, expect, it } from 'vitest';
import { createLibreTranslateProvider } from './providers/libreTranslate';
import { createMyMemoryProvider } from './providers/myMemory';
import { createOpenAiCompatibleTranslationProvider } from './providers/openaiCompatible';
import { TranslationError } from './types';

interface Call {
  url: string;
  init?: RequestInit;
}

const fakeFetch = (
  responder: (call: Call) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Call[] } => {
  const calls: Call[] = [];
  const fetchPort = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetch: fetchPort, calls };
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const request = {
  text: 'hello',
  sourceLang: 'en',
  targetLang: 'fa',
};

describe('myMemory provider', () => {
  it('builds the documented query and returns the translation', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ responseStatus: 200, responseData: { translatedText: 'سلام' } }),
    );
    const provider = createMyMemoryProvider({}, fetch);
    const result = await provider.translate(request);
    expect(result.text).toBe('سلام');
    expect(calls[0]?.url).toContain('https://api.mymemory.translated.net/get?');
    expect(calls[0]?.url).toContain('langpair=en%7Cfa');
    expect(calls[0]?.url).toContain('q=hello');
  });

  it('maps quota and rate limits to distinct codes', async () => {
    const quota = createMyMemoryProvider({}, fakeFetch(() => json({}, 403)).fetch);
    await expect(quota.translate(request)).rejects.toMatchObject({ code: 'QUOTA' });
    const limited = createMyMemoryProvider({}, fakeFetch(() => json({}, 429)).fetch);
    await expect(limited.translate(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('reports a provider error for an in-band failure status', async () => {
    const provider = createMyMemoryProvider(
      {},
      fakeFetch(() =>
        json({ responseStatus: 403, responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE' }),
      ).fetch,
    );
    await expect(provider.translate(request)).rejects.toMatchObject({ code: 'QUOTA' });
  });

  it('refuses oversized text before calling the network', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const provider = createMyMemoryProvider({}, fetch);
    await expect(provider.translate({ ...request, text: 'x'.repeat(451) })).rejects.toBeInstanceOf(
      TranslationError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('libreTranslate provider', () => {
  it('posts the documented payload', async () => {
    const { fetch, calls } = fakeFetch(() => json({ translatedText: 'سلام' }));
    const provider = createLibreTranslateProvider({ baseUrl: 'http://localhost:5000/' }, fetch);
    const result = await provider.translate({ ...request, sourceLang: 'auto' });
    expect(result.text).toBe('سلام');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({ q: 'hello', source: 'auto', target: 'fa', format: 'text' });
    expect(calls[0]?.url).toBe('http://localhost:5000/translate');
  });

  it('maps auth, language, and rate errors', async () => {
    const auth = createLibreTranslateProvider(
      { baseUrl: 'http://lan:5000' },
      fakeFetch(() => json({}, 401)).fetch,
    );
    await expect(auth.translate(request)).rejects.toMatchObject({ code: 'AUTH' });
    const lang = createLibreTranslateProvider(
      { baseUrl: 'http://lan:5000' },
      fakeFetch(() => json({ error: 'Invalid language pair' }, 400)).fetch,
    );
    await expect(lang.translate(request)).rejects.toMatchObject({ code: 'UNSUPPORTED_LANG' });
    const limited = createLibreTranslateProvider(
      { baseUrl: 'http://lan:5000' },
      fakeFetch(() => json({}, 429)).fetch,
    );
    await expect(limited.translate(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('rejects a non-http base URL without a request', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const provider = createLibreTranslateProvider({ baseUrl: 'file:///etc' }, fetch);
    await expect(provider.translate(request)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(calls).toHaveLength(0);
  });
});

describe('openai-compatible translation provider', () => {
  it('sends the translation prompt and returns the completion', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ choices: [{ message: { content: '  سلام  ' } }] }),
    );
    const provider = createOpenAiCompatibleTranslationProvider(
      { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
      fetch,
    );
    const result = await provider.translate(request);
    expect(result.text).toBe('سلام');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.model).toBe('llama3');
    expect(body.messages[0].content).toContain('professional literary translator');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('maps auth and rate limits', async () => {
    const auth = createOpenAiCompatibleTranslationProvider(
      { baseUrl: 'http://x/v1', model: 'm' },
      fakeFetch(() => json({}, 401)).fetch,
    );
    await expect(auth.translate(request)).rejects.toMatchObject({ code: 'AUTH' });
    const limited = createOpenAiCompatibleTranslationProvider(
      { baseUrl: 'http://x/v1', model: 'm' },
      fakeFetch(() => json({}, 429)).fetch,
    );
    await expect(limited.translate(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
