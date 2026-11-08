import type { FetchPort } from './types';

/**
 * Dictionary lookup providers (ADR-0024): online keyless sources only, over
 * an injected fetch (the app passes its proxy-aware provider fetch; tests
 * pass fakes). No DOM parsing here beyond structured JSON — the Wiktionary
 * native parse returns sanitized plain-text lines built from the rendered
 * HTML in an inert DOMParser document owned by the caller's environment.
 *
 * Every result carries its source label, license note, and a citation URL —
 * the panel shows them (CC BY-SA / CC BY-SA 3.0 attribution requirement).
 */

export type DictionaryErrorCode = 'NO_DEFINITION' | 'NETWORK' | 'RATE_LIMITED' | 'PARSE_FAILED';

export class DictionaryError extends Error {
  readonly code: DictionaryErrorCode;
  readonly detail: string | null;

  constructor(code: DictionaryErrorCode, detail: string | null = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DictionaryError';
    this.code = code;
    this.detail = detail;
  }
}

export interface DictionaryEntry {
  /** The word as the source resolved it (redirects applied). */
  title: string;
  source: 'wiktionary-native' | 'wiktionary-definition' | 'wikipedia-summary';
  sourceLabel: string;
  /** Attribution line shown under the definitions. */
  license: string;
  /** Canonical citation URL. */
  url: string;
  /** Content direction, from the source language. */
  dir: 'rtl' | 'ltr';
  /** Plain-text definition lines / summary paragraphs. */
  lines: string[];
}

const API_USER_AGENT = 'Hamesh/2.x (local-first ebook reader; https://github.com/smhh22/haamesh)';

const fetchJson = async (url: string, fetchPort: FetchPort, signal?: AbortSignal) => {
  const response = await fetchPort(url, {
    headers: { 'Api-User-Agent': API_USER_AGENT },
    signal,
  });
  if (response.status === 429) throw new DictionaryError('RATE_LIMITED', url);
  if (!response.ok) throw new DictionaryError('NETWORK', `${response.status} ${url}`);
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new DictionaryError('PARSE_FAILED', `invalid JSON from ${url}`);
  }
};

const hasPersian = (word: string): boolean =>
  /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF]/.test(word);

/**
 * Wikipedia REST summary (lead section, plain text). Works for fa and en;
 * the right fallback for names, places, and concepts Wiktionary lacks.
 */
export const wikipediaSummary = async (
  lang: 'fa' | 'en',
  word: string,
  fetchPort: FetchPort,
  signal?: AbortSignal,
): Promise<DictionaryEntry> => {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`;
  const data = (await fetchJson(url, fetchPort, signal)) as {
    type?: string;
    title?: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
  };
  if (data.type === 'disambiguation' || !data.extract?.trim()) {
    throw new DictionaryError('NO_DEFINITION', url);
  }
  return {
    title: data.title ?? word,
    source: 'wikipedia-summary',
    sourceLabel: lang === 'fa' ? 'ویکی‌پدیا' : 'Wikipedia',
    license: 'CC BY-SA 4.0',
    url: data.content_urls?.desktop?.page ?? url,
    dir: lang === 'fa' ? 'rtl' : 'ltr',
    lines: [data.extract.trim()],
  };
};

interface WiktionaryDefinition {
  language?: string;
  definitions?: Array<{ definition?: string; examples?: string[] }>;
}

/**
 * English Wiktionary structured definition (REST). Returns the glosses for
 * the requested language section — Persian words carry English glosses under
 * the `fa` key, English words under `en`.
 */
export const wiktionaryDefinition = async (
  word: string,
  lang: 'fa' | 'en',
  fetchPort: FetchPort,
  signal?: AbortSignal,
): Promise<DictionaryEntry> => {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  const data = (await fetchJson(url, fetchPort, signal)) as Record<string, WiktionaryDefinition[]>;
  const section = data[lang];
  const lines = (section ?? [])
    .flatMap((part) => part.definitions ?? [])
    .map((definition) => definition.definition?.replace(/<[^>]+>/g, '').trim() ?? '')
    .filter((line) => line.length > 0);
  if (lines.length === 0) throw new DictionaryError('NO_DEFINITION', url);
  return {
    title: word,
    source: 'wiktionary-definition',
    sourceLabel: 'Wiktionary (English)',
    license: 'CC BY-SA 4.0',
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
    dir: lang === 'fa' ? 'rtl' : 'ltr',
    lines,
  };
};

/**
 * fa.wiktionary native parse via the Action API (`origin=*` for anonymous
 * CORS). The rendered HTML is parsed in an inert DOMParser document owned by
 * the caller's realm and reduced to plain-text definition lines from the
 * Persian language section's lists — never inserted as HTML.
 */
export const wiktionaryNativeParse = async (
  word: string,
  fetchPort: FetchPort,
  domParser: (html: string) => Document,
  signal?: AbortSignal,
): Promise<DictionaryEntry> => {
  const url =
    `https://fa.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2` +
    `&prop=text&page=${encodeURIComponent(word)}&redirects=1&disableeditsection=1` +
    `&disabletoc=1&origin=*`;
  const data = (await fetchJson(url, fetchPort, signal)) as {
    parse?: { text?: string; title?: string };
    error?: { code?: string };
  };
  if (data.error?.code === 'missingtitle' || !data.parse?.text) {
    throw new DictionaryError('NO_DEFINITION', url);
  }
  const doc = domParser(data.parse.text);
  for (const node of doc.querySelectorAll(
    'script, style, link, img, audio, video, figure, table, .mw-editsection, .noprint, sup.reference',
  )) {
    node.remove();
  }
  // Keep only the Persian language section (h2 whose id starts with فا).
  const persianId = Array.from(doc.querySelectorAll('h2'))
    .map((heading) => heading.id || '')
    .find((id) => id.startsWith('فا'));
  const lines: string[] = [];
  // Compare section ids, not node identity: querySelectorAll returns fresh
  // wrappers in some realms.
  let collecting = persianId === undefined ? false : true;
  for (const element of doc.body.querySelectorAll('h2, ol > li')) {
    if (element.tagName === 'H2') {
      collecting = (element.id || '') === persianId;
      continue;
    }
    if (!collecting) continue;
    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (text.length > 1 && !lines.includes(text)) lines.push(text);
  }
  if (lines.length === 0) throw new DictionaryError('NO_DEFINITION', url);
  return {
    title: data.parse.title ?? word,
    source: 'wiktionary-native',
    sourceLabel: 'ویکی‌واژه',
    license: 'CC BY-SA 4.0',
    url: `https://fa.wiktionary.org/wiki/${encodeURIComponent(word)}`,
    dir: 'rtl',
    lines: lines.slice(0, 12),
  };
};

/** The lookup chain for one word, per ADR-0024. First success wins. */
export const lookupWord = async (
  word: string,
  fetchPort: FetchPort,
  domParser: (html: string) => Document,
  signal?: AbortSignal,
): Promise<DictionaryEntry> => {
  const trimmed = word.trim();
  if (!trimmed) throw new DictionaryError('NO_DEFINITION', 'empty word');
  const persian = hasPersian(trimmed);
  const chain: Array<() => Promise<DictionaryEntry>> = persian
    ? [
        () => wiktionaryNativeParse(trimmed, fetchPort, domParser, signal),
        () => wikipediaSummary('fa', trimmed, fetchPort, signal),
        () => wiktionaryDefinition(trimmed, 'fa', fetchPort, signal),
        () => wikipediaSummary('en', trimmed, fetchPort, signal),
      ]
    : [
        () => wiktionaryDefinition(trimmed, 'en', fetchPort, signal),
        () => wikipediaSummary('en', trimmed, fetchPort, signal),
      ];
  let lastError: DictionaryError | null = null;
  for (const step of chain) {
    try {
      return await step();
    } catch (error) {
      if (error instanceof DictionaryError && error.code === 'RATE_LIMITED') throw error;
      lastError =
        error instanceof DictionaryError ? error : new DictionaryError('NETWORK', String(error));
    }
  }
  throw lastError ?? new DictionaryError('NO_DEFINITION');
};
