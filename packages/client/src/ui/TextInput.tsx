import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

import { IconWarning } from './icons';

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> {
  label?: ReactNode;
  /** Helper copy shown under the field while it is valid. */
  hint?: ReactNode;
  /** Error message. Presence switches the field into its invalid state. */
  error?: string | null;
  /** Leading icon inside the well. */
  icon?: ReactNode;
  /** Show a live `n / maxLength` counter. Requires `maxLength`. */
  showCount?: boolean;
  className?: string;
}

/**
 * Single-line text field.
 *
 * The visible chrome is the wrapper (an inset "well"); the `<input>` itself is
 * fully transparent, which is how we guarantee no browser-default styling
 * survives. Validation state is announced with `aria-invalid` +
 * `aria-describedby`, and the error region is a polite live region so a
 * server-side rejection is read out without stealing focus.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, icon, showCount = false, className, disabled, value, maxLength, ...rest },
  ref,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = typeof error === 'string' && error.length > 0;
  const length = typeof value === 'string' ? value.length : 0;

  return (
    <div className={['pg-field', className ?? ''].filter(Boolean).join(' ')}>
      {label !== undefined ? (
        <label className="pg-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}

      <div className="pg-input" data-invalid={invalid} data-disabled={disabled === true}>
        {icon !== undefined ? <span className="pg-input__adorn">{icon}</span> : null}
        <input
          {...rest}
          id={id}
          ref={ref}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : hint !== undefined ? hintId : undefined}
        />
        {showCount && maxLength !== undefined ? (
          <span className="pg-input__count">
            {length}/{maxLength}
          </span>
        ) : null}
      </div>

      {invalid ? (
        <span className="pg-field__error" id={errorId} role="alert">
          <IconWarning width={13} height={13} />
          {error}
        </span>
      ) : hint !== undefined ? (
        <span className="pg-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
});
