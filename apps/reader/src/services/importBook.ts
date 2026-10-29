import { importEpub } from '@hamesh/engine';
import type { BookRecord } from '@hamesh/storage';
import { rememberBookFile } from './bookFiles';

/**
 * Import an EPUB into the library. The file itself is kept in memory for this
 * slice; persistent content-addressed storage arrives with the storage layer.
 */
export const importBookFile = async (file: File): Promise<BookRecord> => {
  const { metadata, cover } = await importEpub(file);
  const now = Date.now();
  const coverPath =
    cover && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(cover) : null;

  rememberBookFile(metadata.hash, file);

  return {
    ...metadata,
    id: metadata.hash,
    filePath: file.name,
    coverPath,
    addedAt: now,
    updatedAt: now,
  };
};
