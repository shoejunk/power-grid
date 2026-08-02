/**
 * SVG `<defs>` fragments for the board renderer.
 *
 * The board is SVG + React, so some of the art is far better delivered as
 * vector defs than as raster: gradients and filters stay sharp at any zoom,
 * cost no memory, and can be re-tinted per element. Raster still wins for the
 * painted terrain (a per-pixel relief render is not expressible as a filter)
 * and for the pieces, where a baked bevel beats a live filter on performance.
 *
 * Usage — inject once, near the top of the board's <svg>:
 *
 *   <defs dangerouslySetInnerHTML={{ __html: boardDefs({ grain: art.paperGrain }) }} />
 *
 * then reference by the stable ids in `BOARD_DEF_IDS`.
 *
 * Everything is additive: nothing in here is required to render the board.
 */

import type { PlayerColor } from '@pg/shared';
import { seatPalette, toHex } from './index';

/** Stable ids, so consumers never hard-code strings that might drift. */
export const BOARD_DEF_IDS = {
  /** `<pattern>` of the tiling paper tooth. */
  grain: 'pg-grain',
  /** Radial gradient, black at the rim — paint over the whole board. */
  vignette: 'pg-vignette',
  /** Soft outer glow, for hover and selection. */
  glow: 'pg-glow-soft',
  /** Three elevation drop shadows matching --pg-elev-1..3. */
  elev1: 'pg-elev-1',
  elev2: 'pg-elev-2',
  elev3: 'pg-elev-3',
  /** Turbulent displacement — makes a vector edge look brush-painted. */
  paintedEdge: 'pg-painted-edge',
  /** Inner shadow, for recessed wells and tracks. */
  inset: 'pg-inset',
  /** Per-seat radial glow gradient: `pg-seat-<colour>-glow`. */
  seatGlow: (c: PlayerColor): string => `pg-seat-${c}-glow`,
  /** Per-seat vertical ramp for filled shapes: `pg-seat-<colour>-fill`. */
  seatFill: (c: PlayerColor): string => `pg-seat-${c}-fill`,
} as const;

const SEATS: PlayerColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'black'];

export interface BoardDefsOptions {
  /** `ArtManifest.paperGrain` — becomes the tiling grain pattern. */
  grain?: string;
  /** Tile size in user units for the grain pattern. */
  grainSize?: number;
  /** Grain opacity; the default is tuned against --pg-noise-opacity. */
  grainOpacity?: number;
}

/**
 * Builds the `<defs>` inner markup. Returns a string rather than JSX so this
 * module stays framework-free and testable.
 */
export function boardDefs(opts: BoardDefsOptions = {}): string {
  const { grain, grainSize = 256, grainOpacity = 0.09 } = opts;

  const seatDefs = SEATS.map((c) => {
    const p = seatPalette(c);
    return `
<radialGradient id="${BOARD_DEF_IDS.seatGlow(c)}">
  <stop offset="0%"   stop-color="${toHex(p.glow)}" stop-opacity="0.85"/>
  <stop offset="45%"  stop-color="${toHex(p.glow)}" stop-opacity="0.28"/>
  <stop offset="100%" stop-color="${toHex(p.glow)}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="${BOARD_DEF_IDS.seatFill(c)}" x1="0" y1="0" x2="0.35" y2="1">
  <stop offset="0%"   stop-color="${toHex(p.light)}"/>
  <stop offset="42%"  stop-color="${toHex(p.base)}"/>
  <stop offset="100%" stop-color="${toHex(p.dark)}"/>
</linearGradient>`;
  }).join('');

  const grainDef = grain
    ? `
<pattern id="${BOARD_DEF_IDS.grain}" width="${grainSize}" height="${grainSize}"
         patternUnits="userSpaceOnUse">
  <image href="${grain}" width="${grainSize}" height="${grainSize}"
         opacity="${grainOpacity}" preserveAspectRatio="none"/>
</pattern>`
    : '';

  return `${grainDef}
<radialGradient id="${BOARD_DEF_IDS.vignette}">
  <stop offset="55%"  stop-color="#02050a" stop-opacity="0"/>
  <stop offset="82%"  stop-color="#02050a" stop-opacity="0.30"/>
  <stop offset="100%" stop-color="#02050a" stop-opacity="0.74"/>
</radialGradient>

<filter id="${BOARD_DEF_IDS.glow}" x="-70%" y="-70%" width="240%" height="240%">
  <feGaussianBlur stdDeviation="6" result="b1"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="b2"/>
  <feMerge>
    <feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>

<filter id="${BOARD_DEF_IDS.elev1}" x="-40%" y="-40%" width="180%" height="180%">
  <feDropShadow dx="0" dy="1" stdDeviation="1"   flood-color="#000" flood-opacity="0.50"/>
  <feDropShadow dx="0" dy="2" stdDeviation="3"   flood-color="#000" flood-opacity="0.32"/>
</filter>
<filter id="${BOARD_DEF_IDS.elev2}" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="0" dy="2" stdDeviation="2"   flood-color="#000" flood-opacity="0.46"/>
  <feDropShadow dx="0" dy="6" stdDeviation="8"   flood-color="#000" flood-opacity="0.42"/>
</filter>
<filter id="${BOARD_DEF_IDS.elev3}" x="-60%" y="-60%" width="220%" height="220%">
  <feDropShadow dx="0" dy="4"  stdDeviation="4"  flood-color="#000" flood-opacity="0.44"/>
  <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.50"/>
</filter>

<!-- Roughens a vector outline with fractal noise. A region boundary run
     through this stops reading as a computed polygon and starts reading as
     a painted edge — cheap, and it is what sells hand-drawn cartography. -->
<filter id="${BOARD_DEF_IDS.paintedEdge}" x="-12%" y="-12%" width="124%" height="124%">
  <feTurbulence type="fractalNoise" baseFrequency="0.022 0.030" numOctaves="4"
                seed="7" result="turb"/>
  <feDisplacementMap in="SourceGraphic" in2="turb" scale="7"
                     xChannelSelector="R" yChannelSelector="G"/>
</filter>

<filter id="${BOARD_DEF_IDS.inset}" x="-30%" y="-30%" width="160%" height="160%">
  <feComponentTransfer in="SourceAlpha" result="a">
    <feFuncA type="table" tableValues="1 0"/>
  </feComponentTransfer>
  <feGaussianBlur in="a" stdDeviation="3" result="blur"/>
  <feOffset in="blur" dx="0" dy="2" result="off"/>
  <feFlood flood-color="#000" flood-opacity="0.62" result="col"/>
  <feComposite in="col" in2="off" operator="in" result="shadow"/>
  <feComposite in="shadow" in2="SourceAlpha" operator="in" result="clipped"/>
  <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="clipped"/></feMerge>
</filter>
${seatDefs}`;
}
