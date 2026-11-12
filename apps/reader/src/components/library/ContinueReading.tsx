import type { BookRecord } from '@hamesh/storage';
import { useTranslation } from 'react-i18next';
import type { UiLocale } from '../../stores/uiStore';
import { BookCover } from './BookCover';

export interface ContinueItem {
  book: BookRecord;
  fraction: number;
}

interface ContinueReadingProps {
  items: ContinueItem[];
  locale: UiLocale;
  onOpen: (book: BookRecord) => void;
}

/**
 * The one piece of the library that knows what you were doing: books with a
 * reading position but not finished, most recently read first. Hidden when
 * there is nothing to continue.
 */
export const ContinueReading = ({ items, locale, onOpen }: ContinueReadingProps) => {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const percentFormat = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <section className="continue-reading" aria-labelledby="continue-heading">
      <h2 className="section-label" id="continue-heading">
        {t('library.continueReading')}
      </h2>
      <div className="continue-track">
        {items.map(({ book, fraction }) => {
          const percent = Math.round(fraction * 100);
          return (
            <button
              key={book.id}
              type="button"
              className="continue-item"
              onClick={() => onOpen(book)}
            >
              <BookCover book={book} variant="thumb" className="continue-cover" />
              <span className="continue-text">
                <span className="continue-title" dir="auto">
                  {book.title}
                </span>
                <span className="continue-author" dir="auto">
                  {book.authors[0] ?? t('library.unknownAuthor')}
                </span>
                <span className="continue-progress">
                  <span className="progress-track">
                    <span style={{ inlineSize: `${percent}%` }} />
                  </span>
                  <span className="progress-value">
                    {t('library.percent', { percent: percentFormat.format(percent) })}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
