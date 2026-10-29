import type { ReadingState } from '@hamesh/storage';
import { create } from 'zustand';

interface ReadingStore {
  states: Record<string, ReadingState>;
  save: (state: ReadingState) => void;
  remove: (bookId: string) => void;
}

export const useReadingStore = create<ReadingStore>((set) => ({
  states: {},
  save: (state) => set((current) => ({ states: { ...current.states, [state.bookId]: state } })),
  remove: (bookId) =>
    set((current) => {
      const states = { ...current.states };
      delete states[bookId];
      return { states };
    }),
}));
