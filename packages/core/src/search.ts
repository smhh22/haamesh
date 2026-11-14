/**
 * Persian-aware search normalization shared by the library filter and
 * content full-text search. NFKC folds presentation forms, Arabic yeh/kaf
 * variants fold to their Persian shapes, and case folds for Latin text.
 *
 * Invisible and phonetic-only marks are dropped so a reader can type what
 * they remember: ZWNJ/ZWJ (`می‌رود` = `میرود`), Arabic diacritics
 * (`کِتاب` = `کتاب`), tatweel (`کتـاب`) and Quranic annotation marks. The
 * normalized text is deliberately shorter than the input, so callers that
 * need to point back into the original string use
 * {@link normalizeForSearchWithOffsets}.
 */
const DROPPED_MARK = /[\u0640\u064B-\u065F\u0670\u06D6-\u06ED\u200C\u200D]/;

const FOLDED_LETTERS: Readonly<Record<string, string>> = {
  '\u064A': 'ی', // ي Arabic yeh
  '\u0649': 'ی', // ى alef maksura
  '\u0643': 'ک', // ك Arabic kaf
};

export interface SearchNormalization {
  /** Folded text used for matching. */
  text: string;
  /**
   * For every code unit of `text`, its index in the NFKC-normalized input.
   * Dropped marks contribute no entry; a character that NFKC or lowercasing
   * expands points all of its output units at the same input index.
   */
  offsets: number[];
}

export const normalizeForSearchWithOffsets = (value: string): SearchNormalization => {
  const prepared = value.normalize('NFKC');
  let text = '';
  const offsets: number[] = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const char = prepared[index] as string;
    if (DROPPED_MARK.test(char)) continue;
    const folded = (FOLDED_LETTERS[char] ?? char).toLocaleLowerCase();
    for (let unit = 0; unit < folded.length; unit += 1) {
      text += folded[unit];
      offsets.push(index);
    }
  }
  return { text, offsets };
};

export const normalizeForSearch = (value: string): string =>
  normalizeForSearchWithOffsets(value).text;
