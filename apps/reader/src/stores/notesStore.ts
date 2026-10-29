import type { BookNoteRecord } from '@hamesh/storage';
import { create } from 'zustand';

interface NotesStore {
  notes: BookNoteRecord[];
  add: (note: BookNoteRecord) => void;
  update: (id: string, changes: Pick<BookNoteRecord, 'color' | 'note'>) => void;
  remove: (id: string) => void;
}

/** Notes are tombstones: removing sets deletedAt instead of dropping the row. */
export const useNotesStore = create<NotesStore>((set) => ({
  notes: [],
  add: (note) => set((state) => ({ notes: [...state.notes, note] })),
  update: (id, changes) =>
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, ...changes, updatedAt: Date.now() } : note,
      ),
    })),
  remove: (id) =>
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, deletedAt: Date.now(), updatedAt: Date.now() } : note,
      ),
    })),
}));

export const notesForBook = (notes: BookNoteRecord[], bookId: string): BookNoteRecord[] =>
  notes
    .filter((note) => note.bookId === bookId && note.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt);
