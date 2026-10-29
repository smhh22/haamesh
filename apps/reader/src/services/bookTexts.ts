/**
 * Library content search (storage v3): per-section text extracted from EPUBs
 * at import time, searched with the shared Persian-aware normalizer.
 */
import { extractEpubText } from '@hamesh/engine';
import { getActiveStorage } from './libraryPersistence';

export interface ContentMatch {
  bookId: string;
  section: number;
  snippet: string;
}

const isEpub = (file: File): boolean =>
  file.type === 'application/epub+zip' || file.name.toLowerCase().endsWith('.epub');

/** Extract and store section texts after an import; best-effort, never throws. */
export const storeBookTexts = async (bookId: string, file: File): Promise<void> => {
  const storage = getActiveStorage();
  if (!storage || !isEpub(file)) return;
  try {
    const { sections } = await extractEpubText(file);
    await storage.storage.texts.replace(bookId, sections);
  } catch (error) {
    console.warn('Book text extraction failed', error);
  }
};

export const removeBookTexts = async (bookId: string): Promise<void> => {
  const storage = getActiveStorage();
  if (!storage) return;
  await storage.storage.texts.remove(bookId);
};

export const searchBookContent = async (query: string, limit = 12): Promise<ContentMatch[]> => {
  const storage = getActiveStorage();
  if (!storage) return [];
  return storage.storage.texts.search(query, limit);
};
