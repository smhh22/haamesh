import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchResult } from './types';

interface SearchPanelProps {
  query: string;
  results: SearchResult[];
  searching: boolean;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  onGoTo: (cfi: string) => void;
  onClose: () => void;
}

export const SearchPanel = ({
  query,
  results,
  searching,
  onQueryChange,
  onSubmit,
  onGoTo,
  onClose,
}: SearchPanelProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Opening the panel is a request to search, so put the caret in the field.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <aside className="reader-panel search-panel" aria-label={t('reader.search')}>
      <div className="panel-header">
        <h2>{t('reader.search')}</h2>
        <button type="button" className="text-button" onClick={onClose}>
          {t('reader.close')}
        </button>
      </div>
      <form className="search-form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder={t('reader.searchPlaceholder')}
          aria-label={t('reader.searchPlaceholder')}
        />
        <button type="submit" className="reader-action">
          {t('reader.searchButton')}
        </button>
      </form>
      {searching ? (
        <p className="hint" role="status">
          {t('reader.searching')}
        </p>
      ) : null}
      {!searching && query && results.length === 0 ? (
        <p className="hint" role="status">
          {t('reader.noSearchResults')}
        </p>
      ) : null}
      <ul className="search-results">
        {results.map((result) => (
          <li key={result.cfi}>
            <button
              type="button"
              className="search-result"
              onClick={() => {
                onGoTo(result.cfi);
              }}
            >
              {result.label ? <span className="search-label">{result.label}</span> : null}
              <span>
                {result.pre}
                <mark>{result.match}</mark>
                {result.post}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};
