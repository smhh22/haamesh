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
  category: null,
  tags: [],
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

describe('filterAndSortBooks organization filters', () => {
  const organized = [
    { ...book('a', ['A'], 3), category: 'Studies', tags: ['persian', 'history'] },
    { ...book('b', ['B'], 2), category: 'Fiction', tags: ['history'] },
    { ...book('c', ['C'], 1), category: null, tags: [] },
  ];

  it('filters by category, null meaning uncategorized, and undefined meaning all', () => {
    expect(
      filterAndSortBooks(organized, '', 'recent', undefined, { category: 'Studies' }),
    ).toHaveLength(1);
    expect(filterAndSortBooks(organized, '', 'recent', undefined, { category: null })).toHaveLength(
      1,
    );
    expect(filterAndSortBooks(organized, '', 'recent', undefined, {})).toHaveLength(3);
  });

  it('requires every selected tag and matches labels in the text query', () => {
    expect(
      filterAndSortBooks(organized, '', 'recent', undefined, { tags: ['history'] }),
    ).toHaveLength(2);
    expect(
      filterAndSortBooks(organized, '', 'recent', undefined, { tags: ['history', 'persian'] }),
    ).toHaveLength(1);
    expect(filterAndSortBooks(organized, 'fiction', 'recent')).toHaveLength(1);
    expect(filterAndSortBooks(organized, 'persian', 'recent')).toHaveLength(1);
  });
});
