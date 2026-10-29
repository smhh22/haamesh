import type { BookRecord } from '@hamesh/storage';
import { describe, expect, it } from 'vitest';
import { filterAndSortBooks } from './bookList';

const book = (
  title: string,
  authors: string[],
  addedAt: number,
  series: string | null = null,
): BookRecord => ({
  id: title,
  hash: title,
  format: 'epub',
  title,
  authors,
  language: null,
  publisher: null,
  series,
  identifiers: {},
  direction: 'rtl',
  filePath: `${title}.epub`,
  coverPath: null,
  addedAt,
  updatedAt: addedAt,
});

const books = [
  book('کتاب دوم', ['نویسنده ب'], 2, 'مجموعه'),
  book('Sample Book', ['Alice'], 1),
  book('Another Book', ['Bob'], 3),
];

describe('filterAndSortBooks', () => {
  it('returns all books for an empty query', () => {
    expect(filterAndSortBooks(books, '', 'recent')).toHaveLength(3);
  });

  it('matches title, author, and series', () => {
    expect(filterAndSortBooks(books, 'sample', 'recent').map((b) => b.title)).toEqual([
      'Sample Book',
    ]);
    expect(filterAndSortBooks(books, 'alice', 'recent').map((b) => b.title)).toEqual([
      'Sample Book',
    ]);
    expect(filterAndSortBooks(books, 'مجموعه', 'recent').map((b) => b.title)).toEqual(['کتاب دوم']);
  });

  it('normalizes Arabic yeh and kaf for Persian search', () => {
    expect(filterAndSortBooks(books, 'كتاب', 'recent').map((b) => b.title)).toEqual(['کتاب دوم']);
  });

  it('sorts by recency, title, and author', () => {
    expect(filterAndSortBooks(books, '', 'recent').map((b) => b.addedAt)).toEqual([3, 2, 1]);
    expect(filterAndSortBooks(books, '', 'title', new Intl.Collator('en'))[0]?.title).toBe(
      'Another Book',
    );
    expect(filterAndSortBooks(books, '', 'author', new Intl.Collator('en'))[0]?.authors[0]).toBe(
      'Alice',
    );
  });
});
