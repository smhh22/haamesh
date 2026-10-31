import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/**
 * Single-field prompt for small edits such as renaming a category. Enter
 * submits, Escape cancels, and the field is focused when the dialog opens.
 *
 * The body mounts only while open, so its value is initialized once from
 * initialValue. Resetting it from an effect raced with fast input: text typed
 * between the initial select-all and the effect appended to the old value.
 */
export const PromptDialog = ({ open, ...props }: PromptDialogProps) => {
  if (!open) return null;
  return <PromptDialogContent {...props} />;
};

type PromptDialogContentProps = Omit<PromptDialogProps, 'open'>;

const PromptDialogContent = ({
  title,
  label,
  initialValue,
  confirmLabel,
  onConfirm,
  onClose,
}: PromptDialogContentProps) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useDialogFocus(true, dialogRef);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    const onPointerDown = (event: PointerEvent) => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(event.target as Node)) onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  };

  return (
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="panel-header">
          <h2>{title}</h2>
        </div>
        <form
          className="confirm-body"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="prompt-label" htmlFor="prompt-value">
            {label}
          </label>
          <input
            ref={inputRef}
            id="prompt-value"
            className="text-input"
            type="text"
            value={value}
            dir="auto"
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="confirm-actions">
            <button type="button" className="reader-action" onClick={onClose}>
              {t('reader.cancel')}
            </button>
            <button
              type="submit"
              className="reader-action is-primary"
              disabled={value.trim().length === 0}
            >
              {confirmLabel ?? t('reader.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
