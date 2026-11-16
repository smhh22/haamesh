/**
 * Pure helpers for category groups (ADR-0025) and nested groups (ADR-0027).
 * The App derives members, visibility and deletion plans around these;
 * keeping them here makes the merge/order/tree rules unit-testable without
 * React.
 */
import { normalizeForSearch } from '@hamesh/core';
import type { BookGroupRecord, BookRecord } from '@hamesh/storage';

/** Members in display order: `group.order` first, then by added date. */
export const orderMembers = (group: BookGroupRecord, members: BookRecord[]): BookRecord[] => {
  const rank = new Map(group.order.map((id, index) => [id, index]));
  return [...members].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.addedAt - b.addedAt,
  );
};

/** Child groups in display order: parent `order` first, then creation date. */
export const orderSubgroups = (
  group: BookGroupRecord,
  children: BookGroupRecord[],
): BookGroupRecord[] => {
  const rank = new Map(group.order.map((id, index) => [id, index]));
  return [...children].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt - b.createdAt,
  );
};

/** Append an id to an order list when it is not already present. */
export const withOrderId = (order: readonly string[], id: string): string[] =>
  order.includes(id) ? [...order] : [...order, id];

/**
 * Effective parent, cycle-safe (ADR-0027). A parent that does not exist
 * locally, or a parent chain that loops back to this group, resolves to
 * `null` so the group renders as a root instead of disappearing.
 */
export const displayParentId = (
  groups: BookGroupRecord[],
  group: BookGroupRecord,
): string | null => {
  if (!group.parentId) return null;
  const byId = new Map(groups.map((item) => [item.id, item]));
  if (!byId.has(group.parentId)) return null;
  const seen = new Set<string>([group.id]);
  let cursor = byId.get(group.parentId);
  while (cursor) {
    if (seen.has(cursor.id)) return null;
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return group.parentId;
};

/** Direct children of a group, or root groups when `parentId` is null. */
export const childrenOf = (
  groups: BookGroupRecord[],
  parentId: string | null,
): BookGroupRecord[] => {
  const children = groups.filter((group) => displayParentId(groups, group) === parentId);
  if (parentId === null) return children.sort((a, b) => a.createdAt - b.createdAt);
  const parent = groups.find((group) => group.id === parentId);
  return parent ? orderSubgroups(parent, children) : children;
};

/** Root groups: no parent, or a dangling/cyclic parent (ADR-0027). */
export const topLevelGroups = (groups: BookGroupRecord[]): BookGroupRecord[] =>
  childrenOf(groups, null);

/**
 * Ancestors from the root down to the immediate parent, excluding the group
 * itself. Cycle-safe: the chain stops at the first repeated id.
 */
export const groupAncestors = (groups: BookGroupRecord[], groupId: string): BookGroupRecord[] => {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<string>([groupId]);
  const chain: BookGroupRecord[] = [];
  const self = byId.get(groupId);
  let cursor = self?.parentId ? byId.get(self.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain.reverse();
};

/** Group and every descendant id, cycle-safe. */
export const subtreeGroupIds = (groups: BookGroupRecord[], groupId: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [groupId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    const group = groups.find((item) => item.id === id);
    if (!group && id !== groupId) continue;
    seen.add(id);
    out.push(id);
    for (const child of groups) {
      if (displayParentId(groups, child) === id && !seen.has(child.id)) queue.push(child.id);
    }
  }
  return out;
};

/** Every book filed in the group or any descendant. */
export const subtreeBooks = (
  groups: BookGroupRecord[],
  books: BookRecord[],
  groupId: string,
): BookRecord[] => {
  const ids = new Set(subtreeGroupIds(groups, groupId));
  return books.filter((book) => book.groupId !== null && ids.has(book.groupId));
};

/** True when `parentId` can become this group's parent without a cycle. */
export const canNestUnder = (
  groups: BookGroupRecord[],
  groupId: string,
  parentId: string,
): boolean => {
  if (groupId === parentId) return false;
  if (!groups.some((group) => group.id === parentId)) return false;
  // Making `parentId` the parent is a cycle exactly when the would-be parent
  // already sits under this group.
  return !subtreeGroupIds(groups, groupId).includes(parentId);
};

/** Depth of a group: 0 for a root group. */
export const groupDepth = (groups: BookGroupRecord[], groupId: string): number =>
  groupAncestors(groups, groupId).length;

/**
 * Flatten the group tree for pickers: depth-first from the roots, preserving
 * sibling order, so names can be indented by depth.
 */
export const flattenGroups = (
  groups: BookGroupRecord[],
): { group: BookGroupRecord; depth: number }[] => {
  const out: { group: BookGroupRecord; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const group of childrenOf(groups, parentId)) {
      out.push({ group, depth });
      visit(group.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
};

/** "Course / Week 1" style ancestor label, excluding the group itself. */
export const groupPathLabel = (
  groups: BookGroupRecord[],
  groupId: string,
  separator = ' / ',
): string =>
  groupAncestors(groups, groupId)
    .map((group) => group.name)
    .join(separator);

export type GroupDeleteMode = 'with-contents' | 'keep-books' | 'only-group';

/** What a delete choice does, computed before touching storage. */
export interface GroupDeletionPlan {
  /** Groups to tombstone and remove. */
  groupIds: string[];
  /** Books to delete with their files ('with-contents' only). */
  deletedBookIds: string[];
  /** Child groups that survive with a new parent ('only-group' only). */
  promoteGroups: { id: string; parentId: string | null }[];
  /** Books that survive but change membership. */
  moveBooks: { id: string; groupId: string | null }[];
}

/**
 * Plan one of the three delete choices (ADR-0027):
 * - with-contents: the subtree and every book inside it go;
 * - keep-books: the subtree's groups go, books move to the deleted group's
 *   parent (or become ungrouped at the root);
 * - only-group: just this group goes, children and books move up one level.
 */
export const planGroupDeletion = (
  groups: BookGroupRecord[],
  books: BookRecord[],
  groupId: string,
  mode: GroupDeleteMode,
): GroupDeletionPlan => {
  const group = groups.find((item) => item.id === groupId);
  if (!group) {
    return { groupIds: [], deletedBookIds: [], promoteGroups: [], moveBooks: [] };
  }
  const parentId = displayParentId(groups, group);
  if (mode === 'with-contents') {
    const groupIds = subtreeGroupIds(groups, groupId);
    const deletedBookIds = books
      .filter((book) => book.groupId !== null && groupIds.includes(book.groupId))
      .map((book) => book.id);
    return { groupIds, deletedBookIds, promoteGroups: [], moveBooks: [] };
  }
  if (mode === 'keep-books') {
    const groupIds = subtreeGroupIds(groups, groupId);
    const moveBooks = books
      .filter((book) => book.groupId !== null && groupIds.includes(book.groupId))
      .map((book) => ({ id: book.id, groupId: parentId }));
    return { groupIds, deletedBookIds: [], promoteGroups: [], moveBooks };
  }
  const promoteGroups = groups
    .filter((item) => displayParentId(groups, item) === groupId)
    .map((item) => ({ id: item.id, parentId }));
  const moveBooks = books
    .filter((book) => book.groupId === groupId)
    .map((book) => ({ id: book.id, groupId: parentId }));
  return { groupIds: [groupId], deletedBookIds: [], promoteGroups, moveBooks };
};

/**
 * Groups whose name matches the query, with the same Persian-aware folding as
 * book titles. An empty query matches nothing: groups only surface by name.
 */
export const matchGroupsByName = (groups: BookGroupRecord[], query: string): BookGroupRecord[] => {
  const needle = normalizeForSearch(query.trim());
  if (!needle) return [];
  return groups.filter((group) => normalizeForSearch(group.name).includes(needle));
};

/**
 * Move `draggedId` directly before `targetId` in the member order. Returns
 * null when either id is absent, so a stale drag is a no-op rather than a
 * corrupted order.
 */
export const reorderBefore = (
  order: readonly string[],
  draggedId: string,
  targetId: string,
): string[] | null => {
  const members = [...order];
  const from = members.indexOf(draggedId);
  const to = members.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return null;
  const [moved] = members.splice(from, 1);
  members.splice(to, 0, moved ?? draggedId);
  return members;
};
