import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { DUR, springSnappy } from '../styles/motion';
import { IconCheck, IconChevronDown } from './icons';

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Secondary line inside the option row. */
  detail?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  label?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Custom listbox.
 *
 * A native `<select>` cannot be styled to the standard this project needs (the
 * popup is OS-drawn), so this is a from-scratch combobox implementing the
 * WAI-ARIA listbox pattern: `aria-expanded` / `aria-activedescendant` on the
 * trigger, arrow-key navigation with wrap-around, Home/End, Escape to close,
 * Enter/Space to commit, and click-outside dismissal.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select…',
  disabled = false,
  className,
}: SelectProps<T>): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled === true) return;
      onChange(option.value);
      close(true);
    },
    [close, onChange, options],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      const count = options.length;
      if (count === 0) return;
      let next = activeIndex;
      for (let i = 0; i < count; i += 1) {
        next = (next + direction + count) % count;
        if (options[next]?.disabled !== true) break;
      }
      setActiveIndex(next);
    },
    [activeIndex, options],
  );

  /* Dismiss on outside pointer-down. */
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  /* Re-sync the highlighted row whenever the popup opens. */
  useEffect(() => {
    if (open) {
      setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  }, [open, options, value]);

  return (
    <div className={['tt-field', className ?? ''].filter(Boolean).join(' ')}>
      {label !== undefined ? (
        <span className="tt-field__label" id={`${id}-label`}>
          {label}
        </span>
      ) : null}

      <div className="tt-select" ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className="tt-select__trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={label !== undefined ? `${id}-label` : undefined}
          aria-controls={`${id}-list`}
          aria-activedescendant={open ? `${id}-opt-${activeIndex}` : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault();
                if (!open) setOpen(true);
                else step(1);
                break;
              case 'ArrowUp':
                event.preventDefault();
                if (!open) setOpen(true);
                else step(-1);
                break;
              case 'Home':
                if (open) {
                  event.preventDefault();
                  setActiveIndex(0);
                }
                break;
              case 'End':
                if (open) {
                  event.preventDefault();
                  setActiveIndex(options.length - 1);
                }
                break;
              case 'Enter':
              case ' ':
                if (open) {
                  event.preventDefault();
                  commit(activeIndex);
                }
                break;
              case 'Escape':
                if (open) {
                  event.preventDefault();
                  close(true);
                }
                break;
              default:
                break;
            }
          }}
        >
          <span>{selected ? selected.label : placeholder}</span>
          <IconChevronDown />
        </button>

        <AnimatePresence>
          {open ? (
            <motion.ul
              id={`${id}-list`}
              role="listbox"
              className="tt-select__menu"
              initial={{ opacity: 0, y: -6, scaleY: 0.94 }}
              animate={{ opacity: 1, y: 0, scaleY: 1 }}
              exit={{ opacity: 0, y: -4, scaleY: 0.97, transition: { duration: DUR.instant } }}
              transition={springSnappy}
            >
              {options.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    id={`${id}-opt-${index}`}
                    role="option"
                    className="tt-select__option"
                    aria-selected={option.value === value}
                    data-active={index === activeIndex}
                    disabled={option.disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                  >
                    <span>
                      {option.label}
                      {option.detail !== undefined ? (
                        <span className="tt-panel__subtitle">{option.detail}</span>
                      ) : null}
                    </span>
                    {option.value === value ? <IconCheck /> : null}
                  </button>
                </li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
