import { describe, expect, it } from 'vitest';
import {
  categoryAncestors,
  categoryDepth,
  categoryName,
  categoryParent,
  categoryPathOf,
  categorySegments,
  isCategoryInSubtree,
  isValidCategoryName,
  sanitizeCategoryName,
} from './category';

describe('category paths', () => {
  it('splits, trims, and drops empty segments', () => {
    expect(categorySegments(' Fiction / Sci-Fi ')).toEqual(['Fiction', 'Sci-Fi']);
    expect(categorySegments('')).toEqual([]);
  });

  it('reports parent, name, and depth at any level', () => {
    expect(categoryParent('Fiction/Sci-Fi/Space')).toBe('Fiction/Sci-Fi');
    expect(categoryParent('Fiction/Sci-Fi')).toBe('Fiction');
    expect(categoryParent('Fiction')).toBeNull();
    expect(categoryName('Fiction/Sci-Fi/Space')).toBe('Space');
    expect(categoryDepth('Fiction')).toBe(0);
    expect(categoryDepth('Fiction/Sci-Fi/Space')).toBe(2);
  });

  it('lists ancestors outermost first', () => {
    expect(categoryAncestors('A/B/C')).toEqual(['A', 'A/B']);
    expect(categoryAncestors('A')).toEqual([]);
  });

  it('rejects separators inside names and strips them for input', () => {
    expect(isValidCategoryName('Sci-Fi')).toBe(true);
    expect(isValidCategoryName('Sci/Fi')).toBe(false);
    expect(isValidCategoryName('  ')).toBe(false);
    expect(sanitizeCategoryName('Sci/Fi/ ')).toBe('SciFi');
  });

  it('joins parents and names', () => {
    expect(categoryPathOf('Fiction', 'Sci-Fi')).toBe('Fiction/Sci-Fi');
    expect(categoryPathOf(null, 'Fiction')).toBe('Fiction');
    expect(categoryPathOf('A', 'B/C')).toBe('A/BC');
  });

  it('matches whole subtrees without prefix collisions', () => {
    expect(isCategoryInSubtree('Fiction/Sci-Fi', 'Fiction')).toBe(true);
    expect(isCategoryInSubtree('Fiction', 'Fiction')).toBe(true);
    expect(isCategoryInSubtree('Fictions/A', 'Fiction')).toBe(false);
  });
});
