import { motion } from 'framer-motion';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { springSnappy } from '../styles/motion';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Explanatory line under the label — used heavily for rule variants. */
  description?: ReactNode;
  /**
   * Slot rendered after the label text, typically a `<Hint />` carrying the
   * rulebook citation. It lives *outside* the switch button so we never nest
   * interactive elements.
   */
  adornment?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Switch.
 *
 * The knob travels on a spring and the track cross-fades to a lit cyan state,
 * so the "powered / not powered" metaphor stays consistent with the rest of
 * the UI. The whole label block is clickable, but only the button element is
 * focusable and it carries `role="switch"` so Space/Enter toggle it and
 * assistive tech announces on/off rather than "button".
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  adornment,
  disabled = false,
  className,
}: ToggleProps): JSX.Element {
  const labelId = useId();
  const descId = useId();

  return (
    <div
      className={['tt-toggle', className ?? ''].filter(Boolean).join(' ')}
      data-checked={checked}
      data-disabled={disabled}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description !== undefined ? descId : undefined}
        disabled={disabled}
        className="tt-toggle__switch"
        onClick={() => onChange(!checked)}
      >
        <span className="tt-toggle__track" aria-hidden="true">
          <motion.span
            className="tt-toggle__knob"
            animate={{ x: checked ? 22 : 0 }}
            transition={springSnappy}
          />
        </span>
      </button>

      <div className="tt-toggle__text">
        {/* Clicking the label proxies to the switch, matching native <label>. */}
        <span
          className="tt-toggle__label"
          id={labelId}
          onClick={() => {
            if (!disabled) onChange(!checked);
          }}
        >
          {label}
        </span>
        {adornment}
        {description !== undefined ? (
          <span className="tt-toggle__desc" id={descId}>
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
}
