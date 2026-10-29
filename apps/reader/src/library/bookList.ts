import type { BookRecord } from '@hamesh/storage';

export type BookSort = 'recent' | 'title' | 'author';
export type BookView = 'grid' | 'list';

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
): BookRecord[] => {
  const needle = normalize(query.trim());
  const filtered = needle
    ? books.filter((book) =>
        [book.title, ...book.authors, book.series ?? ''].some((value) =>
          normalize(value).includes(needle),
        ),
      )
    : books;

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
