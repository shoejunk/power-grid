import { motion } from 'framer-motion';

/**
 * Decorative art used by the shell.
 *
 * All of it is inline SVG so it is theme-aware (it reads the same accent
 * tokens as the rest of the UI), resolution-independent at 4K, and costs no
 * network requests. Everything here is `aria-hidden` — it carries mood, never
 * information.
 */

/* ------------------------------------------------------------------ *
 * Transmission-line skyline
 * ------------------------------------------------------------------ */

interface PylonProps {
  x: number;
  scale: number;
  opacity: number;
}

/** One lattice transmission tower, drawn from the base up. */
function Pylon({ x, scale, opacity }: PylonProps): JSX.Element {
  return (
    <g transform={`translate(${x} 0) scale(${scale})`} opacity={opacity}>
      {/* legs */}
      <path
        d="M0 240 L18 120 M60 240 L42 120 M18 120 L42 120 M6 200 L54 200 M10 170 L50 170 M14 142 L46 142"
        stroke="currentColor"
        strokeWidth="2.4"
        fill="none"
      />
      {/* mast */}
      <path
        d="M22 120 L26 40 M38 120 L34 40 M26 40 L34 40"
        stroke="currentColor"
        strokeWidth="2.4"
        fill="none"
      />
      {/* cross-arms */}
      <path
        d="M-14 104 L74 104 M-6 78 L66 78 M2 54 L58 54"
        stroke="currentColor"
        strokeWidth="2.4"
        fill="none"
      />
      {/* insulator strings */}
      <path
        d="M-14 104 L-14 112 M74 104 L74 112 M-6 78 L-6 86 M66 78 L66 86 M2 54 L2 62 M58 54 L58 62"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
      />
      {/* beacon */}
      <circle cx="30" cy="36" r="3" fill="#ff5563" opacity="0.9" />
    </g>
  );
}

export interface PylonSceneProps {
  className?: string;
}

/**
 * The main-menu hero: three receding ranks of transmission towers with sagging
 * catenary cables, lit from behind. Depth comes from scale, opacity and
 * blur-by-proxy (thinner strokes on the far rank), which is what stops it
 * reading as flat vector art.
 */
export function PylonScene({ className }: PylonSceneProps): JSX.Element {
  return (
    <svg
      className={['pg-pylons', className ?? ''].filter(Boolean).join(' ')}
      viewBox="0 0 1200 260"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pg-cable" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#46e2ff" stopOpacity="0" />
          <stop offset="35%" stopColor="#46e2ff" stopOpacity="0.5" />
          <stop offset="65%" stopColor="#d9813f" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#d9813f" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pg-hazefade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#46e2ff" stopOpacity="0.13" />
          <stop offset="100%" stopColor="#46e2ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* backlight haze */}
      <ellipse cx="600" cy="250" rx="560" ry="150" fill="url(#pg-hazefade)" />

      {/* far rank */}
      <g color="#22303f">
        <Pylon x={90} scale={0.52} opacity={0.75} />
        <Pylon x={420} scale={0.52} opacity={0.75} />
        <Pylon x={760} scale={0.52} opacity={0.75} />
        <Pylon x={1060} scale={0.52} opacity={0.75} />
      </g>

      {/* catenary cables between the near rank */}
      <g fill="none" stroke="url(#pg-cable)" strokeWidth="1.6">
        <path d="M20 118 Q 300 168 580 118 T 1140 118" />
        <path d="M20 150 Q 300 205 580 150 T 1140 150" />
        <path d="M20 86 Q 300 130 580 86 T 1140 86" />
      </g>

      {/* near rank */}
      <g color="#2e3f52">
        <Pylon x={-20} scale={0.92} opacity={0.95} />
        <Pylon x={540} scale={0.92} opacity={0.95} />
        <Pylon x={1100} scale={0.92} opacity={0.95} />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Wordmark
 * ------------------------------------------------------------------ */

export interface WordmarkProps {
  /** Renders the compact single-line lockup used in headers. */
  compact?: boolean;
  className?: string;
}

/**
 * The POWER GRID logo lockup.
 *
 * Type-driven rather than a raster logo: condensed Oswald with a copper-to-
 * ember gradient on "POWER", a bright electric "GRID", and a bolt glyph
 * struck through the rule between them.
 */
export function Wordmark({ compact = false, className }: WordmarkProps): JSX.Element {
  if (compact) {
    return (
      <span className={['pg-wordmark pg-wordmark--compact', className ?? ''].filter(Boolean).join(' ')}>
        <span className="pg-wordmark__power">Power</span>
        <span className="pg-wordmark__grid">Grid</span>
      </span>
    );
  }

  return (
    <div className={['pg-wordmark', className ?? ''].filter(Boolean).join(' ')}>
      <motion.span
        className="pg-wordmark__power"
        initial={{ opacity: 0, y: 26, letterSpacing: '0.3em' }}
        animate={{ opacity: 1, y: 0, letterSpacing: '-0.012em' }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        Power
      </motion.span>

      <motion.span
        className="pg-wordmark__bar"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="pg-wordmark__bolt">
          <path d="M13.4 2 5 13.2h5.3L9.4 22l8.9-11.8h-5.4z" fill="currentColor" />
        </svg>
      </motion.span>

      <motion.span
        className="pg-wordmark__grid"
        initial={{ opacity: 0, y: 26, letterSpacing: '0.3em' }}
        animate={{ opacity: 1, y: 0, letterSpacing: '0.055em' }}
        transition={{ duration: 0.8, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        Grid
      </motion.span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ambient background stack
 * ------------------------------------------------------------------ */

export interface AmbientBackdropProps {
  /** Adds the transmission-tower skyline along the bottom edge. */
  pylons?: boolean;
  /** Strength of the blueprint grid, 0–1. */
  grid?: boolean;
}

/**
 * The shared background for every screen: drifting colour blooms, a blueprint
 * lattice, a horizon glow, scanlines, film grain and a vignette. Mounting the
 * same stack everywhere is what makes menu, lobby and match read as one world
 * (quality bar V5).
 */
export function AmbientBackdrop({ pylons = false, grid = true }: AmbientBackdropProps): JSX.Element {
  return (
    <div className="tt-backdrop" aria-hidden="true">
      <div className="tt-layer tt-layer--aurora" />
      {grid ? <div className="tt-layer tt-layer--grid" /> : null}
      <div className="tt-layer tt-layer--horizon" />
      {pylons ? <PylonScene /> : null}
      <div className="tt-layer tt-layer--scanlines" />
      <div className="tt-layer tt-layer--vignette" />
      <div className="tt-layer tt-layer--noise" />
    </div>
  );
}
