import type { BookFormat, BookMetadata, BookNote, Locator, ReadingStatus } from '@hamesh/core';

export interface BookRecord extends BookMetadata {
  id: string;
  /** User-assigned shelf; at most one per book (ADR-0013). */
  category: string | null;
  /** User-assigned labels; synced as one LWW field (ADR-0013). */
  tags: string[];
  /** Group that owns this book on the shelf (ADR-0025); at most one. */
  groupId: string | null;
  filePath: string;
  /** Runtime object URL; never persisted. */
  coverPath: string | null;
  /** Needed to recreate the cover Blob after a restart. */
  coverMime?: string | null;
  addedAt: number;
  updatedAt: number;
}

/**
 * A shelf inside a category (ADR-0025), nestable (ADR-0027). Membership lives
 * on the book (`BookRecord.groupId`) and on the group (`parentId`); `order` is
 * the display order of member books and child groups and may keep stale ids
 * after one is deleted — callers filter against live records.
 */
export interface BookGroupRecord {
  id: string;
  name: string;
  /** Root category; a child keeps its root ancestor's category. */
  category: string | null;
  /** Parent group (ADR-0027); null means a root group in `category`. */
  parentId: string | null;
  order: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ReadingState {
  bookId: string;
  locator: Locator | null;
  fraction: number;
  status: ReadingStatus;
  updatedAt: number;
}

/** Phase 1 manifest (ADR-0010). `notes` and `groups` are additive. */
export interface LibrarySnapshot {
  version: 1;
  books: BookRecord[];
  reading: Record<string, ReadingState>;
  notes?: BookNoteRecord[];
  /** ADR-0025; absent in manifests written before groups existed. */
  groups?: BookGroupRecord[];
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

export interface BookGroupRepository {
  list(): Promise<BookGroupRecord[]>;
  get(id: string): Promise<BookGroupRecord | null>;
  upsert(group: BookGroupRecord): Promise<void>;
  remove(id: string): Promise<void>;
  /** Clear membership on every book of a deleted group (ADR-0025). */
  clearMembers(groupId: string): Promise<void>;
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
  /** v8: categories' shelves (ADR-0025). */
  groups: BookGroupRepository;
}

import type { ContentTextRepository } from './sql';

export type {
  ContentTextRepository,
  SqlDatabase,
  SqlValue,
  SyncClockRepository,
  TranslationCacheEntry,
  TranslationCacheRepository,
} from './sql';
export {
  createContentTextRepository,
  createSqlStorage,
  createSyncClockRepository,
  createTranslationCacheRepository,
  migrate,
  migrateJsonSnapshot,
  searchBookTexts,
} from './sql';
/** Re-exported for storage implementations that do not import core directly. */
export type { BookFormat, Locator, ReadingStatus };
