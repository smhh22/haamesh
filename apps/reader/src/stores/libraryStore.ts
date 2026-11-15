import type { BookGroupRecord, BookRecord } from '@hamesh/storage';
import { create } from 'zustand';

interface LibraryState {
  books: BookRecord[];
  /** Category shelves (ADR-0025); membership lives on the books. */
  groups: BookGroupRecord[];
  addBook: (book: BookRecord) => void;
  updateBook: (id: string, patch: Partial<BookRecord>) => void;
  removeBook: (id: string) => void;
  setGroups: (groups: BookGroupRecord[]) => void;
  upsertGroup: (group: BookGroupRecord) => void;
  removeGroup: (id: string) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  books: [],
  groups: [],
  addBook: (book) =>
    set((state) =>
      state.books.some((existing) => existing.hash === book.hash)
        ? state
        : { books: [book, ...state.books] },
    ),
  updateBook: (id, patch) =>
    set((state) => ({
      books: state.books.map((book) => (book.id === id ? { ...book, ...patch } : book)),
    })),
  removeBook: (id) => set((state) => ({ books: state.books.filter((book) => book.id !== id) })),
  setGroups: (groups) => set({ groups }),
  upsertGroup: (group) =>
    set((state) => ({
      groups: state.groups.some((existing) => existing.id === group.id)
        ? state.groups.map((existing) => (existing.id === group.id ? group : existing))
        : [...state.groups, group],
    })),
  removeGroup: (id) =>
    set((state) => ({
      groups: state.groups.filter((group) => group.id !== id),
      // Membership dies with the group (ADR-0025); the books stay in place.
      books: state.books.map((book) => (book.groupId === id ? { ...book, groupId: null } : book)),
    })),
}));
