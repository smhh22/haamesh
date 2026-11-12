import type { BookRecord } from '@hamesh/storage';
import type { CSSProperties } from 'react';

/**
 * Typographic cover used wherever a book has no embedded artwork. The tint is
 * picked deterministically from a small paper-tone palette so the grid reads
 * as one shelf instead of a bag of random hues. Real covers always win.
 */

const TINTS = [
  { background: '#e7dfd0', ink: '#3c362c' },
  { background: '#dde5e0', ink: '#2c3f39' },
  { background: '#e6dfe2', ink: '#40353c' },
  { background: '#e8e2d4', ink: '#3a352b' },
  { background: '#e4e0d6', ink: '#37332a' },
  { background: '#e2e6e3', ink: '#303a35' },
  { background: '#ddd9e3', ink: '#383343' },
  { background: '#e4ded2', ink: '#3c362c' },
] as const;

const tintFor = (book: BookRecord) => {
  const seed = book.hash || book.id || book.title;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return TINTS[hash % TINTS.length] ?? { background: '#e7dfd0', ink: '#3c362c' };
};

export const FORMAT_LABEL: Record<BookRecord['format'], string> = {
  epub: 'EPUB',
  pdf: 'PDF',
  audio: 'MP3',
  video: 'MP4',
};

interface BookCoverProps {
  book: BookRecord;
  /** `cover` fills the grid cell; `thumb` is the compact catalog thumbnail. */
  variant?: 'cover' | 'thumb';
  className?: string;
}

export const BookCover = ({ book, variant = 'cover', className }: BookCoverProps) => {
  const tint = tintFor(book);
  const classes = ['book-cover', `is-${variant}`, className].filter(Boolean).join(' ');
  const label = FORMAT_LABEL[book.format];

  if (variant === 'thumb') {
    return (
      <span
        className={classes}
        style={{ '--cover-a': tint.background, '--cover-b': tint.ink } as CSSProperties}
        aria-hidden="true"
      >
        {book.title.trim().charAt(0).toLocaleUpperCase() || '?'}
      </span>
    );
  }

  return (
    <span
      className={classes}
      style={{ '--cover-a': tint.background, '--cover-b': tint.ink } as React.CSSProperties}
      aria-hidden="true"
    >
      {book.coverPath ? (
        <img src={book.coverPath} alt="" />
      ) : (
        <span className="book-cover-fallback">
          <span className="book-cover-title" dir="auto">
            {book.title}
          </span>
          <span className="book-cover-format">{label}</span>
        </span>
      )}
    </span>
  );
};
