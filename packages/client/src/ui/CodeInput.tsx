import { motion } from 'framer-motion';
import { forwardRef, useId, useState } from 'react';

import { springSnappy } from '../styles/motion';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last cell is filled — lets the screen auto-submit. */
  onComplete?: (value: string) => void;
  length?: number;
  label?: string;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** Game codes are upper-case alphanumerics; everything else is dropped. */
const sanitise = (raw: string, length: number): string =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, length);

/**
 * Segmented game-code entry.
 *
 * A single real `<input>` is stretched transparently across the whole row of
 * cells. That is what makes paste, autofill, backspace, text selection, mobile
 * keyboards and screen readers all behave correctly — the cells are pure
 * decoration driven by the input's value, and each one springs as it fills.
 */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  {
    value,
    onChange,
    onComplete,
    length = 6,
    label = 'Game code',
    error,
    disabled = false,
    autoFocus = false,
    className,
  },
  ref,
) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const invalid = typeof error === 'string' && error.length > 0;
  const cells = Array.from({ length }, (_, i) => value[i] ?? '');
  const caretIndex = Math.min(value.length, length - 1);

  return (
    <div className={['pg-field', className ?? ''].filter(Boolean).join(' ')}>
      <label className="pg-field__label" htmlFor={id}>
        {label}
      </label>

      <div className="pg-code__wrap">
        <div className="pg-code" data-invalid={invalid} aria-hidden="true">
          {cells.map((char, index) => {
            const isCaret = focused && !disabled && index === caretIndex && value.length < length;
            return (
              <motion.div
                key={index}
                className="pg-code__cell"
                data-filled={char !== ''}
                data-focused={focused && (index === caretIndex || (value.length === length && index === length - 1))}
                animate={char !== '' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={springSnappy}
              >
                {char}
                {isCaret ? <span className="pg-code__caret" /> : null}
              </motion.div>
            );
          })}
        </div>

        <input
          id={id}
          ref={ref}
          className="pg-code__input"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={length}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const next = sanitise(event.target.value, length);
            onChange(next);
            if (next.length === length) onComplete?.(next);
          }}
        />
      </div>

      {invalid ? (
        <span className="pg-field__error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});
