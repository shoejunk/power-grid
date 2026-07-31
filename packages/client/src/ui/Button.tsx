import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { springSnappy } from '../styles/motion';
import { LoadingSpinner } from './LoadingSpinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Native button props minus the handlers framer-motion redefines with its own
 * (incompatible) signatures. Keeping this explicit means consumers still get
 * full DOM typing for everything else — `type`, `form`, `aria-*`, data attrs.
 */
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onAnimationStart' | 'onAnimationEnd' | 'onDragStart' | 'onDrag' | 'onDragEnd' | 'ref'
>;

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the width of the parent. */
  block?: boolean;
  /** Leading icon slot; hidden while `loading`. */
  icon?: ReactNode;
  /** Trailing icon slot; hidden while `loading`. */
  iconAfter?: ReactNode;
  /** Swaps the label for a spinner and blocks interaction. */
  loading?: boolean;
  children?: ReactNode;
}

/**
 * The primary action primitive.
 *
 * Press physics: a spring-driven scale-down on tap plus a 1px lift on hover.
 * Both are driven by framer-motion rather than CSS so the release overshoots
 * slightly — that overshoot is what makes the button feel mechanical rather
 * than like a web page.
 *
 * Accessibility: real `<button>`, real `disabled`, `aria-busy` while loading,
 * and the design-system focus ring via `:focus-visible` (never suppressed).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block = false,
    icon,
    iconAfter,
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;

  const classes = [
    'pg-btn',
    `pg-btn--${variant}`,
    size !== 'md' ? `pg-btn--${size}` : '',
    block ? 'pg-btn--block' : '',
    loading ? 'pg-btn--loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      whileHover={isDisabled ? undefined : { y: -1.5 }}
      whileTap={isDisabled ? undefined : { scale: 0.965, y: 0 }}
      transition={springSnappy}
    >
      {icon ? <span className="pg-btn__icon">{icon}</span> : null}
      {children ? <span className="pg-btn__label">{children}</span> : null}
      {iconAfter ? <span className="pg-btn__icon">{iconAfter}</span> : null}
      {loading ? (
        <span className="pg-btn__spinner">
          <LoadingSpinner size="sm" ink />
        </span>
      ) : null}
    </motion.button>
  );
});
