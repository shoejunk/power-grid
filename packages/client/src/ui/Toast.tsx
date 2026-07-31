import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

import { useGameStore } from '../net/store';
import type { Toast as ToastModel } from '../net/types';
import { toastVariants } from '../styles/motion';
import { IconButton } from './IconButton';
import { IconCheck, IconClose, IconError, IconInfo, IconWarning } from './icons';

const ICONS = {
  info: IconInfo,
  success: IconCheck,
  warning: IconWarning,
  error: IconError,
} as const;

interface ToastCardProps {
  toast: ToastModel;
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
      className={`pg-toast pg-toast--${toast.tone}`}
      variants={toastVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="pg-toast__icon">
        <Icon />
      </span>
      <div className="pg-toast__body">
        <div className="pg-toast__title">{toast.title}</div>
        {toast.message !== undefined ? (
          <div className="pg-toast__message">{toast.message}</div>
        ) : null}
      </div>
      <IconButton
        className="pg-toast__close"
        label="Dismiss notification"
        size="sm"
        bare
        icon={<IconClose />}
        onClick={() => onDismiss(toast.id)}
      />
      {toast.duration > 0 ? (
        <motion.span
          className="pg-toast__timer"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: toast.duration / 1000, ease: 'linear' }}
        />
      ) : null}
    </motion.div>
  );
}

/**
 * Notification host.
 *
 * Reads the toast stack straight off the store and renders it into the fixed
 * top-right rail. Mounted once, at the app root — screens never render it.
 */
export function Toaster(): JSX.Element {
  const toasts = useGameStore((s) => s.toasts);
  const dismiss = useGameStore((s) => s.dismissToast);

  return (
    <div className="pg-toaster" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
