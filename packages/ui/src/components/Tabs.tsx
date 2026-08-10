import { motion } from 'framer-motion';
import { useCallback, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { springSoft } from '../styles/motion';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tablist. */
  label: string;
  className?: string;
}

/**
 * Segmented tab control.
 *
 * The selected-state pill is a `layoutId` element, so switching tabs slides
 * the plate between them with a spring instead of cutting.
 *
 * Implements the WAI-ARIA tabs keyboard model: Left/Right move selection,
 * Home/End jump to the ends, disabled tabs are skipped, and only the selected
 * tab is in the tab order (roving tabindex).
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: TabsProps<T>): JSX.Element {
  const groupId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const move = useCallback(
    (direction: 1 | -1 | 'first' | 'last') => {
      const enabled = items.filter((i) => i.disabled !== true);
      if (enabled.length === 0) return;

      let next: TabItem<T> | undefined;
      if (direction === 'first') next = enabled[0];
      else if (direction === 'last') next = enabled[enabled.length - 1];
      else {
        const currentIndex = enabled.findIndex((i) => i.value === value);
        const target = (currentIndex + direction + enabled.length) % enabled.length;
        next = enabled[target];
      }
      if (!next) return;

      onChange(next.value);
      // Keep DOM focus with the newly selected tab (roving tabindex).
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLButtonElement>(`[data-tab-value="${next!.value}"]`)
          ?.focus();
      });
    },
    [items, onChange, value],
  );

  return (
    <div
      ref={listRef}
      className={['tt-tabs', className ?? ''].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            event.preventDefault();
            move(1);
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            event.preventDefault();
            move(-1);
            break;
          case 'Home':
            event.preventDefault();
            move('first');
            break;
          case 'End':
            event.preventDefault();
            move('last');
            break;
          default:
            break;
        }
      }}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`${groupId}-${item.value}`}
            data-tab-value={item.value}
            className="tt-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
          >
            {selected ? (
              <motion.span
                layoutId={`${groupId}-pill`}
                className="tt-tab__pill"
                transition={springSoft}
              />
            ) : null}
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
