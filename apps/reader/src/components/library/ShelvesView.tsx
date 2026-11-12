import type { BookRecord } from '@hamesh/storage';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAuthorList, primaryActionLabel } from '../../library/bookDisplay';
import type { UiLocale } from '../../stores/uiStore';
import { BookCover } from './BookCover';

export interface ShelfBook {
  book: BookRecord;
  fraction: number;
}

export interface ShelfSection {
  key: string;
  name: string;
  books: BookRecord[];
}

interface ShelvesViewProps {
  /** The book the reader was last in, or the newest book when nothing is started. */
  featured: ShelfBook | null;
  featuredIsContinue: boolean;
  upNext: ShelfBook[];
  shelves: ShelfSection[];
  locale: UiLocale;
  onOpen: (book: BookRecord) => void;
  /** One shelf-sized card (the app renders BookCard with variant="shelf"). */
  renderBook: (book: BookRecord) => ReactNode;
}

/**
 * Direction C: a featured current book plus one horizontal shelf per
 * category. Covers rest on a shelf line; the rail scrolls by buttons on a
 * desktop and by swipe on a phone.
 */
export const ShelvesView = ({
  featured,
  featuredIsContinue,
  upNext,
  shelves,
  locale,
  onOpen,
  renderBook,
}: ShelvesViewProps) => {
  const { t } = useTranslation();
  const percentFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <div className="shelves-view">
      {featured ? (
        <section className="shelf-featured" aria-labelledby="featured-heading">
          <button
            type="button"
            className="featured-cover-button"
            aria-label={t('library.openBook', { title: featured.book.title })}
            onClick={() => onOpen(featured.book)}
          >
            <BookCover book={featured.book} variant="cover" className="featured-cover" />
          </button>

          <div className="featured-info">
            <p className="section-label" id="featured-heading">
              {featuredIsContinue ? t('library.continueReading') : t('library.sortRecent')}
            </p>
            <h2 className="featured-title">
              <span dir="auto">{featured.book.title}</span>
            </h2>
            <p className="featured-author" dir="auto">
              {formatAuthorList(featured.book.authors, locale) || t('library.unknownAuthor')}
            </p>
            {featured.fraction > 0 ? (
              <span className="featured-progress">
                <span className="progress-track">
                  <span style={{ inlineSize: `${Math.round(featured.fraction * 100)}%` }} />
                </span>
                <span className="progress-value">
                  {t('library.percent', {
                    percent: percentFormat.format(Math.round(featured.fraction * 100)),
                  })}
                </span>
              </span>
            ) : null}
            <button type="button" className="continue-button" onClick={() => onOpen(featured.book)}>
              {featuredIsContinue
                ? t('library.continue')
                : primaryActionLabel(featured.book, t, false, true)}
            </button>
          </div>

          {upNext.length > 0 ? (
            <div className="up-next">
              <p className="up-next-label">{t('library.upNext')}</p>
              <ul>
                {upNext.map(({ book, fraction }) => (
                  <li key={book.id}>
                    <button type="button" onClick={() => onOpen(book)}>
                      <BookCover book={book} variant="thumb" className="up-next-cover" />
                      <span className="up-next-title" dir="auto">
                        {book.title}
                      </span>
                      {fraction > 0 ? (
                        <span className="up-next-percent">
                          {t('library.percent', {
                            percent: percentFormat.format(Math.round(fraction * 100)),
                          })}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {shelves.map((shelf) => (
        <Shelf key={shelf.key} name={shelf.name} books={shelf.books} renderBook={renderBook} />
      ))}
    </div>
  );
};

const Shelf = ({
  name,
  books,
  renderBook,
}: {
  name: string;
  books: BookRecord[];
  renderBook: (book: BookRecord) => ReactNode;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const rtl = getComputedStyle(track).direction === 'rtl';
    // Physical x on purpose: scrollToOptions has no logical axis, so the
    // direction decides the sign. Fractional delta: smooth behavior.
    track.scrollBy(direction * track.clientWidth * 0.8 * (rtl ? -1 : 1), 0);
  };

  return (
    <section className="shelf">
      <div className="shelf-head">
        <h3 className="shelf-title">{name}</h3>
        <span className="shelf-count">{books.length}</span>
        <span className="shelf-spacer" />
        <div className="shelf-scroll">
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scroll(-1)}
            className="icon-button"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scroll(1)}
            className="icon-button"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
      <div className="shelf-track" ref={trackRef}>
        {books.map((book) => renderBook(book))}
      </div>
    </section>
  );
};
