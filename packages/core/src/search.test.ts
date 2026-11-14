import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeForSearch, normalizeForSearchWithOffsets } from './search';

describe('normalizeForSearch', () => {
  it('folds Arabic yeh, alef maksura and kaf to Persian shapes', () => {
    expect(normalizeForSearch('كتاب')).toBe('کتاب');
    expect(normalizeForSearch('مفيد')).toBe('مفید');
    expect(normalizeForSearch('على')).toBe('علی');
    expect(normalizeForSearch('ABC')).toBe('abc');
  });

  it('drops zero-width joiners so spaced and joined spellings match', () => {
    expect(normalizeForSearch('می‌رود')).toBe('میرود');
    expect(normalizeForSearch('می\u200Dرود')).toBe('میرود');
    expect(normalizeForSearch('کتاب‌ها')).toBe('کتابها');
  });

  it('drops diacritics, tatweel and Quranic marks', () => {
    expect(normalizeForSearch('کِتَاب')).toBe('کتاب');
    expect(normalizeForSearch('کِتاب')).toBe('کتاب');
    expect(normalizeForSearch('کتـاب')).toBe('کتاب');
    expect(normalizeForSearch('بِسْمِ اللَّهِ')).toBe('بسم الله');
    expect(normalizeForSearch('مُحَمَّد')).toBe('محمد');
  });

  it('is idempotent for every input', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const once = normalizeForSearch(value);
        expect(normalizeForSearch(once)).toBe(once);
      }),
    );
  });

  it('never leaves a dropped mark behind', () => {
    const marks = ['\u200C', '\u200D', '\u0640', '\u064B', '\u0651', '\u0670', '\u06DD'];
    fc.assert(
      fc.property(fc.string(), (value) => {
        const normalized = normalizeForSearch(value + marks.join(''));
        for (const mark of marks) expect(normalized).not.toContain(mark);
      }),
    );
  });

  it('matches text with marks inserted at any position', () => {
    const marks = ['\u200C', '\u064B', '\u0652', '\u0640'];
    // Binary base characters keep inserted marks between code points, never
    // inside a surrogate pair or a combining sequence.
    const alphabet = ['ا', 'ب', 'ک', 'ت', 'ی', 'a', 'B', '7', ' '];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...alphabet), { maxLength: 20 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        (base, positions) => {
          const chars = [...base];
          for (const position of positions) {
            const index = position % (chars.length + 1);
            chars.splice(index, 0, marks[position % marks.length] as string);
          }
          const marked = chars.join('');
          expect(normalizeForSearch(marked)).toBe(normalizeForSearch(base.join('')));
        },
      ),
    );
  });
});

describe('normalizeForSearchWithOffsets', () => {
  it('points each normalized unit back at its source character', () => {
    const { text, offsets } = normalizeForSearchWithOffsets('کِتاب');
    expect(text).toBe('کتاب');
    // ک is kept, the kasra at index 1 is dropped, the rest keep their indices.
    expect(offsets).toEqual([0, 2, 3, 4]);
  });

  it('maps offsets into the NFKC-normalized input', () => {
    const { text, offsets } = normalizeForSearchWithOffsets('ﻛﺘﺎﺏ');
    expect(text).toBe('کتاب');
    expect(offsets).toHaveLength(text.length);
    for (const offset of offsets) expect(offset).toBeLessThan('ﻛﺘﺎﺏ'.length);
  });

  it('keeps offsets monotonic and in range for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const { text, offsets } = normalizeForSearchWithOffsets(value);
        expect(offsets).toHaveLength(text.length);
        for (let index = 0; index < offsets.length; index += 1) {
          const offset = offsets[index] as number;
          expect(offset).toBeLessThanOrEqual(value.normalize('NFKC').length);
          if (index > 0) expect(offset).toBeGreaterThanOrEqual(offsets[index - 1] as number);
        }
      }),
    );
  });
});
