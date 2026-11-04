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
      category: null,
      tags: [],
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

/** How a URL-imported book syncs (ADR-0019): full bytes or just the link. */
export type UrlSyncMode = 'blob' | 'url';

export class UrlImportError extends Error {
  readonly code: 'URL_INVALID' | 'URL_FAILED';
  constructor(code: 'URL_INVALID' | 'URL_FAILED', message: string) {
    super(message);
    this.name = 'UrlImportError';
    this.code = code;
  }
}

const fileNameFromUrl = (url: string, type: string): string => {
  let name = 'book';
  try {
    const last = new URL(url).pathname.split('/').pop();
    if (last) name = decodeURIComponent(last);
  } catch {
    // The URL was validated before the request; fall back to the base name.
  }
  if (/\.(epub|pdf|md|markdown)$/i.test(name)) return name;
  if (type === 'application/pdf') return `${name}.pdf`;
  if (type === 'text/markdown') return `${name}.md`;
  return `${name}.epub`;
};

/**
 * Download a book from a URL and import it. The record's identifiers keep the
 * provenance (`sourceUrl`, and `syncVia: 'url'` when the user chose to sync
 * the link instead of the file — ADR-0019); plain fetch for now, with the
 * sync proxy to be wired through httpFetch later.
 */
export const importBookFromUrl = async (
  url: string,
  syncVia: UrlSyncMode,
): Promise<ImportedBookFile> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlImportError('URL_INVALID', 'not a URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlImportError('URL_INVALID', 'only http(s) URLs are supported');
  }
  let response: Response;
  try {
    response = await fetch(parsed);
  } catch {
    throw new UrlImportError('URL_FAILED', 'the download failed');
  }
  if (!response.ok) {
    throw new UrlImportError('URL_FAILED', `the server answered ${response.status}`);
  }
  const type = response.headers.get('content-type')?.split(';')[0] ?? '';
  const bytes = await response.arrayBuffer();
  const file = new File([bytes], fileNameFromUrl(url, type), { type });
  const imported = await importBookFile(file);
  imported.record.identifiers = {
    ...imported.record.identifiers,
    sourceUrl: url,
    ...(syncVia === 'url' ? { syncVia: 'url' } : {}),
  };
  return imported;
};
