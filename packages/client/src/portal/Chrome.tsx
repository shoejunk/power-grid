import { motion } from 'framer-motion';

/**
 * The portal's own art.
 *
 * Power Grid's pylons and Dead of Winter's snow belong to those games; the
 * front door needs a look of its own, or the site reads as one game with a
 * second one bolted on. This is deliberately abstract — a lit horizon and a
 * faint table grid — so it sits under any title's accent without arguing
 * with it.
 *
 * All inline SVG/CSS: theme-aware, crisp at 4K, no network cost, and
 * `aria-hidden` throughout because it carries mood, never information.
 */

export function PortalBackdrop(): JSX.Element {
  return (
    <div className="tt-backdrop" aria-hidden="true">
      <div className="tt-layer tt-layer--grid" />
      <div className="tt-layer tt-layer--aurora" />
      <div className="tt-layer tt-layer--vignette" />
      <div className="tt-layer tt-layer--noise" />
    </div>
  );
}

export interface PortalMarkProps {
  compact?: boolean;
}

/**
 * The site wordmark.
 *
 * Two stacked meeples cut out of a single shape — a table with players around
 * it. Drawn rather than typeset so it stays legible at 18px in a top bar and
 * at 64px on the home page.
 */
export function PortalMark({ compact = false }: PortalMarkProps): JSX.Element {
  return (
    <span className={`tt-mark${compact ? ' tt-mark--compact' : ''}`}>
      <span className="tt-mark__glyph" aria-hidden="true">
        <svg viewBox="0 0 34 34" fill="none">
          <motion.rect
            x="2.5"
            y="2.5"
            width="29"
            height="29"
            rx="8"
            stroke="currentColor"
            strokeWidth="1.6"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
          <circle cx="12" cy="13" r="3.4" fill="currentColor" />
          <path d="M6 24c0-3.6 2.7-6 6-6s6 2.4 6 6z" fill="currentColor" />
          <circle cx="23" cy="16" r="2.6" fill="currentColor" opacity="0.55" />
          <path d="M18.4 24c0-2.8 2-4.6 4.6-4.6s4.6 1.8 4.6 4.6z" fill="currentColor" opacity="0.55" />
        </svg>
      </span>
      <span className="tt-mark__type">
        <b>Table</b>
        <i>Top</i>
      </span>
    </span>
  );
}
