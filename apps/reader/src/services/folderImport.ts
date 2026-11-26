/**
 * Bulk folder import (design: docs/superpowers/specs/2026-11-26-bulk-folder-
 * import-design.md). A picked directory tree becomes groups mirroring the
 * folders (ADR-0027), and every book file becomes a normal import.
 *
 * This module is the pure part: File objects in, a creation plan out. The App
 * owns persistence, progress and cancellation.
 */

/** Book extensions the importer accepts (mirrors the file input's accept). */
const SUPPORTED_EXTENSIONS = new Set([
  'epub',
  'pdf',
  'md',
  'markdown',
  'mp3',
  'm4b',
  'm4a',
  'flac',
  'ogg',
  'opus',
  'mp4',
  'mkv',
  'webm',
]);

/** One picked folder that will become a group. */
export interface FolderGroupPlan {
  /** Full relative folder path, e.g. "CS224W/slides". */
  path: string;
  /** Display name (last path segment). */
  name: string;
  /** Parent folder path, or null for the picked root folder. */
  parentPath: string | null;
  /** Book files directly inside this folder. */
  files: File[];
}

export interface FolderImportPlan {
  /** Parents always precede their children. */
  groups: FolderGroupPlan[];
  /** Book files with no folder segment (plain multi-select fallback). */
  rootFiles: File[];
  /** Unsupported or hidden files that will be ignored, counted. */
  skipped: number;
  /** Files the import will attempt. */
  total: number;
}

export class FolderImportError extends Error {
  readonly code: 'EMPTY' | 'TOO_MANY';

  constructor(code: 'EMPTY' | 'TOO_MANY', message: string) {
    super(message);
    this.name = 'FolderImportError';
    this.code = code;
  }
}

/** Guard against a runaway pick (a whole home directory, say). */
export const MAX_FOLDER_IMPORT_FILES = 500;

const isSupported = (name: string): boolean => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return SUPPORTED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
};

const relativePathOf = (file: File): string =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';

/**
 * Build the import plan for a folder pick. Files come from a
 * `webkitdirectory` input, so `webkitRelativePath` carries the tree
 * ("CS224W/slides/01.pdf"). Hidden entries (dot prefixed at any depth) and
 * unsupported files are skipped; folders that end up with no files anywhere
 * below them are dropped.
 *
 * Throws FolderImportError with EMPTY (nothing importable) or TOO_MANY
 * (above MAX_FOLDER_IMPORT_FILES) so the caller can localize the message.
 */
export const planFolderImport = (files: readonly File[]): FolderImportPlan => {
  const groups = new Map<string, FolderGroupPlan>();
  const rootFiles: File[] = [];
  let skipped = 0;
  let supported = 0;

  const ensureGroup = (path: string): FolderGroupPlan => {
    const existing = groups.get(path);
    if (existing) return existing;
    const segments = path.split('/').filter(Boolean);
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : null;
    const group: FolderGroupPlan = {
      path,
      name: segments.at(-1) ?? path,
      parentPath,
      files: [],
    };
    groups.set(path, group);
    // A parent can be implicit when a deep file arrives first.
    if (parentPath) ensureGroup(parentPath);
    return group;
  };

  for (const file of files) {
    const segments = relativePathOf(file).split('/').filter(Boolean);
    const name = segments.at(-1) ?? file.name;
    if (segments.some((segment) => segment.startsWith('.'))) {
      skipped += 1;
      continue;
    }
    if (!isSupported(name)) {
      skipped += 1;
      continue;
    }
    supported += 1;
    if (supported > MAX_FOLDER_IMPORT_FILES) {
      throw new FolderImportError('TOO_MANY', 'too many files in one pick');
    }
    const folderPath = segments.slice(0, -1).join('/');
    if (!folderPath) {
      rootFiles.push(file);
      continue;
    }
    ensureGroup(folderPath).files.push(file);
  }

  if (supported === 0) {
    throw new FolderImportError('EMPTY', 'no book files in this folder');
  }

  const hasContent = (path: string): boolean => {
    const group = groups.get(path);
    if (!group) return false;
    if (group.files.length > 0) return true;
    for (const child of groups.values()) {
      if (child.parentPath === path && hasContent(child.path)) return true;
    }
    return false;
  };

  const ordered = [...groups.values()]
    .filter((group) => hasContent(group.path))
    .sort((a, b) => {
      const depth = a.path.split('/').length - b.path.split('/').length;
      return depth !== 0 ? depth : a.path.localeCompare(b.path);
    });

  return { groups: ordered, rootFiles, skipped, total: supported };
};
