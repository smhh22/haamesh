import type { BookFormat, BookMetadata } from '@hamesh/core';
import { makeBook } from 'foliate-js/view.js';
import { parseBlob } from 'music-metadata';
import { resolveBookDirection } from './direction';
import { ImportError } from './error';
import { sha256Hex } from './hash';
import { convertMarkdownToEpub, isMarkdownFile } from './markdown';

export { ImportError, type ImportErrorCode } from './error';
export { sha256Hex } from './hash';

export interface ImportedBook {
  metadata: BookMetadata;
  cover: Blob | null;
}

const languageMapToString = (value: unknown, preferred?: string | null): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  const map = value as Record<string, string>;
  if (preferred) {
    const exact = map[preferred];
    if (exact) return exact;
    const primary = preferred.split('-')[0];
    if (primary) {
      const match = map[primary];
      if (match) return match;
    }
  }
  const firstKey = Object.keys(map)[0];
  return firstKey ? (map[firstKey] ?? '') : '';
};

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

const contributorNames = (value: unknown, preferred?: string | null): string[] => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const named = languageMapToString((item as { name?: unknown }).name, preferred);
      return named || languageMapToString(item, preferred);
    })
    .filter((name) => name.length > 0);
};

const seriesName = (value: unknown, preferred?: string | null): string | null => {
  if (!value || typeof value !== 'object') return null;
  const series = (value as { series?: unknown }).series;
  const first = Array.isArray(series) ? series[0] : series;
  if (typeof first === 'string') return first || null;
  if (!first || typeof first !== 'object') return null;
  const named = languageMapToString((first as { name?: unknown }).name, preferred);
  const fallback = languageMapToString(first, preferred);
  return named || fallback || null;
};

/**
 * Read a book's identity and metadata without keeping the parsed book. The
 * hash is of the file bytes, so re-importing the same file is a no-op later.
 */
const importBookWithFormat = async (file: File, format: BookFormat): Promise<ImportedBook> => {
  if (file.size === 0) {
    throw new ImportError('INVALID_FILE', 'The selected file is empty.');
  }

  const bytes = Uint8Array.from(new Uint8Array(await file.arrayBuffer()));
  const hash = await sha256Hex(bytes);

  let book: Awaited<ReturnType<typeof makeBook>>;
  try {
    book = await makeBook(file);
  } catch (cause) {
    throw new ImportError('PARSE_FAILED', 'Could not parse the book file.', { cause });
  }

  try {
    const metadata = book.metadata ?? {};
    const languages = asArray(metadata.language).filter(
      (item): item is string => typeof item === 'string',
    );
    const language = languages[0]?.trim() || null;
    const pageProgression = book.dir === 'rtl' || book.dir === 'ltr' ? book.dir : undefined;
    const direction = resolveBookDirection({ pageProgression, language });
    const cover = await book.getCover().catch(() => null);

    return {
      metadata: {
        hash,
        format,
        title:
          languageMapToString(metadata.title, language) || file.name.replace(/\.(epub|pdf)$/i, ''),
        authors: contributorNames(metadata.author, language),
        language,
        publisher: contributorNames(metadata.publisher, language)[0] ?? null,
        series: seriesName(metadata.belongsTo, language),
        identifiers: metadata.identifier ? { primary: metadata.identifier } : {},
        direction,
      },
      cover,
    };
  } finally {
    book.destroy();
  }
};

export const isPdfFile = (file: File): boolean =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

export const importEpub = (file: File): Promise<ImportedBook> => importBookWithFormat(file, 'epub');

export const importPdf = (file: File): Promise<ImportedBook> => importBookWithFormat(file, 'pdf');

/**
 * Import a Markdown file by converting it to an EPUB first, so pagination,
 * search, notes, and sync treat it like any other EPUB.
 */
export const importMarkdown = async (file: File): Promise<ImportedBook> =>
  importEpub(await convertMarkdownToEpub(file));

/** Import an EPUB, PDF, or Markdown file, detected from type or extension. */
export const importBook = (file: File): Promise<ImportedBook> => {
  if (isPdfFile(file)) return importPdf(file);
  if (isMarkdownFile(file)) return importMarkdown(file);
  return importEpub(file);
};

/** Video containers Hāmesh imports (ADR-0023); keys are lowercase extensions. */
const VIDEO_CONTAINERS = new Map<string, string>([
  ['.mp4', 'mp4'],
  ['.mkv', 'mkv'],
  ['.webm', 'webm'],
]);

export const isVideoFile = (file: File): boolean =>
  VIDEO_CONTAINERS.has(file.name.slice(file.name.lastIndexOf('.')).toLowerCase()) ||
  file.type.startsWith('video/');

const videoContainer = (file: File): string =>
  VIDEO_CONTAINERS.get(file.name.slice(file.name.lastIndexOf('.')).toLowerCase()) ?? 'video';

/** Audio containers Hāmesh imports (ADR-0021); keys are lowercase extensions. */
const AUDIO_CONTAINERS = new Map<string, string>([
  ['.mp3', 'mp3'],
  ['.m4b', 'm4b'],
  ['.m4a', 'm4a'],
  ['.flac', 'flac'],
  ['.ogg', 'ogg'],
  ['.opus', 'opus'],
]);

export const isAudioFile = (file: File): boolean =>
  AUDIO_CONTAINERS.has(file.name.slice(file.name.lastIndexOf('.')).toLowerCase()) ||
  file.type.startsWith('audio/');

const audioContainer = (file: File): string =>
  AUDIO_CONTAINERS.get(file.name.slice(file.name.lastIndexOf('.')).toLowerCase()) ?? 'audio';

const pictureToBlob = (picture: { data: Uint8Array; format: string }): Blob | null => {
  const mime = picture.format?.includes('/')
    ? picture.format
    : picture.format
      ? `image/${picture.format}`
      : '';
  if (!mime.startsWith('image/')) return null;
  // Copy into a fresh buffer: tag data is ArrayBufferLike, and BlobPart
  // requires a plain ArrayBuffer under the strict TS 5.9 lib types.
  const bytes = new Uint8Array(picture.data);
  return new Blob([bytes], { type: mime });
};

/**
 * Import a video course (ADR-0023): local-only, content-addressed like any
 * book. Titles come from the file name; the container lands in
 * `identifiers.container`. No tag parsing in the MVP — mp4 metadata parsing
 * can ride on music-metadata later if titles prove worth it.
 */
export const importVideo = async (file: File): Promise<ImportedBook> => {
  if (file.size === 0) {
    throw new ImportError('INVALID_FILE', 'The selected file is empty.');
  }

  const bytes = Uint8Array.from(new Uint8Array(await file.arrayBuffer()));
  const hash = await sha256Hex(bytes);

  return {
    metadata: {
      hash,
      format: 'video',
      title: file.name.replace(/\.[^.]+$/, ''),
      authors: [],
      language: null,
      publisher: null,
      series: null,
      identifiers: { container: videoContainer(file) },
      direction: resolveBookDirection({ language: null }),
    },
    cover: null,
  };
};

/**
 * Import an audio book (ADR-0021): the file becomes a normal content-addressed
 * blob, tags fill title/authors/cover with file-name fallbacks, and the
 * concrete container lands in `identifiers.container` so the runtime MIME can
 * be derived without another format field. Tag parsing is best-effort — a
 * file without tags still imports.
 */
export const importAudio = async (file: File): Promise<ImportedBook> => {
  if (file.size === 0) {
    throw new ImportError('INVALID_FILE', 'The selected file is empty.');
  }

  const bytes = Uint8Array.from(new Uint8Array(await file.arrayBuffer()));
  const hash = await sha256Hex(bytes);

  let title = file.name.replace(/\.[^.]+$/, '');
  let authors: string[] = [];
  let language: string | null = null;
  let cover: Blob | null = null;
  try {
    const tags = await parseBlob(file);
    title = tags.common.title?.trim() || title;
    authors = [...asArray(tags.common.artist), ...asArray(tags.common.albumartist)]
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name) => name.trim());
    language = typeof tags.common.language === 'string' ? tags.common.language : null;
    const picture = tags.common.picture?.[0];
    cover = picture ? pictureToBlob(picture) : null;
  } catch {
    // Unreadable tags are not an import failure; the file name carries it.
  }

  return {
    metadata: {
      hash,
      format: 'audio',
      title,
      authors,
      language,
      publisher: null,
      series: null,
      identifiers: { container: audioContainer(file) },
      direction: resolveBookDirection({ language }),
    },
    cover,
  };
};
