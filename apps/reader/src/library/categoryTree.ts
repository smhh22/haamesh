/**
 * Category hierarchy for the library (ADR-0022). Categories are `/`-separated
 * paths; the tree is derived from books plus toolbar-created (empty) paths.
 * Missing ancestors are materialized so a book in `A/B/C` always shows the
 * `A` and `A/B` nodes.
 */
import { categoryAncestors, categoryDepth, categoryName, categoryParent } from '@hamesh/core';
import type { BookRecord } from '@hamesh/storage';

export interface CategoryNode {
  /** Stable key for persisted collapse state. */
  key: string;
  path: string;
  /** Display name (last segment). */
  name: string;
  depth: number;
  children: CategoryNode[];
  /** Books assigned to this exact path. */
  books: BookRecord[];
  /** Books in this node and all descendants. */
  total: number;
}

export const categoryKey = (path: string): string => `::cat:${path}`;

/** Every known path (books + created), ancestors included, deduplicated. */
export const collectCategoryPaths = (
  books: readonly BookRecord[],
  extraCategories: readonly string[] = [],
): Set<string> => {
  const paths = new Set<string>();
  const add = (path: string) => {
    if (!path.trim()) return;
    for (const ancestor of categoryAncestors(path)) paths.add(ancestor);
    paths.add(path);
  };
  for (const book of books) if (book.category) add(book.category);
  for (const extra of extraCategories) add(extra);
  return paths;
};

export const buildCategoryTree = (
  books: readonly BookRecord[],
  extraCategories: readonly string[],
  order: readonly string[],
  collator: Intl.Collator = new Intl.Collator(),
): CategoryNode[] => {
  const paths = collectCategoryPaths(books, extraCategories);
  const nodes = new Map<string, CategoryNode>();
  for (const path of paths) {
    nodes.set(path, {
      key: categoryKey(path),
      path,
      name: categoryName(path),
      depth: categoryDepth(path),
      children: [],
      books: [],
      total: 0,
    });
  }
  for (const book of books) {
    if (book.category) nodes.get(book.category)?.books.push(book);
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = categoryParent(node.path);
    const parentNode = parent ? nodes.get(parent) : undefined;
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }
  const rank = (path: string): number => {
    const index = order.indexOf(path);
    return index === -1 ? order.length : index;
  };
  const sortSiblings = (siblings: CategoryNode[]): CategoryNode[] =>
    siblings.sort((a, b) => {
      const byOrder = rank(a.path) - rank(b.path);
      return byOrder !== 0 ? byOrder : collator.compare(a.path, b.path);
    });
  const fill = (node: CategoryNode): number => {
    sortSiblings(node.children);
    node.total = node.books.length + node.children.reduce((sum, child) => sum + fill(child), 0);
    return node.total;
  };
  for (const root of sortSiblings(roots)) fill(root);
  return roots;
};

/** Find a node by path anywhere in the forest. */
export const findCategoryNode = (
  roots: readonly CategoryNode[],
  path: string,
): CategoryNode | null => {
  for (const node of roots) {
    if (node.path === path) return node;
    const found = findCategoryNode(node.children, path);
    if (found) return found;
  }
  return null;
};

/** Sibling paths of `path` (roots for a top-level node), in display order. */
export const siblingCategoryPaths = (roots: readonly CategoryNode[], path: string): string[] => {
  const parent = categoryParent(path);
  const siblings = parent ? (findCategoryNode(roots, parent)?.children ?? []) : roots;
  return siblings.map((node) => node.path);
};

/** Pre-order paths of the whole forest — the persisted manual order. */
export const flattenCategoryPaths = (roots: readonly CategoryNode[]): string[] =>
  roots.flatMap((node) => [node.path, ...flattenCategoryPaths(node.children)]);
