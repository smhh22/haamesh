/**
 * Runtime cache of opened book files. The reader holds the File it was given,
 * so evicting an older entry only means the next open reads it again; without
 * a cap, a long session kept every book's bytes (large PDFs included) in
 * memory forever.
 */
const MAX_CACHED_BOOKS = 4;

const files = new Map<string, File>();

export const rememberBookFile = (hash: string, file: File): void => {
  files.delete(hash);
  files.set(hash, file);
  while (files.size > MAX_CACHED_BOOKS) {
    const oldest = files.keys().next().value;
    if (oldest === undefined) break;
    files.delete(oldest);
  }
};

export const getBookFile = (hash: string): File | null => {
  const file = files.get(hash);
  if (!file) return null;
  // Refresh recency so the books actually being read survive eviction.
  files.delete(hash);
  files.set(hash, file);
  return file;
};

export const forgetBookFile = (hash: string): void => {
  files.delete(hash);
};
