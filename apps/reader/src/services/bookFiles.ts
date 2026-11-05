/**
 * Runtime cache of opened book files. The reader holds the File it was given,
 * so evicting an older entry only means the next open reads it again; without
 * a cap, a long session kept every book's bytes (large PDFs included) in
 * memory forever. Two entries cover "current book + the one just switched
 * from"; WebKit does not return freed heap to the OS promptly, so a lower cap
 * is the only lever that actually shows in the process's RSS.
 */
const MAX_CACHED_BOOKS = 2;

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

/** Hashes currently held in memory (fresh imports, recently opened books). */
export const cachedBookHashes = (): Set<string> => new Set(files.keys());
