import type { Direction } from './direction';

export type BookFormat = 'epub' | 'pdf';

/**
 * Format-tagged reading position. EPUB uses CFI, PDF uses pages, plain text
 * uses offsets. Every variant carries a fraction so a position can still be
 * approximated if the primary locator cannot be resolved.
 */
export type Locator =
  | { kind: 'cfi'; cfi: string; fraction: number }
  | { kind: 'page'; page: number; fraction: number }
  | {
      kind: 'pdf';
      page: number;
      /** Selected text as it appears in the page's text layer. */
      text: string;
      /** Which repeat of `text` on the page this is (0-based). */
      occurrence: number;
      fraction: number;
    }
  | { kind: 'offset'; offset: number; fraction: number };

export interface BookMetadata {
  /** SHA-256 of the book file bytes. */
  hash: string;
  format: BookFormat;
  title: string;
  authors: string[];
  language: string | null;
  publisher: string | null;
  series: string | null;
  identifiers: Record<string, string>;
  direction: Direction;
}

export type ReadingStatus = 'unread' | 'reading' | 'finished';

export interface BookConfig {
  locator: Locator | null;
  fraction: number;
  status: ReadingStatus;
}

/** One entry in a book's table of contents. */
export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[] | null;
}

export interface BookNote {
  id: string;
  type: 'highlight' | 'bookmark' | 'note';
  locator: Locator;
  color: string | null;
  text: string | null;
  note: string | null;
}

/** Clamp a reading fraction to 0..1; non-finite values become 0. */
export const clampFraction = (fraction: number): number => {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
};

/** Fraction for a locator, or 0 when there is no position yet. */
export const locatorFraction = (locator: Locator | null): number =>
  locator ? clampFraction(locator.fraction) : 0;
