/**
 * Palette bridge — the single place where SCSS design tokens become numbers
 * the canvas/SVG art can draw with.
 *
 * QUALITY-BAR V5 requires one art direction across menu, lobby and match. That
 * only holds if the generated art and the DOM UI read the *same* values, so
 * everything here resolves live CSS custom properties from `tokens.scss` and
 * only falls back to a baked constant when the document is not available
 * (tests, SSR) or the property is missing.
 */

import type { PlayerColor } from '@pg/shared';

/* ------------------------------------------------------------------ *
 * CSS custom property resolution
 * ------------------------------------------------------------------ */

let rootStyle: CSSStyleDeclaration | null = null;
const varCache = new Map<string, string>();

function readVar(name: string): string {
  if (typeof document === 'undefined') return '';
  const cached = varCache.get(name);
  if (cached !== undefined) return cached;
  if (!rootStyle) rootStyle = getComputedStyle(document.documentElement);
  const v = rootStyle.getPropertyValue(name).trim();
  varCache.set(name, v);
  return v;
}

/** Drops the memoised custom-property values — call after a theme swap. */
export function invalidatePaletteCache(): void {
  rootStyle = null;
  varCache.clear();
}

/**
 * Parses any colour syntax the tokens file actually uses into 0xRRGGBB.
 * The original implementation only understood `#rrggbb`, which silently
 * discarded every `--pg-player-*-glow` (they are authored as `rgba(...)`) and
 * returned the fallback instead.
 */
export function parseColor(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();

  if (s.startsWith('#')) {
    const h = s.slice(1);
    const full = h.length === 3 || h.length === 4 ? h.slice(0, 3).replace(/./g, (c) => c + c) : h.slice(0, 6);
    const n = Number.parseInt(full, 16);
    return Number.isNaN(n) ? null : n;
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const ch = parts.slice(0, 3).map((p) => {
        const v = p.endsWith('%') ? (Number.parseFloat(p) / 100) * 255 : Number.parseFloat(p);
        return Math.max(0, Math.min(255, Math.round(v)));
      });
      if (ch.every((v) => Number.isFinite(v))) return (ch[0]! << 16) | (ch[1]! << 8) | ch[2]!;
    }
  }

  return null;
}

/** Reads a CSS custom property off :root and returns it as a 0xRRGGBB number. */
export function cssColor(varName: string, fallback = 0xffffff): number {
  const parsed = parseColor(readVar(varName));
  return parsed ?? fallback;
}

/** As `cssColor`, but returns a `#rrggbb` string for canvas fill styles. */
export function cssHex(varName: string, fallback = '#ffffff'): string {
  const parsed = parseColor(readVar(varName));
  return parsed === null ? fallback : `#${parsed.toString(16).padStart(6, '0')}`;
}

export const toHex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

/* ------------------------------------------------------------------ *
 * seats
 * ------------------------------------------------------------------ */

export interface SeatPalette {
  base: number;
  light: number;
  dark: number;
  glow: number;
}

/**
 * Baked mirror of the `--pg-player-*` block in tokens.scss. Used only when the
 * document is unavailable; the live values always win.
 */
const SEAT_FALLBACK: Record<PlayerColor, SeatPalette & { ink: number }> = {
  red: { base: 0xe8414a, light: 0xff8087, dark: 0x7d1319, glow: 0xe8414a, ink: 0xffffff },
  blue: { base: 0x3d8bff, light: 0x8fbcff, dark: 0x14396f, glow: 0x3d8bff, ink: 0xffffff },
  green: { base: 0x2fc46f, light: 0x78e6a5, dark: 0x12592f, glow: 0x2fc46f, ink: 0x052112 },
  yellow: { base: 0xffc93c, light: 0xffe391, dark: 0x8a6208, glow: 0xffc93c, ink: 0x2a1c00 },
  purple: { base: 0xb06bff, light: 0xd5aeff, dark: 0x52208f, glow: 0xb06bff, ink: 0xffffff },
  black: { base: 0x78889b, light: 0xb3c0cf, dark: 0x262d36, glow: 0x78889b, ink: 0x0a0e13 },
};

/**
 * Resolves a seat's four-stop ramp from the design tokens.
 *
 * NOTE: the tokens are named `--pg-player-<seat>`, not `--seat-<seat>`. The
 * placeholder read the latter, so every lookup missed and `light`/`dark` came
 * back as pure white and pure black — which is why bevels had no seat identity.
 */
export function seatPalette(color: PlayerColor): SeatPalette {
  const fb = SEAT_FALLBACK[color];
  return {
    base: cssColor(`--pg-player-${color}`, fb.base),
    light: cssColor(`--pg-player-${color}-light`, fb.light),
    dark: cssColor(`--pg-player-${color}-dark`, fb.dark),
    glow: cssColor(`--pg-player-${color}-glow`, fb.glow),
  };
}

/**
 * The readable ink colour for text or a sigil drawn ON a seat colour.
 * Additive to the frozen `SeatPalette` shape rather than a new field on it, so
 * existing consumers are untouched.
 */
export function seatInk(color: PlayerColor): number {
  return cssColor(`--pg-player-${color}-ink`, SEAT_FALLBACK[color].ink);
}

/** The Trust faction sits deliberately outside the six seat hues (§13). */
export function trustPalette(): SeatPalette {
  const base = cssColor('--pg-trust', 0x93a2b5);
  return { base, light: 0xc4cfdb, dark: 0x333c47, glow: cssColor('--pg-trust-glow', 0x93a2b5) };
}

/* ------------------------------------------------------------------ *
 * sigils — colour is never the only identity channel (V3)
 * ------------------------------------------------------------------ */

export type SeatSigil = 'triangle' | 'circle' | 'square' | 'diamond' | 'star' | 'hexagon';

const SEAT_SIGIL: Record<PlayerColor, SeatSigil> = {
  red: 'triangle',
  blue: 'circle',
  green: 'square',
  yellow: 'diamond',
  purple: 'star',
  black: 'hexagon',
};

export function seatSigil(color: PlayerColor): SeatSigil {
  return SEAT_SIGIL[color];
}

/**
 * Sigil outline as normalised points on a unit circle centred at (0,0).
 * `circle` returns an empty list — callers draw an arc for it.
 */
export function sigilPoints(sigil: SeatSigil): [number, number][] {
  const ring = (n: number, rot: number, r = 1): [number, number][] =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i / n) * Math.PI * 2;
      return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
    });

  switch (sigil) {
    case 'triangle':
      return ring(3, -Math.PI / 2);
    case 'square':
      return ring(4, -Math.PI / 4);
    case 'diamond':
      return ring(4, -Math.PI / 2);
    case 'hexagon':
      return ring(6, -Math.PI / 2);
    case 'star':
      return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 1 : 0.46;
        return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
      });
    case 'circle':
    default:
      return [];
  }
}
