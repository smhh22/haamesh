import type { BookGroupRecord, BookRecord } from '@hamesh/storage';
import { describe, expect, it } from 'vitest';
import {
  canNestUnder,
  childrenOf,
  displayParentId,
  flattenGroups,
  groupAncestors,
  groupDepth,
  groupPathLabel,
  matchGroupsByName,
  orderMembers,
  orderSubgroups,
  planGroupDeletion,
  reorderBefore,
  subtreeBooks,
  subtreeGroupIds,
  topLevelGroups,
  withOrderId,
} from './groups';

const group = (
  id: string,
  parentId: string | null = null,
  createdAt = 1,
  name = id,
): BookGroupRecord => ({
  id,
  name,
  category: 'Calculus II',
  parentId,
  order: [],
  createdAt,
  updatedAt: createdAt,
});

const book = (id: string, addedAt: number, groupId: string | null = 'g1'): BookRecord =>
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
    groupId,
    filePath: `${id}.pdf`,
    coverPath: null,
    coverMime: null,
    addedAt,
    updatedAt: addedAt,
  }) as BookRecord;

describe('orderMembers', () => {
  it('follows the group order and appends unlisted members by added date', () => {
    const members = [book('c', 3), book('a', 1), book('b', 2), book('d', 0)];
    expect(
      orderMembers({ ...group('g1'), order: ['b', 'a'] }, members).map((member) => member.id),
    ).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('matchGroupsByName', () => {
  const groups = [group('g1'), { ...group('g2'), name: 'دیدگاه‌ها' }];

  it('matches with Persian folding (ZWNJ, diacritics, Arabic variants)', () => {
    expect(matchGroupsByName(groups, 'دیدگاهها').map((item) => item.id)).toEqual(['g2']);
    expect(matchGroupsByName(groups, 'Lecture').map((item) => item.id)).toEqual([]);
    expect(
      matchGroupsByName([group('g1', null, 1, 'Lecture Notes')], 'Lecture').map((item) => item.id),
    ).toEqual(['g1']);
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

describe('nested groups (ADR-0027)', () => {
  // root ─ a ─ deep
  //      └ b
  const tree = [
    group('root', null, 1),
    group('a', 'root', 2),
    group('b', 'root', 3),
    group('deep', 'a', 4),
  ];
  const books = [
    book('in-root', 1, 'root'),
    book('in-a', 2, 'a'),
    book('in-deep', 3, 'deep'),
    book('loose', 4, null),
  ];

  it('resolves dangling and cyclic parents as roots', () => {
    const dangling = group('orphan', 'missing');
    expect(displayParentId([dangling], dangling)).toBeNull();

    const a = group('a', 'b');
    const b = group('b', 'a');
    expect(displayParentId([a, b], a)).toBeNull();
    expect(displayParentId([a, b], b)).toBeNull();
    expect(childrenOf([a, b], null).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('orders children by the parent order, then creation date', () => {
    const parent = { ...group('root'), order: ['b', 'a'] };
    expect(orderSubgroups(parent, [group('a', 'root', 2), group('b', 'root', 3)])).toMatchObject([
      { id: 'b' },
      { id: 'a' },
    ]);
    expect(withOrderId(['x'], 'y')).toEqual(['x', 'y']);
    expect(withOrderId(['x', 'y'], 'y')).toEqual(['x', 'y']);
  });

  it('walks ancestors and depth from the root down', () => {
    expect(groupAncestors(tree, 'deep').map((item) => item.id)).toEqual(['root', 'a']);
    expect(groupDepth(tree, 'deep')).toBe(2);
    expect(groupDepth(tree, 'root')).toBe(0);
    expect(groupPathLabel(tree, 'deep')).toBe('root / a');
    expect(topLevelGroups(tree).map((item) => item.id)).toEqual(['root']);
  });

  it('collects the subtree and its books without looping', () => {
    expect(subtreeGroupIds(tree, 'root')).toEqual(['root', 'a', 'b', 'deep']);
    expect(subtreeGroupIds(tree, 'deep')).toEqual(['deep']);
    expect(subtreeBooks(tree, books, 'root').map((item) => item.id)).toEqual([
      'in-root',
      'in-a',
      'in-deep',
    ]);
  });

  it('rejects nesting a group under itself or a descendant', () => {
    expect(canNestUnder(tree, 'root', 'deep')).toBe(false);
    expect(canNestUnder(tree, 'deep', 'root')).toBe(true);
    expect(canNestUnder(tree, 'a', 'a')).toBe(false);
    expect(canNestUnder(tree, 'a', 'missing')).toBe(false);
  });

  it('flattens the tree depth-first for pickers', () => {
    expect(flattenGroups(tree).map(({ group: item, depth }) => [item.id, depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['deep', 2],
      ['b', 1],
    ]);
  });

  it('plans deleting the group and everything in it', () => {
    expect(planGroupDeletion(tree, books, 'root', 'with-contents')).toEqual({
      groupIds: ['root', 'a', 'b', 'deep'],
      deletedBookIds: ['in-root', 'in-a', 'in-deep'],
      promoteGroups: [],
      moveBooks: [],
    });
  });

  it('plans deleting groups while keeping their books', () => {
    expect(planGroupDeletion(tree, books, 'a', 'keep-books')).toEqual({
      groupIds: ['a', 'deep'],
      deletedBookIds: [],
      promoteGroups: [],
      moveBooks: [
        { id: 'in-a', groupId: 'root' },
        { id: 'in-deep', groupId: 'root' },
      ],
    });
  });

  it('plans deleting only the group, promoting children and books', () => {
    expect(planGroupDeletion(tree, books, 'a', 'only-group')).toEqual({
      groupIds: ['a'],
      deletedBookIds: [],
      promoteGroups: [{ id: 'deep', parentId: 'root' }],
      moveBooks: [{ id: 'in-a', groupId: 'root' }],
    });
    expect(planGroupDeletion(tree, books, 'root', 'only-group').moveBooks).toEqual([
      { id: 'in-root', groupId: null },
    ]);
  });
});
