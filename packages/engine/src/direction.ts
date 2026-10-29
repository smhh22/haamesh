import type { Direction } from '@hamesh/core';

export type PageProgression = 'ltr' | 'rtl' | 'default';

export interface DirectionInput {
  /** OPF `page-progression-direction`. */
  pageProgression?: PageProgression | null;
  /** Book language (BCP 47), e.g. `fa`, `fa-IR`, `en`. */
  language?: string | null;
  /** Per-document `dir` attribute, if the publisher provided one. */
  documentDir?: string | null;
}

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'dv', 'ps', 'sd', 'yi']);

export const isRtlLanguage = (language?: string | null): boolean => {
  if (!language) return false;
  const primary = language.split('-')[0]?.toLowerCase() ?? '';
  return RTL_LANGUAGES.has(primary);
};

/**
 * Book-level direction. Used for pagination and alignment, never for
 * per-paragraph rendering: the Unicode bidi algorithm handles mixed runs, and
 * publisher-marked paragraph direction is preserved elsewhere.
 */
export const resolveBookDirection = (input: DirectionInput): Direction => {
  if (input.pageProgression === 'rtl') return 'rtl';
  if (input.pageProgression === 'ltr') return 'ltr';
  if (isRtlLanguage(input.language)) return 'rtl';
  if (input.documentDir === 'rtl') return 'rtl';
  if (input.documentDir === 'ltr') return 'ltr';
  return 'ltr';
};
