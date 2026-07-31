import { AnimatePresence, motion } from 'framer-motion';
import { cloneElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement, ReactNode } from 'react';

import { DUR, springSnappy } from '../styles/motion';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** Optional bold heading inside the bubble. */
  title?: ReactNode;
  content: ReactNode;
  /**
   * Rules citation rendered in the bubble's footer, e.g. "§6 Auction".
   * Every rules-derived explanation in the game carries one of these so a
   * player can always trace a UI claim back to the rulebook.
   */
  rule?: string;
  placement?: TooltipPlacement;
  /** ms before the bubble appears on hover. Focus always shows immediately. */
  delay?: number;
  /** The trigger. Must accept a ref and DOM handlers. */
  children: ReactElement;
}

interface Position {
  top: number;
  left: number;
  transformOrigin: string;
}

const GAP = 10;

/**
 * Hover / focus tooltip.
 *
 * Positioned with `position: fixed` against the trigger's viewport rect and
 * portalled to `body`, so it is never clipped by a scroll container and never
 * inherits a stacking context from a panel.
 *
 * Accessibility: the trigger gets `aria-describedby`; the bubble is
 * `role="tooltip"`; keyboard focus opens it and Escape dismisses it.
 */
export function Tooltip({
  title,
  content,
  rule,
  placement = 'top',
  delay = 140,
  children,
}: TooltipProps): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      clearTimer();
      if (immediate || delay <= 0) {
        setOpen(true);
      } else {
        timerRef.current = window.setTimeout(() => setOpen(true), delay);
      }
    },
    [clearTimer, delay],
  );

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  /* Measure after paint so the bubble's real size is known, then clamp it
     inside the viewport. Runs in a layout effect to avoid a visible jump. */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;

    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let top = 0;
    let left = 0;
    let origin = 'bottom center';

    switch (placement) {
      case 'bottom':
        top = t.bottom + GAP;
        left = t.left + t.width / 2 - b.width / 2;
        origin = 'top center';
        break;
      case 'left':
        top = t.top + t.height / 2 - b.height / 2;
        left = t.left - b.width - GAP;
        origin = 'center right';
        break;
      case 'right':
        top = t.top + t.height / 2 - b.height / 2;
        left = t.right + GAP;
        origin = 'center left';
        break;
      default:
        top = t.top - b.height - GAP;
        left = t.left + t.width / 2 - b.width / 2;
        origin = 'bottom center';
    }

    const margin = 8;
    left = Math.min(Math.max(margin, left), window.innerWidth - b.width - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - b.height - margin);

    setPos({ top, left, transformOrigin: origin });
  }, [open, placement, content, title]);

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const childRef = (children as unknown as { ref?: unknown }).ref;
      if (typeof childRef === 'function') (childRef as (n: HTMLElement | null) => void)(node);
      else if (childRef && typeof childRef === 'object')
        (childRef as { current: HTMLElement | null }).current = node;
    },
    'aria-describedby': open ? id : undefined,
    onMouseEnter: () => show(false),
    onMouseLeave: hide,
    onFocus: () => show(true),
    onBlur: hide,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    },
  } as Record<string, unknown>);

  return (
    <>
      {trigger}
      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  ref={bubbleRef}
                  id={id}
                  role="tooltip"
                  className="pg-tooltip"
                  style={{
                    top: pos?.top ?? -9999,
                    left: pos?.left ?? -9999,
                    transformOrigin: pos?.transformOrigin ?? 'center',
                    // Keep it invisible for the single frame before measuring.
                    visibility: pos ? 'visible' : 'hidden',
                  }}
                  initial={{ opacity: 0, scale: 0.92, y: placement === 'top' ? 4 : -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: DUR.instant } }}
                  transition={springSnappy}
                >
                  {title !== undefined ? (
                    <strong className="pg-tooltip__title">{title}</strong>
                  ) : null}
                  {content}
                  {rule !== undefined ? <span className="pg-tooltip__rule">{rule}</span> : null}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

export interface HintProps {
  title?: ReactNode;
  content: ReactNode;
  rule?: string;
  placement?: TooltipPlacement;
}

/**
 * The small "?" affordance. Pairs a Tooltip with a focusable target so every
 * explanatory note in the game is reachable by keyboard, not just by hover.
 */
export function Hint({ title, content, rule, placement = 'top' }: HintProps): JSX.Element {
  return (
    <Tooltip title={title} content={content} rule={rule} placement={placement}>
      <button type="button" className="pg-hint" aria-label="More information">
        ?
      </button>
    </Tooltip>
  );
}
