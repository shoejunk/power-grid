import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Filled rather than tinted — for the single most important state in a row. */
  solid?: boolean;
  /** Prefix the label with a glowing status dot. */
  dot?: boolean;
  size?: 'sm' | 'lg';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Compact status label. Deliberately small and high-contrast: badges carry
 * game state (READY, HOST, BOT, STEP 2) at a glance without stealing weight
 * from the surrounding content.
 */
export function Badge({
  tone = 'neutral',
  solid = false,
  dot = false,
  size = 'sm',
  icon,
  children,
  className,
  title,
}: BadgeProps): JSX.Element {
  const classes = [
    'tt-badge',
    tone !== 'neutral' ? `tt-badge--${tone}` : '',
    solid ? 'tt-badge--solid' : '',
    dot ? 'tt-badge--dot' : '',
    size === 'lg' ? 'tt-badge--lg' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} title={title}>
      {icon}
      {children}
    </span>
  );
}
