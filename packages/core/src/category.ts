/**
 * Category paths (ADR-0022): a category is a `/`-separated path, so any depth
 * nests without schema or wire changes — it is still one synced string field.
 * Names (segments) may not contain the separator; inputs strip it.
 */

export const CATEGORY_SEPARATOR = '/';

/** Split a stored path into trimmed, non-empty segments. */
export const categorySegments = (path: string): string[] =>
  path
    .split(CATEGORY_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

/** Path of the parent node, or null for a root. */
export const categoryParent = (path: string): string | null => {
  const segments = categorySegments(path);
  return segments.length > 1 ? segments.slice(0, -1).join(CATEGORY_SEPARATOR) : null;
};

/** Display name (last segment) of a path. */
export const categoryName = (path: string): string => {
  const segments = categorySegments(path);
  return segments[segments.length - 1] ?? '';
};

/** Depth of a path; roots are 0. */
export const categoryDepth = (path: string): number =>
  Math.max(0, categorySegments(path).length - 1);

/** All ancestor paths, outermost first. */
export const categoryAncestors = (path: string): string[] => {
  const segments = categorySegments(path);
  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join(CATEGORY_SEPARATOR));
};

/** A name is valid when it is non-empty and carries no separator. */
export const isValidCategoryName = (name: string): boolean =>
  name.trim().length > 0 && !name.includes(CATEGORY_SEPARATOR);

/** Strip separators from typed names; used by every category input. */
export const sanitizeCategoryName = (name: string): string =>
  name.split(CATEGORY_SEPARATOR).join('').trim();

/** Join an optional parent with a name. */
export const categoryPathOf = (parent: string | null, name: string): string => {
  const clean = sanitizeCategoryName(name);
  return parent && parent.length > 0 ? `${parent}${CATEGORY_SEPARATOR}${clean}` : clean;
};

/** True when `path` is `root` or one of its descendants. */
export const isCategoryInSubtree = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}${CATEGORY_SEPARATOR}`);
