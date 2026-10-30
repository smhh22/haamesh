import type { BookRecord } from '@hamesh/storage';

export type BookSort = 'recent' | 'title' | 'author';
export type BookView = 'grid' | 'list';

export interface BookFilters {
  /** undefined = all books, null = uncategorized, string = that category. */
  category?: string | null;
  /** A book must carry every selected tag. */
  tags?: string[];
}

const normalize = (value: string): string =>
  value.normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').toLocaleLowerCase();

/**
 * Filter by title, author, or series and sort a copy. Persian search also
 * normalizes Arabic yeh/kaf variants so queries match regardless of keyboard.
 */
export const filterAndSortBooks = (
  books: BookRecord[],
  query: string,
  sort: BookSort,
  collator: Intl.Collator = new Intl.Collator(),
  filters: BookFilters = {},
): BookRecord[] => {
  const needle = normalize(query.trim());
  const selectedTags = filters.tags ?? [];
  const byCategory =
    filters.category === undefined
      ? books
      : books.filter((book) => (book.category ?? null) === filters.category);
  const byTags =
    selectedTags.length === 0
      ? byCategory
      : byCategory.filter((book) => selectedTags.every((tag) => book.tags.includes(tag)));
  const filtered = needle
    ? byTags.filter((book) =>
        [book.title, ...book.authors, book.series ?? '', book.category ?? '', ...book.tags].some(
          (value) => normalize(value).includes(needle),
        ),
      )
    : byTags;

  const sorted = [...filtered];
  if (sort === 'title') {
    sorted.sort((a, b) => collator.compare(a.title, b.title));
  } else if (sort === 'author') {
    sorted.sort(
      (a, b) =>
        collator.compare(a.authors[0] ?? '', b.authors[0] ?? '') ||
        collator.compare(a.title, b.title),
    );
  } else {
    sorted.sort((a, b) => b.addedAt - a.addedAt);
  }
  return sorted;
};
