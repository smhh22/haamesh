import type { ReadingState } from '@hamesh/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { useReadingStore } from './readingStore';

const state = (bookId: string, fraction: number): ReadingState => ({
  bookId,
  locator: { kind: 'cfi', cfi: `/6/${fraction}`, fraction },
  fraction,
  status: 'reading',
  updatedAt: 0,
});

beforeEach(() => {
  useReadingStore.setState({ states: {} });
});

describe('readingStore', () => {
  it('stores state per book', () => {
    const { save } = useReadingStore.getState();
    save(state('a', 0.2));
    save(state('b', 0.7));
    expect(useReadingStore.getState().states.a?.fraction).toBe(0.2);
    expect(useReadingStore.getState().states.b?.fraction).toBe(0.7);
  });

  it('replaces the previous state for the same book', () => {
    const { save } = useReadingStore.getState();
    save(state('a', 0.2));
    save(state('a', 0.9));
    expect(useReadingStore.getState().states.a?.fraction).toBe(0.9);
  });

  it('removes state with the book', () => {
    const { save, remove } = useReadingStore.getState();
    save(state('a', 0.2));
    remove('a');
    expect(useReadingStore.getState().states.a).toBeUndefined();
  });
});
