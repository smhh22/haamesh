import { useLayoutEffect, useRef, useState } from 'react';
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
  providerLabel?: string;
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
  const nodeRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: selection.x, y: selection.y });
  // The transform already applied, needed to recover the untransformed origin:
  // CSS may position the popover with insets (full-width sheet on phones).
  const appliedRef = useRef({ x: selection.x, y: selection.y });

  // The anchor is the selection's bottom + 8px, which is right for the action
  // row but lets a translation result run off a phone screen. Measure the
  // rendered popover: keep it below when it fits, otherwise flip it above the
  // selection; clamp both axes so padding/border never push it off-screen.
  // Very tall content still scrolls (max-block-size in CSS).
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const place = () => {
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const rect = node.getBoundingClientRect();
      const baseLeft = rect.left - appliedRef.current.x;
      const baseTop = rect.top - appliedRef.current.y;
      const desiredLeft = Math.max(8, Math.min(selection.x, window.innerWidth - width - 8));
      const maxTop = window.innerHeight - height - 8;
      const desiredTop =
        selection.y <= maxTop ? Math.max(8, selection.y) : selection.y - 16 - height;
      const next = {
        x: desiredLeft - baseLeft,
        y: Math.max(8, Math.min(desiredTop, maxTop)) - baseTop,
      };
      appliedRef.current = next;
      setOffset(next);
    };
    place();
    window.addEventListener('resize', place);
    // Content changes (translation result, note draft) change the height
    // without changing the anchor; re-place whenever the box resizes.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [selection.x, selection.y]);

  return (
    <div
      ref={nodeRef}
      className="selection-popover"
      role="dialog"
      aria-label={t('reader.selection')}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
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
                    {translation.providerLabel ? (
                      <span className="hint" dir="ltr">
                        {translation.providerLabel}
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
