import { type RefObject, useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableIn = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );

/**
 * Moves focus into an open dialog, keeps Tab/Shift+Tab inside it, and restores
 * focus to the opener on close. Escape stays with the dialog component.
 */
export const useDialogFocus = (open: boolean, dialogRef: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog) {
      const [first] = focusableIn(dialog);
      (first ?? dialog).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = focusableIn(root);
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, dialogRef]);
};
