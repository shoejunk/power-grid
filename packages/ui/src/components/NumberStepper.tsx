import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { springSnappy } from '../styles/motion';
import { IconMinus, IconPlus } from './icons';

export interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Accessible name — there is no visible label inside the control. */
  label: string;
  /** Small suffix shown after the number, e.g. "₤" or "cities". */
  unit?: ReactNode;
  disabled?: boolean;
  block?: boolean;
  className?: string;
}

/**
 * Increment / decrement control for small integer values (bids, counts,
 * player seats).
 *
 * The value slides vertically in the direction of travel on every change, so a
 * bid ticking up reads as a mechanical counter. Exposes `role="spinbutton"`
 * with the aria-value* triple and handles Up/Down/PageUp/PageDown/Home/End.
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  label,
  unit,
  disabled = false,
  block = false,
  className,
}: NumberStepperProps): JSX.Element {
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  const set = (n: number): void => {
    const next = clamp(n);
    if (next !== value) onChange(next);
  };

  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;

  return (
    <div
      className={['tt-stepper', block ? 'tt-stepper--block' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      data-disabled={disabled}
    >
      <button
        type="button"
        className="tt-stepper__btn"
        aria-label={`Decrease ${label}`}
        disabled={!canDec}
        onClick={() => set(value - step)}
      >
        <IconMinus />
      </button>

      <div
        className="tt-stepper__value"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onKeyDown={(event) => {
          switch (event.key) {
            case 'ArrowUp':
              event.preventDefault();
              set(value + step);
              break;
            case 'ArrowDown':
              event.preventDefault();
              set(value - step);
              break;
            case 'PageUp':
              event.preventDefault();
              set(value + step * 5);
              break;
            case 'PageDown':
              event.preventDefault();
              set(value - step * 5);
              break;
            case 'Home':
              event.preventDefault();
              set(min);
              break;
            case 'End':
              event.preventDefault();
              if (max !== Number.MAX_SAFE_INTEGER) set(max);
              break;
            default:
              break;
          }
        }}
      >
        {/* mode="popLayout" keeps the outgoing digit from pushing layout. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
            transition={springSnappy}
          >
            {value}
          </motion.span>
        </AnimatePresence>
        {unit !== undefined ? <span className="tt-stepper__unit">{unit}</span> : null}
      </div>

      <button
        type="button"
        className="tt-stepper__btn"
        aria-label={`Increase ${label}`}
        disabled={!canInc}
        onClick={() => set(value + step)}
      >
        <IconPlus />
      </button>
    </div>
  );
}
