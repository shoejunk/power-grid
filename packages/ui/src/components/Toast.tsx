import { motion } from 'framer-motion';
import { useEffect } from 'react';

import { toastVariants } from '../styles/motion';
import type { ToastView } from '../types';
import { IconButton } from './IconButton';
import { IconCheck, IconClose, IconError, IconInfo, IconWarning } from './icons';

const ICONS = {
  info: IconInfo,
  success: IconCheck,
  warning: IconWarning,
  error: IconError,
} as const;

interface ToastCardProps {
  toast: ToastView;
  onDismiss: (id: string) => void;
}

function ToastCard({ toast, onDismiss }: ToastCardProps): JSX.Element {
  const Icon = ICONS[toast.tone];

  /* Auto-dismiss. `duration: 0` means "sticky" — used for connection loss,
     which must stay up until it is actually resolved. */
  useEffect(() => {
    if (toast.duration <= 0) return undefined;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <motion.div
      layout
      className={`tt-toast tt-toast--${toast.tone}`}
      variants={toastVariants}
      initial="hidden"
      animate="visible"
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="tt-toast__icon">
        <Icon />
      </span>
      <div className="tt-toast__body">
        <div className="tt-toast__title">{toast.title}</div>
        {toast.message !== undefined ? (
          <div className="tt-toast__message">{toast.message}</div>
        ) : null}
      </div>
      <IconButton
        className="tt-toast__close"
        label="Dismiss notification"
        size="sm"
        bare
        icon={<IconClose />}
        onClick={() => onDismiss(toast.id)}
      />
      {toast.duration > 0 ? (
        <motion.span
          className="tt-toast__timer"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: toast.duration / 1000, ease: 'linear' }}
        />
      ) : null}
    </motion.div>
  );
}

export interface ToastStackProps {
  toasts: readonly ToastView[];
  onDismiss: (id: string) => void;
}

/**
 * Notification host. Renders the stack it is handed into the fixed top-right
 * rail; the app owns the stack itself and mounts this once, at the root.
 *
 * Deliberately NOT wrapped in `AnimatePresence`. The app caps the stack at
 * four, yet a bot-driven game was measured with **84** toast cards mounted and
 * overflowing the viewport: under React StrictMode's double-invoke
 * AnimatePresence never completes the exit, so dismissed toasts are never
 * unmounted and simply accumulate. The same wedge previously stranded route
 * transitions and made the Modal undismissable.
 *
 * Rendering the list directly makes the mounted count exactly the list count,
 * by construction. Toasts still animate in; only the exit is given up.
 */
export function ToastStack({ toasts, onDismiss }: ToastStackProps): JSX.Element {
  return (
    <div className="tt-toaster" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
