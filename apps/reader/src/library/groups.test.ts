import type { BookGroupRecord, BookRecord } from '@hamesh/storage';
import { describe, expect, it } from 'vitest';
import { matchGroupsByName, orderMembers, reorderBefore } from './groups';

const group = (order: string[]): BookGroupRecord => ({
  id: 'g1',
  name: 'Lecture Notes',
  category: 'Calculus II',
  order,
  createdAt: 1,
  updatedAt: 2,
});

const book = (id: string, addedAt: number): BookRecord =>
  ({
    id,
    hash: `${id}-hash`,
    format: 'pdf',
    title: id,
    authors: [],
    language: null,
    publisher: null,
    series: null,
    identifiers: {},
    direction: 'ltr',
    category: null,
    tags: [],
    groupId: 'g1',
    filePath: `${id}.pdf`,
    coverPath: null,
    coverMime: null,
    addedAt,
    updatedAt: addedAt,
  }) as BookRecord;

describe('orderMembers', () => {
  it('follows the group order and appends unlisted members by added date', () => {
    const members = [book('c', 3), book('a', 1), book('b', 2), book('d', 0)];
    expect(orderMembers(group(['b', 'a']), members).map((member) => member.id)).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
  });
});

describe('matchGroupsByName', () => {
  const groups = [group([]), { ...group([]), id: 'g2', name: 'دیدگاه‌ها' }];

  it('matches with Persian folding (ZWNJ, diacritics, Arabic variants)', () => {
    expect(matchGroupsByName(groups, 'دیدگاهها').map((item) => item.id)).toEqual(['g2']);
    expect(matchGroupsByName(groups, 'Lecture').map((item) => item.id)).toEqual(['g1']);
  });

  it('matches nothing on an empty query', () => {
    expect(matchGroupsByName(groups, '   ')).toEqual([]);
  });
});

describe('reorderBefore', () => {
  it('moves the dragged id before the target', () => {
    expect(reorderBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for identical or unknown ids', () => {
    expect(reorderBefore(['a', 'b'], 'a', 'a')).toBeNull();
    expect(reorderBefore(['a', 'b'], 'x', 'a')).toBeNull();
    expect(reorderBefore(['a', 'b'], 'a', 'x')).toBeNull();
  });
});
