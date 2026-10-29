import type { BookNoteRecord } from '@hamesh/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { notesForBook, useNotesStore } from './notesStore';

const note = (id: string, bookId = 'book'): BookNoteRecord => ({
  id,
  bookId,
  type: 'highlight',
  locator: { kind: 'cfi', cfi: `/6/${id}`, fraction: 0.1 },
  color: '#f2c94c',
  text: 'text',
  note: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

beforeEach(() => {
  useNotesStore.setState({ notes: [] });
});

describe('notesStore', () => {
  it('adds and updates a note', () => {
    const { add, update } = useNotesStore.getState();
    add(note('a'));
    update('a', { note: 'edited', color: '#3b82f6' });
    const stored = useNotesStore.getState().notes[0];
    expect(stored?.note).toBe('edited');
    expect(stored?.color).toBe('#3b82f6');
  });

  it('tombstones instead of deleting', () => {
    const { add, remove } = useNotesStore.getState();
    add(note('a'));
    remove('a');
    expect(useNotesStore.getState().notes[0]?.deletedAt).not.toBeNull();
    expect(notesForBook(useNotesStore.getState().notes, 'book')).toHaveLength(0);
  });

  it('filters by book and sorts by creation time', () => {
    useNotesStore.setState({
      notes: [
        { ...note('b'), createdAt: 2 },
        { ...note('a'), createdAt: 1 },
        note('other', 'other-book'),
      ],
    });
    expect(notesForBook(useNotesStore.getState().notes, 'book').map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
