import type { BookRecord } from '@hamesh/storage';

export type BookSort = 'recent' | 'title' | 'author';
export type BookView = 'grid' | 'list';

export interface BookFilters {
  /** A book must carry every selected tag. */
  tags?: string[];
}

export interface BookGroup {
  /** Stable key for persisted collapse state. */
  key: string;
  /** null is the uncategorized bucket, always rendered last. */
  category: string | null;
  books: BookRecord[];
}

const UNCATEGORIZED_KEY = '::none';
const CATEGORY_PREFIX = '::cat:';
const categoryKey = (category: string | null): string =>
  category === null ? UNCATEGORIZED_KEY : `${CATEGORY_PREFIX}${category}`;
const categoryFromKey = (key: string): string | null =>
  key === UNCATEGORIZED_KEY ? null : key.slice(CATEGORY_PREFIX.length);

/**
 * Group filtered books by category. Named categories sort with the active
 * collator; books without a category always come last. `extraCategories`
 * renders toolbar-created sections that no book carries yet; duplicates of
 * categories that do have books are ignored.
 */
export const groupBooksByCategory = (
  books: BookRecord[],
  collator: Intl.Collator = new Intl.Collator(),
  extraCategories: string[] = [],
): BookGroup[] => {
  const buckets = new Map<string, BookRecord[]>();
  for (const book of books) {
    const key = categoryKey(book.category);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(book);
    else buckets.set(key, [book]);
  }
  for (const name of extraCategories) {
    const key = categoryKey(name);
    if (name !== '' && !buckets.has(key)) buckets.set(key, []);
  }
  const groups: BookGroup[] = [...buckets.entries()].map(([key, grouped]) => ({
    key,
    category: categoryFromKey(key),
    books: grouped,
  }));
  groups.sort((a, b) => {
    if (a.category === null) return 1;
    if (b.category === null) return -1;
    return collator.compare(a.category, b.category);
  });
  return groups;
};

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
  const byTags =
    selectedTags.length === 0
      ? books
      : books.filter((book) => selectedTags.every((tag) => book.tags.includes(tag)));
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
