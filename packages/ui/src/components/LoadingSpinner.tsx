import type { CSSProperties } from 'react';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Use `currentColor` instead of the cyan accent — for use inside filled buttons. */
  ink?: boolean;
  /** Optional caption rendered under the spinner (implies the block layout). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Indeterminate progress. A single ring with one lit arc, eased rather than
 * linear so it reads as a mechanism spinning up rather than a CSS loop.
 *
 * When `label` is supplied it renders the full block form, which is also the
 * live region announcing "loading" to assistive tech.
 */
export function LoadingSpinner({
  size = 'md',
  ink = false,
  label,
  className,
  style,
}: LoadingSpinnerProps): JSX.Element {
  const ring = (
    <span
      className={[
        'tt-spinner',
        size !== 'md' ? `tt-spinner--${size}` : '',
        ink ? 'tt-spinner--ink' : '',
        label ? '' : (className ?? ''),
      ]
        .filter(Boolean)
        .join(' ')}
      style={label ? undefined : style}
    />
  );

  if (!label) {
    return (
      <>
        {ring}
        <span className="tt-sr-only" role="status">
          Loading
        </span>
      </>
    );
  }

  return (
    <div
      className={['tt-loading', className ?? ''].filter(Boolean).join(' ')}
      style={style}
      role="status"
      aria-live="polite"
    >
      {ring}
      <span className="tt-loading__label">{label}</span>
    </div>
  );
}
