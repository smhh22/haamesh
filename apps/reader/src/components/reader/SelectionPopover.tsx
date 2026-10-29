import { useTranslation } from 'react-i18next';
import type { SelectionInfo } from './types';

export const HIGHLIGHT_COLORS = [
  { value: '#f2c94c', key: 'yellow' },
  { value: '#6fcf97', key: 'green' },
  { value: '#56ccf2', key: 'blue' },
  { value: '#eb5757', key: 'red' },
  { value: '#bb6bd9', key: 'purple' },
] as const;

interface SelectionPopoverProps {
  selection: SelectionInfo;
  noteMode: boolean;
  noteDraft: string;
  onHighlight: (color: string) => void;
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
  onHighlight,
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
        <button type="button" className="reader-action" onClick={onStartNote}>
          {t('reader.addNote')}
        </button>
      )}
    </div>
  );
};
