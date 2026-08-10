import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { springSnappy } from '../styles/motion';

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onAnimationStart' | 'onAnimationEnd' | 'onDragStart' | 'onDrag' | 'onDragEnd' | 'ref'
>;

export interface IconButtonProps extends NativeButtonProps {
  /** Required — icon-only controls have no visible text. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Drops the plate treatment; the button only materialises on hover. */
  bare?: boolean;
  /** Hover/focus glows red instead of cyan. */
  danger?: boolean;
}

/**
 * A square, icon-only control.
 *
 * `label` is mandatory and becomes both `aria-label` and the `title`, so the
 * control is never a mystery glyph for screen readers or new players.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, icon, size = 'md', bare = false, danger = false, className, type = 'button', disabled, ...rest },
    ref,
  ) {
    const classes = [
      'tt-iconbtn',
      size !== 'md' ? `tt-iconbtn--${size}` : '',
      bare ? 'tt-iconbtn--bare' : '',
      danger ? 'tt-iconbtn--danger' : '',
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
        disabled={disabled}
        aria-label={label}
        title={label}
        whileHover={disabled ? undefined : { y: -1.5 }}
        whileTap={disabled ? undefined : { scale: 0.9, y: 0 }}
        transition={springSnappy}
      >
        {icon}
      </motion.button>
    );
  },
);
