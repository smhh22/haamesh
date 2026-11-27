import type { BookGroupRecord } from '@hamesh/storage';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import type { GroupDeleteMode } from '../../library/groups';

interface GroupDeleteDialogProps {
  open: boolean;
  group: BookGroupRecord | null;
  onConfirm: (mode: GroupDeleteMode) => void;
  onClose: () => void;
}

/**
 * Three-way delete choice (ADR-0027). The options differ in what happens to
 * files, so this is a radio list rather than a yes/no confirm; the default is
 * the least destructive one.
 */
export const GroupDeleteDialog = ({ open, group, onConfirm, onClose }: GroupDeleteDialogProps) => {
  if (!open || !group) return null;
  return <GroupDeleteContent group={group} onConfirm={onConfirm} onClose={onClose} />;
};

const modes: GroupDeleteMode[] = ['only-group', 'keep-books', 'with-contents'];

const GroupDeleteContent = ({
  group,
  onConfirm,
  onClose,
}: Omit<GroupDeleteDialogProps, 'open' | 'group'> & { group: BookGroupRecord }) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<GroupDeleteMode>('only-group');
  useDialogFocus(true, dialogRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  const titleKey: Record<GroupDeleteMode, string> = {
    'with-contents': 'library.groupDeleteWithContents',
    'keep-books': 'library.groupDeleteKeepBooks',
    'only-group': 'library.groupDeleteOnlyGroup',
  };
  const hintKey: Record<GroupDeleteMode, string> = {
    'with-contents': 'library.groupDeleteWithContentsHint',
    'keep-books': 'library.groupDeleteKeepBooksHint',
    'only-group': 'library.groupDeleteOnlyGroupHint',
  };

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog confirm-dialog group-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('library.groupDeleteTitle')}
      >
        <div className="panel-header">
          <h2>{t('library.groupDeleteTitle')}</h2>
        </div>
        <div className="confirm-body">
          <p className="group-delete-body">{t('library.groupDeleteBody', { name: group.name })}</p>
          <fieldset className="group-delete-options">
            <legend className="visually-hidden">{t('library.groupDeleteLegend')}</legend>
            {modes.map((value) => (
              <label
                key={value}
                className={`group-delete-option${mode === value ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="group-delete-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span className="group-delete-option-text">
                  <span className="group-delete-option-title" dir="auto">
                    {t(titleKey[value])}
                  </span>
                  <span className="group-delete-option-hint">{t(hintKey[value])}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="confirm-actions">
            <button type="button" className="reader-action" onClick={onClose}>
              {t('reader.cancel')}
            </button>
            <button
              type="button"
              className="reader-action is-danger"
              onClick={() => {
                onConfirm(mode);
                onClose();
              }}
            >
              {t('library.groupDeleteConfirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
