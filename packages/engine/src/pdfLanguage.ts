import type { Direction } from '@hamesh/core';

export interface TextProfile {
  /** BCP 47 primary tag, or null when no script gives a confident answer. */
  language: string | null;
  direction: Direction;
}

/**
 * Letter counts per Unicode script. Only scripts that map closely to a
 * language produce a code; Latin and Cyrillic span many languages, so they
 * stay unknown rather than guessing (and a wrong guess would stick in the
 * record).
 */
interface ScriptCounts {
  arabic: number;
  hebrew: number;
  cyrillic: number;
  greek: number;
  han: number;
  kana: number;
  hangul: number;
  latin: number;
  /** Persian/Urdu letters seen inside the Arabic run (0 otherwise). */
  persian: number;
  urdu: number;
}

const inRange = (code: number, ranges: ReadonlyArray<readonly [number, number]>): boolean =>
  ranges.some(([lo, hi]) => code >= lo && code <= hi);

const ARABIC: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];
const HEBREW: ReadonlyArray<readonly [number, number]> = [[0x0590, 0x05ff]];
const CYRILLIC: ReadonlyArray<readonly [number, number]> = [[0x0400, 0x04ff]];
const GREEK: ReadonlyArray<readonly [number, number]> = [
  [0x0370, 0x03ff],
  [0x1f00, 0x1fff],
];
const HAN: ReadonlyArray<readonly [number, number]> = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
];
const KANA: ReadonlyArray<readonly [number, number]> = [
  [0x3040, 0x309f],
  [0x30a0, 0x30ff],
];
const HANGUL: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff],
  [0x3130, 0x318f],
  [0xac00, 0xd7af],
];
const LATIN: ReadonlyArray<readonly [number, number]> = [
  [0x0041, 0x005a],
  [0x0061, 0x007a],
  [0x00c0, 0x024f],
  [0x1e00, 0x1eff],
];

/** Persian-only letters (پ چ ژ گ) and the Farsi yeh / keheh forms. */
const PERSIAN_MARKERS: readonly number[] = [0x067e, 0x0686, 0x0698, 0x06af, 0x06cc, 0x06a9];
/** Urdu-only letters (ٹ ڈ ڑ ں ھ ہ ے). */
const URDU_MARKERS: readonly number[] = [0x0679, 0x0688, 0x0691, 0x06ba, 0x06be, 0x06c1, 0x06d2];

const countScripts = (sample: string): ScriptCounts => {
  const counts: ScriptCounts = {
    arabic: 0,
    hebrew: 0,
    cyrillic: 0,
    greek: 0,
    han: 0,
    kana: 0,
    hangul: 0,
    latin: 0,
    persian: 0,
    urdu: 0,
  };
  for (const char of sample) {
    const code = char.codePointAt(0) ?? 0;
    if (inRange(code, ARABIC)) {
      counts.arabic += 1;
      if (PERSIAN_MARKERS.includes(code)) counts.persian += 1;
      if (URDU_MARKERS.includes(code)) counts.urdu += 1;
    } else if (inRange(code, HEBREW)) counts.hebrew += 1;
    else if (inRange(code, CYRILLIC)) counts.cyrillic += 1;
    else if (inRange(code, GREEK)) counts.greek += 1;
    else if (inRange(code, HAN)) counts.han += 1;
    else if (inRange(code, KANA)) counts.kana += 1;
    else if (inRange(code, HANGUL)) counts.hangul += 1;
    else if (inRange(code, LATIN)) counts.latin += 1;
  }
  return counts;
};

/**
 * Guess a book's language and reading direction from a text sample. PDFs
 * rarely carry usable language metadata, so the first rendered pages are
 * sampled instead: the dominant Unicode script decides the direction, and
 * script-internal markers (Persian/Urdu letters inside Arabic text) narrow
 * the language. Latin and Cyrillic stay unknown on purpose.
 */
export const profilePdfText = (sample: string): TextProfile => {
  const counts = countScripts(sample);
  const scripts: ReadonlyArray<keyof ScriptCounts> = [
    'arabic',
    'hebrew',
    'cyrillic',
    'greek',
    'han',
    'kana',
    'hangul',
    'latin',
  ];
  const dominant = scripts.reduce(
    (best, key) => (counts[key] > counts[best] ? key : best),
    'latin' as keyof ScriptCounts,
  );
  if (counts[dominant] === 0) return { language: null, direction: 'ltr' };

  if (dominant === 'arabic') {
    const language =
      counts.urdu > 0 && counts.urdu >= counts.persian ? 'ur' : counts.persian > 0 ? 'fa' : 'ar';
    return { language, direction: 'rtl' };
  }
  if (dominant === 'hebrew') return { language: 'he', direction: 'rtl' };
  if (dominant === 'kana' || (dominant === 'han' && counts.kana > 0)) {
    return { language: 'ja', direction: 'ltr' };
  }
  if (dominant === 'han') return { language: 'zh', direction: 'ltr' };
  if (dominant === 'hangul') return { language: 'ko', direction: 'ltr' };
  if (dominant === 'greek') return { language: 'el', direction: 'ltr' };
  return { language: null, direction: 'ltr' };
};
