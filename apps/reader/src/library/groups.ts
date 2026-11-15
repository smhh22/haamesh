/**
 * Pure helpers for category groups (ADR-0025). The App derives members and
 * visibility around these; keeping them here makes the merge/order rules
 * unit-testable without React.
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
