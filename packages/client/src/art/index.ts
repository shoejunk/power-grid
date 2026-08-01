/**
 * Art module — the single source of visual assets for the board and game UI.
 *
 * CONTRACT. The exported names here are depended on by the board renderer
 * (`src/board/`) and the in-game UI (`src/game/`). The art agent owns this
 * directory and should replace the placeholder generators below with real
 * artwork, but MUST keep these signatures stable so consumers never break.
 *
 * Consumers import from '@/art' only — never reach into sibling files.
 *
 * Everything here is functional today: the placeholders are procedurally drawn
 * so the board renderer can be built and run before final art exists.
 */

import type { MapId, PlayerColor, PowerPlant, ResourceType } from '@pg/shared';

/* ------------------------------------------------------------------ *
 * Texture handles
 *
 * A TextureRef is anything PixiJS `Assets.load` / `Texture.from` accepts:
 * a URL, or a `data:` URI for procedurally generated art. Keeping it a string
 * means the board renderer never needs to know how the art was produced.
 * ------------------------------------------------------------------ */

export type TextureRef = string;

export interface ArtManifest {
  /** Painted terrain base for a map, sized to the map's aspect ratio. */
  boardBase: Record<MapId, TextureRef>;
  /** Tiling grain overlaid on panels and the board to kill flatness. */
  paperGrain: TextureRef;
  /** Soft vignette multiplied over the board edges. */
  vignette: TextureRef;
  /** Resource token faces, keyed by type. */
  resourceToken: Record<ResourceType, TextureRef>;
  /** Player house sprite, keyed by seat colour. */
  house: Record<PlayerColor, TextureRef>;
  /** Neutral house used by the Trust faction (§13). */
  trustHouse: TextureRef;
  /** City node plate, drawn beneath the three house slots. */
  cityPlate: TextureRef;
  /** Radial glow used for hover and selection pulses. */
  radialGlow: TextureRef;
}

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

/** Deterministic value noise, so placeholder grain does not shimmer per reload. */
function grainTexture(size = 128): TextureRef {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 128 + ((seed >>> 24) - 128) * 0.18;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function radialGlowTexture(size = 256): TextureRef {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL();
}

function vignetteTexture(size = 512): TextureRef {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL();
}

function flatTexture(fill: string, size = 64): TextureRef {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL();
}

/** Simple faceted token: a lit dome over a darker rim, readable at small sizes. */
function tokenTexture(fill: string, rim: string, size = 64): TextureRef {
  const [c, ctx] = canvas(size, size);
  const r = size / 2 - 2;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = rim;
  ctx.fill();
  const g = ctx.createRadialGradient(size * 0.38, size * 0.34, r * 0.1, size / 2, size / 2, r);
  g.addColorStop(0, '#ffffff55');
  g.addColorStop(0.35, fill);
  g.addColorStop(1, rim);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r * 0.86, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  return c.toDataURL();
}

/** House silhouette in a seat colour, with a bevel so it reads on a busy board. */
function houseTexture(fill: string, size = 64): TextureRef {
  const [c, ctx] = canvas(size, size);
  const p = new Path2D();
  p.moveTo(size * 0.5, size * 0.14);
  p.lineTo(size * 0.86, size * 0.42);
  p.lineTo(size * 0.86, size * 0.86);
  p.lineTo(size * 0.14, size * 0.86);
  p.lineTo(size * 0.14, size * 0.42);
  p.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.translate(0, 2);
  ctx.fill(p);
  ctx.translate(0, -2);
  ctx.fillStyle = fill;
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke(p);
  return c.toDataURL();
}

const RESOURCE_FILL: Record<ResourceType, [string, string]> = {
  coal: ['#4a4a52', '#1d1d22'],
  oil: ['#2b2b33', '#0c0c10'],
  garbage: ['#c8a33a', '#6d551a'],
  uranium: ['#4ade5f', '#166b25'],
};

const SEAT_HEX: Record<PlayerColor, string> = {
  red: '#e8414a',
  blue: '#3d8bff',
  green: '#2fc46f',
  yellow: '#ffc93c',
  purple: '#b06bff',
  black: '#78889b',
};

let cached: ArtManifest | null = null;

/**
 * Resolves every texture the renderer needs. Called once during board boot;
 * the result is cached here so repeated calls are free.
 */
export async function loadArtManifest(): Promise<ArtManifest> {
  if (cached) return cached;
  const grain = grainTexture();
  cached = {
    boardBase: { germany: flatTexture('#101822'), usa: flatTexture('#101822') },
    paperGrain: grain,
    vignette: vignetteTexture(),
    resourceToken: {
      coal: tokenTexture(...RESOURCE_FILL.coal),
      oil: tokenTexture(...RESOURCE_FILL.oil),
      garbage: tokenTexture(...RESOURCE_FILL.garbage),
      uranium: tokenTexture(...RESOURCE_FILL.uranium),
    },
    house: Object.fromEntries(
      (Object.keys(SEAT_HEX) as PlayerColor[]).map((c) => [c, houseTexture(SEAT_HEX[c])]),
    ) as Record<PlayerColor, TextureRef>,
    trustHouse: houseTexture('#8a94a3'),
    cityPlate: flatTexture('#1b2634'),
    radialGlow: radialGlowTexture(),
  };
  return cached;
}

/* ------------------------------------------------------------------ *
 * Plant card art
 * ------------------------------------------------------------------ */

/**
 * Visual identity for a power plant card. The rulebook is explicit that
 * "the illustration on a plant card has no gameplay effect" (§1), so this is
 * purely presentational — but it must make the plant's fuel type readable at a
 * glance, because that IS load-bearing for play.
 */
export interface PlantArt {
  illustration: TextureRef;
  /** Dominant colour, used for the card frame and market sort bands. */
  accent: string;
  /** Short evocative name, e.g. "Lignite Boiler". Never used by rules logic. */
  title: string;
}

const PLANT_ACCENT: Record<string, [string, string]> = {
  coal: ['#8b6b4a', 'Coal Boiler'],
  oil: ['#5a6b8b', 'Oil Burner'],
  garbage: ['#b3922f', 'Refuse Incinerator'],
  uranium: ['#3fbf55', 'Fission Reactor'],
  hybrid: ['#a2764f', 'Hybrid Furnace'],
  eco: ['#46e2ff', 'Renewable Array'],
};

export function plantArt(plant: PowerPlant): PlantArt {
  const key =
    plant.accepts.length === 0
      ? 'eco'
      : plant.accepts.length > 1
        ? 'hybrid'
        : (plant.accepts[0] as string);
  const [accent, title] = PLANT_ACCENT[key] ?? PLANT_ACCENT.coal!;
  return { illustration: flatTexture(accent), accent, title };
}

/* ------------------------------------------------------------------ *
 * Palette bridge
 *
 * Design tokens live in SCSS. These read the resolved custom properties so
 * PixiJS (which cannot use CSS) draws in exactly the same colours as the DOM UI
 * — a hard requirement of QUALITY-BAR V5 "consistent art direction".
 * ------------------------------------------------------------------ */

/** Reads a CSS custom property off :root and returns it as a 0xRRGGBB number. */
export function cssColor(varName: string, fallback = 0xffffff): number {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  const full = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex;
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? fallback : n;
}

export interface SeatPalette {
  base: number;
  light: number;
  dark: number;
  glow: number;
}

export function seatPalette(color: PlayerColor): SeatPalette {
  return {
    base: cssColor(`--seat-${color}`, Number.parseInt(SEAT_HEX[color].slice(1), 16)),
    light: cssColor(`--seat-${color}-light`, 0xffffff),
    dark: cssColor(`--seat-${color}-dark`, 0x000000),
    glow: cssColor(`--seat-${color}-glow`, Number.parseInt(SEAT_HEX[color].slice(1), 16)),
  };
}

/**
 * Distinct sigil shape per seat, so colour is never the only channel carrying
 * player identity (QUALITY-BAR V3, colour-blind separability).
 */
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
