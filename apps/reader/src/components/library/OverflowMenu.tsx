import { type ReactNode, useEffect, useRef, useState } from 'react';

interface OverflowMenuProps {
  /** Accessible name for the trigger and the menu itself. */
  label: string;
  disabled?: boolean;
  className?: string;
  /** Rendered inside the menu; call `close` after an action. */
  children: (close: () => void) => ReactNode;
}

/**
 * Small accessible popover menu shared by rows and category headers. The
 * trigger stays a real button with aria-haspopup/aria-expanded; Escape closes
 * and returns focus; an outside click closes without stealing focus.
 */
export const OverflowMenu = ({ label, disabled, className, children }: OverflowMenuProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={className ? `book-menu-wrap ${className}` : 'book-menu-wrap'} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button book-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open ? (
        <div className="book-menu" role="menu" aria-label={label}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
};
