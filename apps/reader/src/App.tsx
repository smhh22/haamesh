import type { Direction } from '@hamesh/core';
import { ImportError, type ImportErrorCode } from '@hamesh/engine';
import type { BookRecord, ReadingState } from '@hamesh/storage';
import { DirectionProvider } from '@hamesh/ui';
import { type ChangeEvent, type DragEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReaderView } from './components/ReaderView';
import { forgetBookFile, getBookFile } from './services/bookFiles';
import { importBookFile } from './services/importBook';
import { deletePersistedBook, persistBook, schedulePersist } from './services/libraryPersistence';
import { useLibraryStore } from './stores/libraryStore';
import { useReadingStore } from './stores/readingStore';

const LOCALES = ['en', 'fa'] as const;
type Locale = (typeof LOCALES)[number];

const directionFor = (locale: Locale): Direction => (locale === 'fa' ? 'rtl' : 'ltr');

const isEpub = (file: File): boolean =>
  file.type === 'application/epub+zip' || file.name.toLowerCase().endsWith('.epub');

const formatAuthors = (authors: string[], locale: Locale): string => {
  if (authors.length === 0) return '';
  try {
    return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(authors);
  } catch {
    return authors.join(locale === 'fa' ? '، ' : ', ');
  }
};

export const App = () => {
  const { t, i18n } = useTranslation();
  const [locale, setLocale] = useState<Locale>('en');
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorCode, setErrorCode] = useState<ImportErrorCode | 'UNKNOWN' | null>(null);
  const [readerSession, setReaderSession] = useState<{
    book: BookRecord;
    start: ReadingState | null;
  } | null>(null);
  const books = useLibraryStore((state) => state.books);
  const addBook = useLibraryStore((state) => state.addBook);
  const removeBook = useLibraryStore((state) => state.removeBook);
  const saveReadingState = useReadingStore((state) => state.save);
  const removeReadingState = useReadingStore((state) => state.remove);
  const direction = directionFor(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    void i18n.changeLanguage(locale);
  }, [direction, i18n, locale]);

  const toggleLocale = () => {
    setLocale((current) => (current === 'en' ? 'fa' : 'en'));
  };

  const handleFiles = async (fileList: FileList | File[] | null): Promise<void> => {
    if (!fileList) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsImporting(true);
    setErrorCode(null);
    try {
      for (const file of files) {
        if (!isEpub(file)) {
          setErrorCode('UNSUPPORTED_FORMAT');
          continue;
        }
        try {
          const imported = await importBookFile(file);
          addBook(imported.record);
          await persistBook(imported.record, imported.file, imported.cover);
        } catch (error) {
          setErrorCode(error instanceof ImportError ? error.code : 'UNKNOWN');
        }
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const removeBookAndFile = (book: BookRecord) => {
    if (book.coverPath?.startsWith('blob:')) {
      URL.revokeObjectURL(book.coverPath);
    }
    forgetBookFile(book.hash);
    removeReadingState(book.id);
    removeBook(book.id);
    void deletePersistedBook(book);
  };

  const openReader = (book: BookRecord) => {
    if (!getBookFile(book.hash)) {
      setErrorCode('UNKNOWN');
      return;
    }
    setReaderSession({
      book,
      start: useReadingStore.getState().states[book.id] ?? null,
    });
  };

  const openFile = readerSession ? getBookFile(readerSession.book.hash) : null;
  if (readerSession && openFile) {
    const start = readerSession.start;
    return (
      <DirectionProvider dir={direction}>
        <ReaderView
          key={readerSession.book.id}
          book={readerSession.book}
          file={openFile}
          initialLocation={start?.locator?.kind === 'cfi' ? start.locator.cfi : null}
          initialFraction={start?.fraction ?? 0}
          onProgress={({ locator, fraction }) => {
            saveReadingState({
              bookId: readerSession.book.id,
              locator,
              fraction,
              status: 'reading',
              updatedAt: Date.now(),
            });
            schedulePersist();
          }}
          onClose={() => setReaderSession(null)}
        />
      </DirectionProvider>
    );
  }

  return (
    <DirectionProvider dir={direction}>
      <main className="shell">
        <header className="masthead">
          <div>
            <p className="eyebrow">{t('app.eyebrow')}</p>
            <h1>{t('app.title')}</h1>
            <p className="lede">{t('app.lede')}</p>
          </div>
          <button type="button" className="locale-toggle" onClick={toggleLocale}>
            {t('app.switch')}
          </button>
        </header>

        <section
          className={isDragging ? 'library is-dragging' : 'library'}
          aria-labelledby="library-heading"
          aria-busy={isImporting}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="library-header">
            <h2 id="library-heading">{t('library.heading')}</h2>
            <label className="import-button">
              {t('library.import')}
              <input
                className="visually-hidden"
                type="file"
                accept=".epub,application/epub+zip"
                multiple
                disabled={isImporting}
                onChange={handleInputChange}
              />
            </label>
          </div>

          {isImporting ? (
            <p className="hint" role="status">
              {t('library.importing')}
            </p>
          ) : null}
          {errorCode ? (
            <p className="error" role="alert">
              {t(`library.errors.${errorCode}`)}
            </p>
          ) : null}

          {books.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t('library.empty')}</p>
              <p className="hint">{t('library.drop')}</p>
            </div>
          ) : (
            <ul className="book-grid">
              {books.map((book) => (
                <li key={book.id} className="book-card">
                  <div className="cover">
                    {book.coverPath ? (
                      <img src={book.coverPath} alt="" />
                    ) : (
                      <span className="cover-fallback" aria-hidden="true">
                        {book.title.trim().charAt(0) || '?'}
                      </span>
                    )}
                  </div>
                  <div className="book-body">
                    <h3 dir="auto">{book.title}</h3>
                    <p className="authors" dir="auto">
                      {formatAuthors(book.authors, locale) || t('library.unknownAuthor')}
                    </p>
                    <p className="badges">
                      <span className="badge">
                        {book.direction === 'rtl' ? t('library.rtl') : t('library.ltr')}
                      </span>
                      <span className="badge">{book.language ?? t('library.unknownLanguage')}</span>
                    </p>
                    <div className="book-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => openReader(book)}
                      >
                        {t('library.read')}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => removeBookAndFile(book)}
                      >
                        {t('library.remove')}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="hint" dir="auto">
          {t('library.bidiSample')}
        </p>
      </main>
    </DirectionProvider>
  );
};
