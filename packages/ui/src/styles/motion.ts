import type { Transition, Variants } from 'framer-motion';

/**
 * Motion tokens.
 *
 * The CSS side of the design system exposes `--tt-dur-*` / `--tt-ease-*`;
 * this module is the framer-motion mirror of the same vocabulary so a
 * spring in JS and a transition in SCSS feel like the same product.
 *
 * Nothing here reads the DOM, so it is safe to import from anywhere.
 */

/* ------------------------------------------------------------------ *
 * Durations (seconds — framer-motion's unit)
 * ------------------------------------------------------------------ */
export const DUR = {
  instant: 0.08,
  fast: 0.14,
  base: 0.22,
  slow: 0.36,
  slower: 0.56,
} as const;

/* ------------------------------------------------------------------ *
 * Springs
 * ------------------------------------------------------------------ */

/** Crisp UI response — buttons, toggles, chips. Barely overshoots. */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 620,
  damping: 34,
  mass: 0.7,
};

/** The default for panels and cards entering the layout. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.9,
};

/** Heavier, more physical — modals, drawers, big reveals. */
export const springHeavy: Transition = {
  type: 'spring',
  stiffness: 240,
  damping: 26,
  mass: 1.15,
};

/** Deliberately bouncy — celebratory moments (money gained, ready-up). */
export const springBouncy: Transition = {
  type: 'spring',
  stiffness: 480,
  damping: 18,
  mass: 0.8,
};

export const easeOut: Transition = { duration: DUR.base, ease: [0.22, 1, 0.36, 1] };
export const easeInOut: Transition = { duration: DUR.base, ease: [0.66, 0, 0.34, 1] };

/* ------------------------------------------------------------------ *
 * Reusable variant sets
 * ------------------------------------------------------------------ */

/** Fade + lift. The house entrance for content blocks. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -8, transition: { duration: DUR.fast } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DUR.base } },
  exit: { opacity: 0, transition: { duration: DUR.fast } },
};

/** Scale-in from slightly small — modals, popovers, tooltips. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springHeavy },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: { duration: DUR.fast } },
};

/** Screen-level transition — a full route change. */
export const screenTransition: Variants = {
  hidden: { opacity: 0, scale: 0.985 },
  visible: { opacity: 1, scale: 1, transition: { ...springSoft, staggerChildren: 0.05 } },
  exit: { opacity: 0, scale: 1.01, transition: { duration: DUR.base } },
};

/**
 * Stagger container. `delayChildren` gives the parent's own entrance room
 * to land before the children start.
 */
export const staggerContainer = (stagger = 0.055, delay = 0.06): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
  exit: { opacity: 0 },
});

/** The child that pairs with `staggerContainer`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -10 },
};

/** Toast slide-in from the right rail. */
export const toastVariants: Variants = {
  hidden: { opacity: 0, x: 48, scale: 0.94 },
  visible: { opacity: 1, x: 0, scale: 1, transition: springSnappy },
  exit: { opacity: 0, x: 24, scale: 0.96, transition: { duration: DUR.fast } },
};

/* ------------------------------------------------------------------ *
 * Press physics — shared by every clickable primitive
 * ------------------------------------------------------------------ */
export const pressScale = { scale: 0.965 } as const;
export const hoverLift = { y: -2 } as const;

/**
 * Reads the OS reduced-motion preference once at module load.
 * Components call `prefersReducedMotion()` at render time (it re-reads the
 * media query, so a mid-session OS change is picked up on next render).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
