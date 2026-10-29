import type { BookMetadata } from '@hamesh/core';
import { makeBook } from 'foliate-js/view.js';
import { resolveBookDirection } from './direction';

export type ImportErrorCode =
  | 'INVALID_FILE'
  | 'UNSUPPORTED_FORMAT'
  | 'CRYPTO_UNAVAILABLE'
  | 'PARSE_FAILED';

export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImportError';
    this.code = code;
  }
}

export interface ImportedBook {
  metadata: BookMetadata;
  cover: Blob | null;
}

const languageMapToString = (value: unknown, preferred?: string | null): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  const map = value as Record<string, string>;
  if (preferred) {
    const exact = map[preferred];
    if (exact) return exact;
    const primary = preferred.split('-')[0];
    if (primary) {
      const match = map[primary];
      if (match) return match;
    }
  }
  const firstKey = Object.keys(map)[0];
  return firstKey ? (map[firstKey] ?? '') : '';
};

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

const contributorNames = (value: unknown, preferred?: string | null): string[] => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const named = languageMapToString((item as { name?: unknown }).name, preferred);
      return named || languageMapToString(item, preferred);
    })
    .filter((name) => name.length > 0);
};

const seriesName = (value: unknown, preferred?: string | null): string | null => {
  if (!value || typeof value !== 'object') return null;
  const series = (value as { series?: unknown }).series;
  const first = Array.isArray(series) ? series[0] : series;
  if (typeof first === 'string') return first || null;
  if (!first || typeof first !== 'object') return null;
  const named = languageMapToString((first as { name?: unknown }).name, preferred);
  const fallback = languageMapToString(first, preferred);
  return named || fallback || null;
};

export const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ImportError(
      'CRYPTO_UNAVAILABLE',
      'Web Crypto is unavailable; use HTTPS or localhost.',
    );
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Read an EPUB's identity and metadata without keeping the parsed book. The
 * hash is of the file bytes, so re-importing the same file is a no-op later.
 */
export const importEpub = async (file: File): Promise<ImportedBook> => {
  if (file.size === 0) {
    throw new ImportError('INVALID_FILE', 'The selected file is empty.');
  }

  const bytes = Uint8Array.from(new Uint8Array(await file.arrayBuffer()));
  const hash = await sha256Hex(bytes);

  let book: Awaited<ReturnType<typeof makeBook>>;
  try {
    book = await makeBook(file);
  } catch (cause) {
    throw new ImportError('PARSE_FAILED', 'Could not parse the EPUB file.', { cause });
  }

  try {
    const metadata = book.metadata ?? {};
    const languages = asArray(metadata.language).filter(
      (item): item is string => typeof item === 'string',
    );
    const language = languages[0]?.trim() || null;
    const pageProgression = book.dir === 'rtl' || book.dir === 'ltr' ? book.dir : undefined;
    const direction = resolveBookDirection({ pageProgression, language });
    const cover = await book.getCover().catch(() => null);

    return {
      metadata: {
        hash,
        format: 'epub',
        title: languageMapToString(metadata.title, language) || file.name.replace(/\.epub$/i, ''),
        authors: contributorNames(metadata.author, language),
        language,
        publisher: contributorNames(metadata.publisher, language)[0] ?? null,
        series: seriesName(metadata.belongsTo, language),
        identifiers: metadata.identifier ? { primary: metadata.identifier } : {},
        direction,
      },
      cover,
    };
  } finally {
    book.destroy();
  }
};
