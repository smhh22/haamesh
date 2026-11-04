import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { UrlSyncMode } from '../services/importBook';

interface UrlImportDialogProps {
  open: boolean;
  onImport: (url: string, syncVia: UrlSyncMode) => void;
  onClose: () => void;
}

/**
 * Add a book from a link. The sync question (ADR-0019) is asked here: carry
 * the file through the user's storage, or only the link, with other devices
 * downloading from the source.
 */
export const UrlImportDialog = ({ open, onImport, onClose }: UrlImportDialogProps) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [syncVia, setSyncVia] = useState<UrlSyncMode>('blob');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useDialogFocus(true, dialogRef);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  const trimmed = url.trim();
  const valid = /^https?:\/\/\S+$/.test(trimmed);

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('library.addFromUrl')}
      >
        <div className="panel-header">
          <h2>{t('library.addFromUrl')}</h2>
        </div>
        <form
          className="confirm-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            onImport(trimmed, syncVia);
          }}
        >
          <label className="prompt-label" htmlFor="url-import-value">
            {t('library.bookUrl')}
          </label>
          <input
            ref={inputRef}
            id="url-import-value"
            className="text-input"
            type="url"
            value={url}
            dir="ltr"
            placeholder="https://…"
            onChange={(event) => setUrl(event.target.value)}
          />
          <fieldset className="url-sync-choice">
            <legend>{t('library.urlSyncQuestion')}</legend>
            <label className="url-sync-option">
              <input
                type="radio"
                name="url-sync-mode"
                checked={syncVia === 'blob'}
                onChange={() => setSyncVia('blob')}
              />
              <span>{t('library.urlSyncFile')}</span>
            </label>
            <label className="url-sync-option">
              <input
                type="radio"
                name="url-sync-mode"
                checked={syncVia === 'url'}
                onChange={() => setSyncVia('url')}
              />
              <span>{t('library.urlSyncLink')}</span>
            </label>
            <p className="hint">{t('library.urlSyncHint')}</p>
          </fieldset>
          <div className="confirm-actions">
            <button type="button" className="reader-action" onClick={onClose}>
              {t('reader.cancel')}
            </button>
            <button type="submit" className="reader-action is-primary" disabled={!valid}>
              {t('library.import')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
