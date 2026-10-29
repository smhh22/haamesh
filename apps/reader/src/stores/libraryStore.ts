import type { BookRecord } from '@hamesh/storage';
import { create } from 'zustand';

interface LibraryState {
  books: BookRecord[];
  addBook: (book: BookRecord) => void;
  removeBook: (id: string) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  books: [],
  addBook: (book) =>
    set((state) =>
      state.books.some((existing) => existing.hash === book.hash)
        ? state
        : { books: [book, ...state.books] },
    ),
  removeBook: (id) => set((state) => ({ books: state.books.filter((book) => book.id !== id) })),
}));
