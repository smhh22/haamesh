import type { BookRecord } from '@hamesh/storage';
import { describe, expect, it } from 'vitest';
import {
  buildCategoryTree,
  collectCategoryPaths,
  findCategoryNode,
  flattenCategoryPaths,
  siblingCategoryPaths,
} from './categoryTree';

const book = (id: string, category: string | null): BookRecord =>
  ({
    id,
    hash: id.repeat(64).slice(0, 64),
    format: 'epub',
    title: id,
    authors: [],
    language: null,
    publisher: null,
    series: null,
    identifiers: {},
    direction: 'ltr',
    category,
    tags: [],
    filePath: `books/${id}.epub`,
    coverPath: null,
    coverMime: null,
    addedAt: 0,
    updatedAt: 0,
  }) as BookRecord;

const collator = new Intl.Collator('en');

describe('collectCategoryPaths', () => {
  it('adds ancestors and keeps created empty paths', () => {
    const paths = collectCategoryPaths(
      [book('a', 'Fiction/Sci-Fi/Space'), book('b', null)],
      ['History/Modern'],
    );
    expect([...paths].sort()).toEqual([
      'Fiction',
      'Fiction/Sci-Fi',
      'Fiction/Sci-Fi/Space',
      'History',
      'History/Modern',
    ]);
  });
});

describe('buildCategoryTree', () => {
  it('nests paths, materializes ancestors, and totals subtrees', () => {
    const roots = buildCategoryTree(
      [book('a', 'Fiction/Sci-Fi'), book('b', 'Fiction'), book('c', 'History')],
      [],
      [],
      collator,
    );
    expect(roots.map((node) => node.path)).toEqual(['Fiction', 'History']);
    const fiction = roots[0]!;
    expect(fiction.name).toBe('Fiction');
    expect(fiction.books.map((item) => item.id)).toEqual(['b']);
    expect(fiction.total).toBe(2);
    expect(fiction.children[0]?.path).toBe('Fiction/Sci-Fi');
    expect(fiction.children[0]?.total).toBe(1);
  });

  it('orders siblings by the manual order, then the collator', () => {
    const roots = buildCategoryTree(
      [book('a', 'Alpha'), book('b', 'Beta'), book('c', 'Gamma')],
      ['Gamma/Section'],
      ['Gamma'],
      collator,
    );
    expect(roots.map((node) => node.path)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(roots[0]?.children.map((node) => node.path)).toEqual(['Gamma/Section']);
  });

  it('includes created categories that have no books yet', () => {
    const roots = buildCategoryTree([], ['Fiction/Draft'], [], collator);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.total).toBe(0);
    expect(roots[0]?.children[0]?.path).toBe('Fiction/Draft');
  });
});

describe('category tree navigation', () => {
  const roots = buildCategoryTree(
    [book('a', 'Fiction/Sci-Fi/Space'), book('b', 'Fiction'), book('c', 'History')],
    [],
    [],
    collator,
  );

  it('finds nodes at any depth and lists their siblings', () => {
    expect(findCategoryNode(roots, 'Fiction/Sci-Fi/Space')?.name).toBe('Space');
    expect(siblingCategoryPaths(roots, 'Fiction/Sci-Fi')).toEqual(['Fiction/Sci-Fi']);
    expect(siblingCategoryPaths(roots, 'History')).toEqual(['Fiction', 'History']);
  });

  it('flattens the forest in display order', () => {
    expect(flattenCategoryPaths(roots)).toEqual([
      'Fiction',
      'Fiction/Sci-Fi',
      'Fiction/Sci-Fi/Space',
      'History',
    ]);
  });
});
