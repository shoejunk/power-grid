/**
 * Palette bridge for the board.
 *
 * Colours are read out of the design-token custom properties through the art
 * module's `cssColor`, never hard-coded here — QUALITY-BAR V5 wants the board
 * and the DOM UI to be visibly the same product, and the only way to guarantee
 * that is for both to resolve the same `--pg-*` variables.
 *
 * The values are resolved once per mount (they are static for the session) and
 * memoised, because `getComputedStyle` is not free.
 */

import type { PlayerColor } from '@pg/shared';
import { cssColor, seatPalette, seatSigil, type SeatSigil } from '@/art';

export const hex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

export interface SeatInk {
  base: string;
  light: string;
  dark: string;
  /** Foreground that meets contrast on `base` — used for the sigil glyph. */
  ink: string;
  glow: string;
  sigil: SeatSigil;
}

export interface BoardTheme {
  void: string;
  base: string;
  sunken: string;
  panel: string;
  elevated: string;
  line: string;
  lineStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  cyan: string;
  cyanBright: string;
  copper: string;
  copperBright: string;
  elektro: string;
  elektroDim: string;
  success: string;
  danger: string;
  trust: string;
  seat: (color: PlayerColor) => SeatInk;
}

let cache: BoardTheme | null = null;

export function boardTheme(): BoardTheme {
  if (cache) return cache;

  const seatCache = new Map<PlayerColor, SeatInk>();
  const seat = (color: PlayerColor): SeatInk => {
    const found = seatCache.get(color);
    if (found) return found;
    // The art module owns seat colour resolution; the board must not have its
    // own opinion, or the two will drift (QUALITY-BAR V5).
    const p = seatPalette(color);
    const ink: SeatInk = {
      base: hex(p.base),
      light: hex(p.light),
      dark: hex(p.dark),
      ink: hex(p.ink),
      glow: hex(p.glow),
      sigil: seatSigil(color),
    };
    seatCache.set(color, ink);
    return ink;
  };

  cache = {
    void: hex(cssColor('--tt-surface-void', 0x04070a)),
    base: hex(cssColor('--tt-surface-base', 0x070b10)),
    sunken: hex(cssColor('--tt-surface-sunken', 0x0a1018)),
    panel: hex(cssColor('--tt-surface-panel', 0x141d28)),
    elevated: hex(cssColor('--tt-surface-elevated', 0x1b2634)),
    line: hex(cssColor('--tt-line', 0x9ac0e1)),
    lineStrong: hex(cssColor('--tt-line-strong', 0xa8d0f0)),
    text: hex(cssColor('--tt-text-primary', 0xdfe8f2)),
    textMuted: hex(cssColor('--tt-text-muted', 0x8497ab)),
    textFaint: hex(cssColor('--tt-text-faint', 0x74879c)),
    cyan: hex(cssColor('--tt-cyan', 0x46e2ff)),
    cyanBright: hex(cssColor('--tt-cyan-bright', 0x8df3ff)),
    copper: hex(cssColor('--tt-copper', 0xd9813f)),
    copperBright: hex(cssColor('--tt-copper-bright', 0xf7a85f)),
    elektro: hex(cssColor('--pg-elektro', 0xffd166)),
    elektroDim: hex(cssColor('--pg-elektro-dim', 0xa37820)),
    success: hex(cssColor('--tt-success', 0x3ad693)),
    danger: hex(cssColor('--tt-danger', 0xff5563)),
    trust: hex(cssColor('--pg-trust', 0x93a2b5)),
    seat,
  };
  return cache;
}

/* ------------------------------------------------------------------ *
 * Seat sigils (QUALITY-BAR V3)
 *
 * Colour is never the only channel carrying ownership: every occupied house
 * slot also stamps the seat's sigil, so the six seats stay separable under
 * deuteranopia and protanopia.
 * ------------------------------------------------------------------ */

function polygon(r: number, sides: number, rotation: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function star(r: number, points: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Sigil outline centred on the origin, sized to fit inside radius `r`. */
export function sigilPath(kind: SeatSigil, r: number): string {
  switch (kind) {
    case 'triangle':
      return polygon(r * 1.06, 3, -Math.PI / 2);
    case 'square':
      return polygon(r * 0.94, 4, Math.PI / 4);
    case 'diamond':
      return polygon(r * 1.06, 4, -Math.PI / 2);
    case 'hexagon':
      return polygon(r * 0.99, 6, -Math.PI / 2);
    case 'star':
      return star(r * 1.1, 5, 0.46);
    case 'circle':
    default:
      return `M${-r} 0A${r} ${r} 0 1 0 ${r} 0A${r} ${r} 0 1 0 ${-r} 0Z`;
  }
}
