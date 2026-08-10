import { useMotionValueEvent, useReducedMotion, useSpring } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

export type MoneySize = 'sm' | 'md' | 'lg';
export type MoneyTone = 'default' | 'muted' | 'gain' | 'loss';

export interface MoneyProps {
  /** The Elektro amount. */
  value: number;
  size?: MoneySize;
  tone?: MoneyTone;
  /** Show the "₤" unit mark after the number. */
  unit?: boolean;
  /** Always render a leading + or − (for deltas rather than balances). */
  signed?: boolean;
  /** Skip the count-up and print the value directly. */
  instant?: boolean;
  /** Accessible label prefix, e.g. "Your balance". */
  label?: string;
  className?: string;
}

/**
 * Elektro readout with an animated count-up.
 *
 * The number is driven by a framer-motion spring, so a payout of 54₤ rolls up
 * with the same physics as everything else in the UI instead of snapping. The
 * glyphs are tabular (Oswald + `font-variant-numeric: tabular-nums`), so the
 * element's width never changes mid-animation — no layout shift, no jitter.
 *
 * The visible digits are `aria-hidden` while animating; the true value is
 * exposed in a sibling for assistive tech so a screen reader is not spammed
 * with sixty intermediate numbers.
 */
export function Money({
  value,
  size = 'md',
  tone = 'default',
  unit = true,
  signed = false,
  instant = false,
  label,
  className,
}: MoneyProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const skipAnimation = instant || reduceMotion === true;

  const spring = useSpring(value, { stiffness: 190, damping: 26, mass: 0.6 });
  const [display, setDisplay] = useState(value);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (skipAnimation || isFirstRender.current) {
      isFirstRender.current = false;
      spring.jump(value);
      setDisplay(value);
      return;
    }
    spring.set(value);
  }, [value, skipAnimation, spring]);

  useMotionValueEvent(spring, 'change', (latest) => {
    setDisplay(Math.round(latest));
  });

  const magnitude = Math.abs(display);
  const sign = signed ? (display > 0 ? '+' : display < 0 ? '−' : '') : display < 0 ? '−' : '';

  const classes = [
    'pg-money',
    `pg-money--${size}`,
    tone !== 'default' ? `pg-money--${tone}` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      <span className="pg-money__digits" aria-hidden="true">
        {sign}
        {magnitude.toLocaleString('en-US')}
      </span>
      {unit ? (
        <span className="tt-money__unit" aria-hidden="true">
          ₤
        </span>
      ) : null}
      <span className="tt-sr-only">
        {label ? `${label}: ` : ''}
        {value} Elektro
      </span>
    </span>
  );
}
