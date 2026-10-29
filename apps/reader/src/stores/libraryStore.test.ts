import type { BookRecord } from '@hamesh/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLibraryStore } from './libraryStore';

const book = (hash: string): BookRecord => ({
  id: hash,
  hash,
  format: 'epub',
  title: 'Book',
  authors: [],
  language: null,
  publisher: null,
  series: null,
  identifiers: {},
  direction: 'ltr',
  filePath: `${hash}.epub`,
  coverPath: null,
  addedAt: 0,
  updatedAt: 0,
});

beforeEach(() => {
  useLibraryStore.setState({ books: [] });
});

describe('libraryStore', () => {
  it('adds the newest book first', () => {
    const { addBook } = useLibraryStore.getState();
    addBook(book('a'));
    addBook(book('b'));
    expect(useLibraryStore.getState().books.map((item) => item.hash)).toEqual(['b', 'a']);
  });

  it('dedupes by content hash', () => {
    const { addBook } = useLibraryStore.getState();
    addBook(book('a'));
    addBook(book('a'));
    expect(useLibraryStore.getState().books).toHaveLength(1);
  });

  it('removes by id', () => {
    const { addBook, removeBook } = useLibraryStore.getState();
    addBook(book('a'));
    removeBook('a');
    expect(useLibraryStore.getState().books).toHaveLength(0);
  });
});
