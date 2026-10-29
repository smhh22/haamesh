/**
 * Extract plain text per spine section from an EPUB for library content
 * search. Uses `createDocument` (no blob URLs), so it runs in jsdom tests and
 * in workers alike. PDFs are not covered: fixed-layout text extraction is a
 * separate later feature.
 */
import { makeBook } from 'foliate-js/view.js';

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

const textOf = (doc: Document): string => {
  for (const node of doc.querySelectorAll('script, style, head')) node.remove();
  return collapse(doc.documentElement?.textContent ?? doc.body?.textContent ?? '');
};

export interface ExtractedBookText {
  /** Text per spine index; empty string when a section has no text. */
  sections: string[];
}

export const extractEpubText = async (file: File | Blob): Promise<ExtractedBookText> => {
  const book = await makeBook(file);
  try {
    const sections: string[] = [];
    for (const section of book.sections ?? []) {
      const loader = section as { createDocument?: () => Promise<Document> } | null;
      if (!loader?.createDocument) {
        sections.push('');
        continue;
      }
      try {
        const doc = await loader.createDocument();
        sections.push(doc ? textOf(doc) : '');
      } catch {
        sections.push('');
      }
    }
    return { sections };
  } finally {
    book.destroy();
  }
};
