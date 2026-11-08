import { describe, expect, it } from 'vitest';
import {
  DictionaryError,
  lookupWord,
  wikipediaSummary,
  wiktionaryDefinition,
  wiktionaryNativeParse,
} from './dictionary';

/** Minimal inert DOMParser stand-in: strips tags, keeps text, knows h2 ids. */
const fakeParser =
  (h2Ids: string[] = [], listItems: string[] = []) =>
  (html: string) => {
    const text = html.replace(/<[^>]+>/g, ' ');
    const doc = {
      body: {
        querySelectorAll: (selector: string) => {
          if (selector === 'h2, ol > li') {
            const h2s = h2Ids.map((id) => ({ tagName: 'H2', id, textContent: id }));
            const lis = listItems.map((item) => ({ tagName: 'LI', id: '', textContent: item }));
            return [...h2s, ...lis] as unknown as NodeListOf<Element>;
          }
          return [] as unknown as NodeListOf<Element>;
        },
      },
      querySelectorAll: (selector: string) => {
        if (selector === 'h2') {
          return h2Ids.map((id) => ({
            tagName: 'H2',
            id,
            textContent: id,
          })) as unknown as NodeListOf<Element>;
        }
        return [] as unknown as NodeListOf<Element>;
      },
      querySelector: () => null,
    };
    return doc as unknown as Document;
  };

const jsonFetch = (bodies: Record<string, unknown>, status = 200) => {
  const calls: string[] = [];
  const fetchPort = (async (input: string) => {
    calls.push(input);
    const hit = Object.keys(bodies).find((key) => input.includes(key));
    if (!hit) {
      return new Response(JSON.stringify({ error: 'missingtitle' }), {
        status: status === 200 ? 404 : status,
      });
    }
    return new Response(JSON.stringify(bodies[hit]), { status });
  }) as never as import('./types').FetchPort;
  return { fetchPort, calls };
};

describe('wikipediaSummary', () => {
  it('returns the lead extract with attribution', async () => {
    const { fetchPort } = jsonFetch({
      '/api/rest_v1/page/summary/': {
        type: 'standard',
        title: 'آب',
        extract: 'آب یک ترکیب شیمیایی است.',
        content_urls: { desktop: { page: 'https://fa.wikipedia.org/wiki/آب' } },
      },
    });
    const entry = await wikipediaSummary('fa', 'آب', fetchPort);
    expect(entry.title).toBe('آب');
    expect(entry.lines).toEqual(['آب یک ترکیب شیمیایی است.']);
    expect(entry.license).toBe('CC BY-SA 4.0');
    expect(entry.dir).toBe('rtl');
    expect(entry.url).toContain('fa.wikipedia.org');
  });

  it('reports NO_DEFINITION for disambiguation pages', async () => {
    const { fetchPort } = jsonFetch({
      '/api/rest_v1/page/summary/': { type: 'disambiguation', extract: '' },
    });
    await expect(wikipediaSummary('en', 'mercury', fetchPort)).rejects.toMatchObject({
      code: 'NO_DEFINITION',
    });
  });
});

describe('wiktionaryDefinition', () => {
  it('extracts plain-text glosses for the requested language', async () => {
    const { fetchPort } = jsonFetch({
      '/api/rest_v1/page/definition/': {
        fa: [{ definitions: [{ definition: 'water' }, { definition: '<b>liquid</b>' }] }],
        en: [{ definitions: [{ definition: 'unrelated' }] }],
      },
    });
    const entry = await wiktionaryDefinition('آب', 'fa', fetchPort);
    expect(entry.lines).toEqual(['water', 'liquid']);
    expect(entry.dir).toBe('rtl');
    expect(entry.sourceLabel).toBe('Wiktionary (English)');
  });

  it('reports NO_DEFINITION when the language section is missing', async () => {
    const { fetchPort } = jsonFetch({
      '/api/rest_v1/page/definition/': { en: [{ definitions: [{ definition: 'x' }] }] },
    });
    await expect(wiktionaryDefinition('آب', 'fa', fetchPort)).rejects.toMatchObject({
      code: 'NO_DEFINITION',
    });
  });
});

describe('wiktionaryNativeParse', () => {
  it('keeps only the Persian section lines', async () => {
    const { fetchPort } = jsonFetch({
      'action=parse': {
        parse: {
          title: 'آب',
          text:
            '<h2 id="انگلیسی">English</h2><ol><li>ignored</li></ol>' +
            '<h2 id="فا">فارسی</h2><ol><li>سیال شفاف</li><li>سیال شفاف</li><li>در دریا</li></ol>',
        },
      },
    });
    const entry = await wiktionaryNativeParse(
      'آب',
      fetchPort,
      fakeParser(['انگلیسی', 'فا'], ['سیال شفاف', 'سیال شفاف', 'در دریا']),
    );
    expect(entry.lines).toEqual(['سیال شفاف', 'در دریا']);
    expect(entry.sourceLabel).toBe('ویکی‌واژه');
    expect(entry.dir).toBe('rtl');
  });

  it('reports NO_DEFINITION without a Persian section', async () => {
    const { fetchPort } = jsonFetch({
      'action=parse': { parse: { title: 'x', text: '<h2 id="en">English</h2>' } },
    });
    await expect(wiktionaryNativeParse('x', fetchPort, fakeParser(['en']))).rejects.toMatchObject({
      code: 'NO_DEFINITION',
    });
  });
});

describe('lookupWord chain', () => {
  it('prefers fa sources for Persian words and stops at the first success', async () => {
    const { fetchPort, calls } = jsonFetch({
      'action=parse': {
        parse: { title: 'آب', text: '<h2 id="فا">فارسی</h2><ol><li>سیال</li></ol>' },
      },
    });
    const entry = await lookupWord('آب', fetchPort, fakeParser(['فا'], ['سیال']));
    expect(entry.source).toBe('wiktionary-native');
    // Only the first source ran; no wikipedia/wiktionary-definition calls.
    expect(calls.every((url) => url.includes('fa.wiktionary.org'))).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('falls through to the next source on NO_DEFINITION', async () => {
    const { fetchPort, calls } = jsonFetch({
      '/api/rest_v1/page/summary/': {
        type: 'standard',
        title: 'X',
        extract: 'A concept.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/X' } },
      },
    });
    const entry = await lookupWord('xyzzy', fetchPort, fakeParser());
    expect(entry.source).toBe('wikipedia-summary');
    expect(calls.some((url) => url.includes('en.wikipedia.org'))).toBe(true);
  });

  it('propagates RATE_LIMITED immediately without falling through', async () => {
    const { fetchPort } = jsonFetch({}, 429);
    await expect(lookupWord('word', fetchPort, fakeParser())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('maps unknown fetch failures to NETWORK through the chain', async () => {
    const failing = (async () => {
      throw new Error('boom');
    }) as never as import('./types').FetchPort;
    await expect(lookupWord('word', failing, fakeParser())).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });
});
