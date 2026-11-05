import { useTranslation } from 'react-i18next';
import type { SelectionInfo } from './types';

export const HIGHLIGHT_COLORS = [
  { value: '#f2c94c', key: 'yellow' },
  { value: '#6fcf97', key: 'green' },
  { value: '#56ccf2', key: 'blue' },
  { value: '#eb5757', key: 'red' },
  { value: '#bb6bd9', key: 'purple' },
] as const;

export interface SelectionTranslationState {
  status: 'loading' | 'done' | 'error';
  text?: string;
  providerId?: string;
  errorCode?: string;
}

interface SelectionPopoverProps {
  selection: SelectionInfo;
  noteMode: boolean;
  noteDraft: string;
  translation: SelectionTranslationState | null;
  onHighlight: (color: string) => void;
  onTranslate: () => void;
  onCopyTranslation: (text: string) => void;
  onStartNote: () => void;
  onSaveNote: () => void;
  onCancelNote: () => void;
  onDraftChange: (draft: string) => void;
  onDismiss: () => void;
}

export const SelectionPopover = ({
  selection,
  noteMode,
  noteDraft,
  translation,
  onHighlight,
  onTranslate,
  onCopyTranslation,
  onStartNote,
  onSaveNote,
  onCancelNote,
  onDraftChange,
  onDismiss,
}: SelectionPopoverProps) => {
  const { t } = useTranslation();
  return (
    <div
      className="selection-popover"
      role="dialog"
      aria-label={t('reader.selection')}
      style={{ transform: `translate(${selection.x}px, ${selection.y}px)` }}
    >
      <div className="highlight-colors">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.key}
            type="button"
            className="color-swatch"
            style={{ background: color.value }}
            aria-label={t(`reader.colors.${color.key}`)}
            onClick={() => onHighlight(color.value)}
          />
        ))}
        <button
          type="button"
          className="text-button"
          onClick={onDismiss}
          aria-label={t('reader.dismiss')}
        >
          ×
        </button>
      </div>
      {noteMode ? (
        <div className="note-draft">
          <textarea
            value={noteDraft}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            placeholder={t('reader.notePlaceholder')}
            aria-label={t('reader.notePlaceholder')}
          />
          <div className="note-actions">
            <button type="button" className="reader-action" onClick={onSaveNote}>
              {t('reader.saveNote')}
            </button>
            <button type="button" className="reader-action" onClick={onCancelNote}>
              {t('reader.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="selection-actions">
            <button type="button" className="reader-action" onClick={onStartNote}>
              {t('reader.addNote')}
            </button>
            <button
              type="button"
              className="reader-action"
              onClick={onTranslate}
              disabled={translation?.status === 'loading'}
            >
              {t('reader.translate')}
            </button>
          </div>
          {translation ? (
            <div className="selection-translation" role="status" dir="auto">
              {translation.status === 'loading' ? (
                <p className="hint">{t('reader.translating')}</p>
              ) : translation.status === 'error' ? (
                <p className="error">
                  {t(`ai.errors.${translation.errorCode ?? 'PROVIDER_ERROR'}`)}
                </p>
              ) : (
                <>
                  <p className="selection-translation-text">{translation.text}</p>
                  <div className="selection-translation-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onCopyTranslation(translation.text ?? '')}
                    >
                      {t('reader.copy')}
                    </button>
                    {translation.providerId ? (
                      <span className="hint" dir="ltr">
                        {translation.providerId}
                      </span>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};
