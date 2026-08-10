import { motion } from 'framer-motion';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { springSnappy } from '../styles/motion';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: ReactNode;
  /** Rendered next to the numeric readout, e.g. "players". */
  unit?: ReactNode;
  /** Draw every integer stop under the track. */
  showTicks?: boolean;
  /** Map a raw value to display text (e.g. "2 players"). */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

/**
 * Range control.
 *
 * A native `<input type="range">` provides the semantics, keyboard model and
 * pointer handling; it is then made fully transparent and layered over the
 * custom track so nothing about it looks like a browser widget. The fill and
 * thumb are spring-animated, so dragging feels weighted and keyboard stepping
 * animates rather than jumping.
 */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  unit,
  showTicks = false,
  format,
  disabled = false,
  className,
}: SliderProps): JSX.Element {
  const id = useId();
  const span = max - min || 1;
  const pct = ((value - min) / span) * 100;

  const ticks: number[] = [];
  if (showTicks) {
    for (let v = min; v <= max; v += step) ticks.push(v);
  }

  return (
    <div className={['tt-slider', className ?? ''].filter(Boolean).join(' ')}>
      <div className="tt-slider__head">
        <label className="tt-field__label" htmlFor={id}>
          {label}
        </label>
        <span className="tt-slider__value">
          {format ? format(value) : value}
          {unit !== undefined ? <span className="tt-money__unit"> {unit}</span> : null}
        </span>
      </div>

      <div className="tt-slider__track">
        <motion.div
          className="tt-slider__fill"
          animate={{ width: `${pct}%` }}
          transition={springSnappy}
        />
        <motion.div
          className="tt-slider__thumb"
          animate={{ left: `${pct}%` }}
          transition={springSnappy}
        />
        <input
          id={id}
          className="tt-slider__input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>

      {showTicks ? (
        <div className="tt-slider__ticks" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
