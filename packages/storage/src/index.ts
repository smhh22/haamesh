import type { BookFormat, BookMetadata, BookNote, Locator, ReadingStatus } from '@hamesh/core';

export interface BookRecord extends BookMetadata {
  id: string;
  /** User-assigned shelf; at most one per book (ADR-0012). */
  category: string | null;
  /** User-assigned labels; synced as one LWW field (ADR-0012). */
  tags: string[];
  filePath: string;
  /** Runtime object URL; never persisted. */
  coverPath: string | null;
  /** Needed to recreate the cover Blob after a restart. */
  coverMime?: string | null;
  addedAt: number;
  updatedAt: number;
}

export interface ReadingState {
  bookId: string;
  locator: Locator | null;
  fraction: number;
  status: ReadingStatus;
  updatedAt: number;
}

/** Phase 1 manifest (ADR-0010). `notes` is additive. */
export interface LibrarySnapshot {
  version: 1;
  books: BookRecord[];
  reading: Record<string, ReadingState>;
  notes?: BookNoteRecord[];
}

export interface BookNoteRecord {
  id: string;
  bookId: string;
  type: BookNote['type'];
  locator: Locator;
  color: string | null;
  text: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface BookRepository {
  list(): Promise<BookRecord[]>;
  get(id: string): Promise<BookRecord | null>;
  upsert(book: BookRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ReadingStateRepository {
  list(): Promise<ReadingState[]>;
  get(bookId: string): Promise<ReadingState | null>;
  save(state: ReadingState): Promise<void>;
}

export interface NoteRepository {
  list(bookId: string): Promise<BookNoteRecord[]>;
  listAll(): Promise<BookNoteRecord[]>;
  upsert(note: BookNoteRecord): Promise<void>;
}

/**
 * Storage boundary. Phase 1 uses the JSON manifest adapter from ADR-0010;
 * the target is SQLite on desktop and SQLite-WASM on web, with book blobs in a
 * content-addressed store outside the database.
 */
export interface Storage {
  books: BookRepository;
  reading: ReadingStateRepository;
  notes: NoteRepository;
  /** v3: per-section extracted text for library content search. */
  texts: ContentTextRepository;
}

import type { ContentTextRepository } from './sql';

export type { ContentTextRepository, SqlDatabase, SqlValue, SyncClockRepository } from './sql';
export {
  createContentTextRepository,
  createSqlStorage,
  createSyncClockRepository,
  migrate,
  migrateJsonSnapshot,
  searchBookTexts,
} from './sql';
/** Re-exported for storage implementations that do not import core directly. */
export type { BookFormat, Locator, ReadingStatus };
