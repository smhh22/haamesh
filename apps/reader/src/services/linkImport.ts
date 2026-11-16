/**
 * Link-only import (ADR-0026). A link is registered as a *pending* record
 * whose id derives from its URL; the bytes are fetched only on explicit user
 * action, streamed with progress and cancel, then materialized into a normal
 * content-hashed book. Sync never uploads blobs for these records unless a
 * link rots and a device that holds the file is asked to rescue it.
 */
import { sha256Hex } from '@hamesh/engine';
import type { BookFormat, BookRecord } from '@hamesh/storage';
import { useLibraryStore } from '../stores/libraryStore';
import { isTauriRuntime } from './dataStore';
import { importBookFile } from './importBook';
import { deletePersistedBook, persistBook } from './libraryPersistence';

export type LinkImportErrorCode =
  | 'URL_INVALID'
  | 'UNSUPPORTED_FORMAT'
  | 'TOO_LARGE'
  | 'NETWORK'
  | 'CANCELLED'
  | 'STORAGE';

export class LinkImportError extends Error {
  readonly code: LinkImportErrorCode;

  constructor(code: LinkImportErrorCode, message: string) {
    super(message);
    this.name = 'LinkImportError';
    this.code = code;
  }
}

const SIZE_CAP_KEY = 'hamesh.library.linkSizeCapMb';
export const DEFAULT_LINK_SIZE_CAP_MB = 2048;

/** Device-local cap for a single link download; 0 means no cap. */
export const readLinkSizeCapMb = (): number => {
  try {
    const stored = localStorage.getItem(SIZE_CAP_KEY);
    if (stored === null) return DEFAULT_LINK_SIZE_CAP_MB;
    const raw = Number(stored);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_LINK_SIZE_CAP_MB;
  } catch {
    return DEFAULT_LINK_SIZE_CAP_MB;
  }
};

export const saveLinkSizeCapMb = (value: number): void => {
  try {
    localStorage.setItem(SIZE_CAP_KEY, String(Math.max(0, Math.round(value))));
  } catch {
    // Storage full or blocked; the default applies.
  }
};

const MAX_CAP_BYTES = (): number => readLinkSizeCapMb() * 1024 * 1024;

const FORMAT_BY_EXT: Record<string, BookFormat> = {
  epub: 'epub',
  pdf: 'pdf',
  mp3: 'audio',
  m4a: 'audio',
  m4b: 'audio',
  ogg: 'audio',
  wav: 'audio',
  flac: 'audio',
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mkv: 'video',
  mov: 'video',
};

const FORMAT_BY_TYPE = (type: string): BookFormat | null => {
  const main = type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (main === 'application/epub+zip') return 'epub';
  if (main === 'application/pdf') return 'pdf';
  if (main.startsWith('audio/')) return 'audio';
  if (main.startsWith('video/')) return 'video';
  return null;
};

/** Validate and canonicalize a link; credentials never belong in book URLs. */
export const normalizeLinkUrl = (raw: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new LinkImportError('URL_INVALID', 'not a URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new LinkImportError('URL_INVALID', 'only http(s) links are supported');
  }
  if (parsed.username || parsed.password) {
    throw new LinkImportError('URL_INVALID', 'credentials in links are not allowed');
  }
  parsed.hash = '';
  return parsed;
};

const fileNameOf = (url: URL): string => {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

export const titleFromLink = (url: URL): string => {
  const name = fileNameOf(url);
  const stem = name.replace(/\.[^.]+$/, '');
  return stem || url.hostname;
};

export const detectLinkFormat = (url: URL, contentType: string | null): BookFormat | null => {
  const ext = fileNameOf(url).split('.').pop()?.toLowerCase() ?? '';
  return (
    (ext ? FORMAT_BY_EXT[ext] : undefined) ?? (contentType ? FORMAT_BY_TYPE(contentType) : null)
  );
};

/** Deterministic pending identity: every device derives the same id. */
export const pendingBookId = async (url: URL): Promise<string> =>
  sha256Hex(new TextEncoder().encode(`url:${url.toString()}`));

export const isPendingBook = (book: BookRecord): boolean => book.identifiers.pending === '1';

export interface LinkProbe {
  format: BookFormat;
  contentType: string | null;
  size: number | null;
}

/**
 * HEAD probe for the content type and size. A server that rejects HEAD (405,
 * 501) still yields a format from the URL extension; the streaming download
 * enforces the cap on the body regardless.
 */
export const probeLink = async (url: URL, fetchImpl: typeof fetch = fetch): Promise<LinkProbe> => {
  let contentType: string | null = null;
  let size: number | null = null;
  try {
    const response = await fetchImpl(url.toString(), { method: 'HEAD' });
    if (response.ok) {
      contentType = response.headers.get('content-type');
      const length = Number(response.headers.get('content-length'));
      size = Number.isFinite(length) && length > 0 ? length : null;
    }
  } catch {
    // A blocked or slow HEAD is not fatal; the download reports the real error.
  }
  const format = detectLinkFormat(url, contentType);
  if (!format) throw new LinkImportError('UNSUPPORTED_FORMAT', 'unsupported link type');
  const cap = MAX_CAP_BYTES();
  if (size !== null && cap > 0 && size > cap) {
    throw new LinkImportError('TOO_LARGE', 'link is larger than the size cap');
  }
  return { format, contentType, size };
};

/** Build the pending record for a validated link. */
export const pendingBookRecord = async (url: URL, probe: LinkProbe): Promise<BookRecord> => {
  const id = await pendingBookId(url);
  const now = Date.now();
  return {
    id,
    hash: id,
    format: probe.format,
    title: titleFromLink(url),
    authors: [],
    language: null,
    publisher: null,
    series: null,
    identifiers: {
      sourceUrl: url.toString(),
      syncVia: 'url',
      pending: '1',
    },
    direction: 'ltr',
    category: null,
    tags: [],
    groupId: null,
    filePath: fileNameOf(url),
    coverPath: null,
    coverMime: null,
    addedAt: now,
    updatedAt: now,
  };
};

export interface LinkDownloadOutcome {
  sha256: string;
  bytes: Uint8Array;
}

export interface LinkDownloadOptions {
  /** Progress in 0–1 when the total is known, else null. */
  onProgress?: (fraction: number | null, received: number, total: number | null) => void;
  /** Cancel token shared with the platform downloader. */
  token: string;
  /** Temp file path under the app data dir (desktop streaming target). */
  tempRelative: string;
}

const downloadWeb = async (
  url: URL,
  options: LinkDownloadOptions,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; sha256: string }> => {
  const cap = MAX_CAP_BYTES();
  let response: Response;
  try {
    response = await fetch(url.toString(), { signal });
  } catch (error) {
    if (signal.aborted) throw new LinkImportError('CANCELLED', 'cancelled');
    throw new LinkImportError('NETWORK', String(error));
  }
  if (!response.ok) throw new LinkImportError('NETWORK', `HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || null;
  if (total !== null && cap > 0 && total > cap) {
    throw new LinkImportError('TOO_LARGE', 'link is larger than the size cap');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new LinkImportError('NETWORK', 'no response body');
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      if (signal.aborted) throw new LinkImportError('CANCELLED', 'cancelled');
      throw new LinkImportError('NETWORK', 'read failed');
    }
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (cap > 0 && received > cap) {
      await reader.cancel().catch(() => undefined);
      throw new LinkImportError('TOO_LARGE', 'link is larger than the size cap');
    }
    chunks.push(chunk.value);
    options.onProgress?.(total ? Math.min(1, received / total) : null, received, total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, sha256: await sha256Hex(bytes) };
};

const downloadDesktop = async (
  url: URL,
  options: LinkDownloadOptions,
): Promise<{ bytes: Uint8Array; sha256: string }> => {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { readAppProxy } = await import('./httpFetch');
  const { createDataStore } = await import('./dataStore');
  const unlisten = await listen<{ token: string; received: number; total: number | null }>(
    'link-download-progress',
    (event) => {
      if (event.payload.token !== options.token) return;
      const { received, total } = event.payload;
      options.onProgress?.(total ? Math.min(1, received / total) : null, received, total ?? null);
    },
  );
  try {
    const result = await invoke<{ sha256: string; bytes: number }>('link_download', {
      url: url.toString(),
      relative: options.tempRelative,
      proxy: readAppProxy() || null,
      token: options.token,
      maxBytes: MAX_CAP_BYTES(),
    });
    const store = await createDataStore();
    const bytes = store ? await store.read(options.tempRelative) : null;
    if (!bytes) throw new LinkImportError('STORAGE', 'downloaded file missing');
    return { bytes, sha256: result.sha256 };
  } catch (error) {
    if (error instanceof LinkImportError) throw error;
    if (typeof error === 'string') {
      if (error === 'cancelled') throw new LinkImportError('CANCELLED', error);
      if (error === 'download-too-large') throw new LinkImportError('TOO_LARGE', error);
      throw new LinkImportError('NETWORK', error);
    }
    throw error;
  } finally {
    unlisten();
  }
};

/** Fetch a pending link's bytes with progress; cancel via `cancelLinkDownload`. */
export const downloadLink = async (
  url: URL,
  options: LinkDownloadOptions,
  signal: AbortSignal,
): Promise<LinkDownloadOutcome> => {
  const outcome = isTauriRuntime()
    ? await downloadDesktop(url, options)
    : await downloadWeb(url, options, signal);
  return outcome;
};

/** Cancel a desktop stream by its token (the web path uses AbortSignal). */
export const cancelLinkDownload = async (token: string): Promise<void> => {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('link_cancel', { token });
  } catch {
    // The download may have finished; nothing to cancel.
  }
};

export interface MaterializeOptions {
  onProgress?: (fraction: number | null, received: number, total: number | null) => void;
  signal: AbortSignal;
}

export interface MaterializeResult {
  book: BookRecord;
  /** True when the content already existed and the pending link was dropped. */
  deduped: boolean;
}

/**
 * Fetch a pending link and turn it into a normal content-hashed book
 * (ADR-0026). Dedupe happens on the fetched digest: if the same content is
 * already in the library, the pending record is removed and the existing
 * book is returned — pending books have no notes or progress, so nothing is
 * lost. On desktop the bytes stream to a temp file first, so a crash mid
 * download leaves no half record.
 */
export const materializePendingBook = async (
  book: BookRecord,
  options: MaterializeOptions,
): Promise<MaterializeResult> => {
  const sourceUrl = book.identifiers.sourceUrl;
  if (!sourceUrl) throw new LinkImportError('URL_INVALID', 'pending book has no link');
  const url = normalizeLinkUrl(sourceUrl);
  const token = crypto.randomUUID();
  const tempRelative = `downloads/${book.id}.${book.format}`;
  let outcome: LinkDownloadOutcome;
  try {
    outcome = await downloadLink(
      url,
      { token, tempRelative, onProgress: options.onProgress },
      options.signal,
    );
  } finally {
    if (isTauriRuntime()) {
      try {
        const { createDataStore } = await import('./dataStore');
        const store = await createDataStore();
        await store?.remove(tempRelative);
      } catch {
        // Best-effort cleanup of the streamed temp file.
      }
    }
  }

  const existing = useLibraryStore.getState().books.find((item) => item.id === outcome.sha256);
  if (existing) {
    await deletePersistedBook(book);
    useLibraryStore.getState().removeBook(book.id);
    return { book: existing, deduped: true };
  }

  const name = fileNameOf(url) || `${book.title}.${book.format}`;
  const type =
    book.format === 'pdf'
      ? 'application/pdf'
      : book.format === 'epub'
        ? 'application/epub+zip'
        : 'application/octet-stream';
  // BlobPart needs a plain ArrayBuffer; copy the view's bytes once.
  const buffer = new ArrayBuffer(outcome.bytes.byteLength);
  new Uint8Array(buffer).set(outcome.bytes);
  const imported = await importBookFile(new File([buffer], name, { type }));
  // The user may have organized the link before opening it: the real record
  // keeps the pending record's group, category and tags (ADR-0026).
  const record: BookRecord = {
    ...imported.record,
    groupId: book.groupId,
    category: book.category,
    tags: book.tags,
  };
  useLibraryStore.getState().addBook(record);
  await persistBook(record, imported.file, imported.cover);
  // The pending record is replaced by the content-addressed one; the
  // tombstone keeps other devices from resurrecting the placeholder.
  await deletePersistedBook(book);
  useLibraryStore.getState().removeBook(book.id);
  return { book: record, deduped: false };
};
