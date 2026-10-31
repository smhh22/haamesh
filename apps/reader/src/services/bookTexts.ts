/**
 * Library content search (storage v3): per-section text extracted from EPUBs
 * at import time, searched with the shared Persian-aware normalizer.
 */
import { extractEpubText } from '@hamesh/engine';
import { createDataStore } from './dataStore';
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

/**
 * Reconciliation after a sync round downloaded books: extract texts for EPUBs
 * that have a local file but no stored text yet. Best-effort; never throws.
 */
export const extractMissingBookTexts = async (): Promise<number> => {
  const storage = getActiveStorage();
  if (!storage) return 0;
  const dataStore = await createDataStore();
  if (!dataStore) return 0;
  let extracted = 0;
  try {
    const books = await storage.storage.books.list();
    for (const book of books) {
      if (book.format !== 'epub') continue;
      if (await storage.storage.texts.has(book.id)) continue;
      const bytes = await dataStore.read(`books/${book.hash}.${book.format}`);
      if (!bytes) continue;
      const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
      copy.set(bytes);
      // foliate inspects file.name (isCBZ), so a real File is required.
      const file = new File([copy], `${book.hash}.${book.format}`, {
        type: 'application/epub+zip',
      });
      const { sections } = await extractEpubText(file);
      await storage.storage.texts.replace(book.id, sections);
      extracted += 1;
      // Yield so a batch of large books cannot block input and paint.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    console.warn('Book text reconciliation failed', error);
  }
  return extracted;
};
