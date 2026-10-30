import { convertMarkdownToEpub, importBook, isMarkdownFile } from '@hamesh/engine';
import type { BookRecord } from '@hamesh/storage';
import { rememberBookFile } from './bookFiles';

export interface ImportedBookFile {
  record: BookRecord;
  file: File;
  cover: Blob | null;
}

/**
 * Import a book into the library. Markdown is converted to EPUB first so the
 * stored bytes, the hash, and the file the reader opens are the same EPUB; the
 * record keeps the original file name for display. The file and cover are
 * returned so the persistence layer can store them; the record only carries a
 * runtime cover URL.
 */
export const importBookFile = async (file: File): Promise<ImportedBookFile> => {
  const bookFile = isMarkdownFile(file) ? await convertMarkdownToEpub(file) : file;
  const { metadata, cover } = await importBook(bookFile);
  const now = Date.now();
  const coverPath =
    cover && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(cover) : null;

  rememberBookFile(metadata.hash, bookFile);

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
    file: bookFile,
    cover,
  };
};
