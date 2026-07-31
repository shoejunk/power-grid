import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import { DUR, springHeavy } from '../styles/motion';
import { IconButton } from './IconButton';
import { IconClose } from './icons';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Supporting line under the title; also wired to `aria-describedby`. */
  description?: ReactNode;
  /** Footer action row. Rendered right-aligned. */
  footer?: ReactNode;
  /** CSS width for the dialog. Defaults to 560px. */
  width?: string;
  /** Set false to require an explicit footer action (no scrim / Escape close). */
  dismissible?: boolean;
  children?: ReactNode;
}

/** Elements that can receive focus inside the dialog, for the focus trap. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog.
 *
 * · Portalled to `document.body` so it escapes any transformed ancestor.
 * · Backdrop blur + spring entrance (scale 0.94 → 1 with a heavy spring).
 * · Full focus management: focus moves in on open, is trapped with Tab/Shift+
 *   Tab, and returns to the invoking element on close.
 * · Escape closes; the scrim closes; body scroll is locked while open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  width = '560px',
  dismissible = true,
  children,
}: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  /* Remember what had focus, move focus into the dialog, restore on unmount. */
  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const raf = requestAnimationFrame(() => {
      const node = dialogRef.current;
      if (!node) return;
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  /* Escape to close + Tab focus trap. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const node = dialogRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [dismissible, onClose],
  );

  /* Lock background scroll while a dialog is up. */
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="pg-modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.base }}
          onMouseDown={(event) => {
            if (dismissible && event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={dialogRef}
            className="pg-modal"
            style={{ ['--pg-modal-width' as string]: width } as React.CSSProperties}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, scale: 0.94, y: 22 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12, transition: { duration: DUR.fast } }}
            transition={springHeavy}
          >
            <header className="pg-modal__header">
              <div className="pg-modal__titles">
                <h2 className="pg-modal__title" id={titleId}>
                  {title}
                </h2>
                {description !== undefined ? (
                  <p className="pg-modal__desc" id={descId}>
                    {description}
                  </p>
                ) : null}
              </div>
              {dismissible ? (
                <IconButton
                  label="Close dialog"
                  bare
                  size="sm"
                  icon={<IconClose />}
                  onClick={onClose}
                />
              ) : null}
            </header>

            <div className="pg-modal__body">{children}</div>

            {footer !== undefined ? (
              <footer className="pg-modal__footer">{footer}</footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
