import { describe, expect, it } from 'vitest';
import { searchBookTexts } from './sql';

const rows = [
  { bookId: 'b1', section: 0, content: 'متن نمونه برای خواندن. کلمه کتاب در اینجا آمده است.' },
  { bookId: 'b1', section: 1, content: 'A totally different English section about calculus.' },
  { bookId: 'b2', section: 0, content: 'اين متن با ي عربی نوشته شده است. کتاب‌خوانی مفيد است.' },
];

describe('searchBookTexts', () => {
  it('finds Persian text ignoring zero-width joins in the query', () => {
    const results = searchBookTexts(rows, 'کتاب', 10);
    expect(results.map((item) => item.bookId)).toContain('b1');
  });

  it('folds Arabic yeh/kaf into Persian shapes on either side', () => {
    // Query typed with Arabic kaf must match Persian kaf content.
    expect(searchBookTexts(rows, 'كتاب', 10).map((item) => item.bookId)).toContain('b1');
    // Content with Arabic yeh must match a query with Persian yeh.
    expect(searchBookTexts(rows, 'مفید', 10).map((item) => item.bookId)).toContain('b2');
  });

  it('returns snippets cut around the match from the original text', () => {
    const [hit] = searchBookTexts(rows, 'کلمه', 10);
    expect(hit?.snippet).toContain('کلمه');
    expect(hit?.snippet.length).toBeLessThanOrEqual(170);
  });

  it('does not cross-match unrelated sections', () => {
    expect(searchBookTexts(rows, 'calculus', 10).map((item) => item.bookId)).toEqual(['b1']);
    expect(searchBookTexts(rows, 'не-существует', 10)).toEqual([]);
  });

  it('ignores queries shorter than two characters', () => {
    expect(searchBookTexts(rows, 'ک', 10)).toEqual([]);
  });
});
