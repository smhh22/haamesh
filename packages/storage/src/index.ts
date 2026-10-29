import type { BookFormat, BookMetadata, BookNote, Locator, ReadingStatus } from '@hamesh/core';

export interface BookRecord extends BookMetadata {
  id: string;
  filePath: string;
  coverPath: string | null;
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
  get(bookId: string): Promise<ReadingState | null>;
  save(state: ReadingState): Promise<void>;
}

export interface NoteRepository {
  list(bookId: string): Promise<BookNoteRecord[]>;
  upsert(note: BookNoteRecord): Promise<void>;
}

/**
 * Storage boundary. Implementations use SQLite on desktop and SQLite-WASM with
 * OPFS on web; book blobs live in a content-addressed store outside the
 * database.
 */
export interface Storage {
  books: BookRepository;
  reading: ReadingStateRepository;
  notes: NoteRepository;
}

/** Re-exported for storage implementations that do not import core directly. */
export type { BookFormat, Locator, ReadingStatus };
