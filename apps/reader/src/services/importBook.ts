import { importEpub } from '@hamesh/engine';
import type { BookRecord } from '@hamesh/storage';
import { rememberBookFile } from './bookFiles';

export interface ImportedBookFile {
  record: BookRecord;
  file: File;
  cover: Blob | null;
}

/**
 * Import an EPUB into the library. The file and cover are returned so the
 * persistence layer can store them; the record only carries a runtime cover URL.
 */
export const importBookFile = async (file: File): Promise<ImportedBookFile> => {
  const { metadata, cover } = await importEpub(file);
  const now = Date.now();
  const coverPath =
    cover && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(cover) : null;

  rememberBookFile(metadata.hash, file);

  return {
    record: {
      ...metadata,
      id: metadata.hash,
      filePath: file.name,
      coverPath,
      coverMime: cover?.type || null,
      addedAt: now,
      updatedAt: now,
    },
    file,
    cover,
  };
};
