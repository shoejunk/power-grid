/**
 * Art module — the single source of visual assets for the board and game UI.
 *
 * CONTRACT. The exported names here are depended on by the board renderer
 * (`src/board/`) and the in-game UI (`src/game/`). Consumers import from
 * '@/art' only — never reach into sibling files. Signatures are frozen;
 * additions are fine, changes are not.
 *
 * HOW THE ART IS MADE
 * -------------------
 * Two pipelines, split on cost:
 *
 *   offline  The painted terrain plate. A per-pixel relief render — coastal
 *            distance fields, ridged multifractal elevation, linear-space
 *            lighting, blurred-elevation ambient occlusion — baked to PNG by
 *            `src/art/generate/build.mjs` and served from `public/art/`.
 *            Seconds of CPU: fine on a build machine, not on a game client.
 *
 *   runtime  Everything else. Generated into `data:` URIs with layered canvas
 *            drawing, so sprites can be driven by the live CSS custom
 *            properties in `tokens.scss` and follow a theme swap.
 *
 * Both are deterministic — seeded hashes, never `Math.random` — because art
 * that changes between reloads reads as a rendering bug.
 *
 * A `TextureRef` is a plain image URL or `data:` URI, so it drops straight into
 * an SVG `<image href>`, an SVG `<pattern>`, or a CSS `background-image`.
 */

import type { MapId, PlayerColor, PowerPlant, ResourceType } from '@pg/shared';
import { houseTexture, trustHouseTexture } from './houses';
import {
  cityPlateTexture,
  paperGrainTexture,
  radialGlowTexture,
  vignetteTexture,
} from './plates';
import { plantIllustration } from './plants';
import { hasDOM, linGrad, makeCanvas, safeTexture, BLANK } from './raster';
import { resourceTokenTexture } from './tokens';

/* ------------------------------------------------------------------ *
 * Texture handles
 * ------------------------------------------------------------------ */

export type TextureRef = string;

export interface ArtManifest {
  /** Painted terrain base for a map, sized to the map's aspect ratio. */
  boardBase: Record<MapId, TextureRef>;
  /**
   * Tiling grain overlaid on panels and the board to kill flatness.
   *
   * Seamless at its native 256 px. It is mid-grey, so composite it with
   * `mix-blend-mode: overlay` (or SVG `feBlend mode="overlay"`) at low opacity
   * — drawn with plain alpha it desaturates whatever is underneath instead of
   * just adding tooth.
   */
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

/**
 * Intrinsic pixel size of each baked board plate, for `<image>` sizing.
 *
 * Germany is baked at 2200x2820 (aspect 0.78, matching the map data) so it
 * still resolves on a HiDPI 2560 display without upscaling. Consumers should
 * size from these values rather than hard-coding dimensions.
 */
export const BOARD_BASE_SIZE: Record<MapId, { width: number; height: number }> = {
  germany: { width: 2200, height: 2820 },
  usa: { width: 1024, height: 661 },
};

/**
 * Where the offline pipeline writes its output.
 *
 * WebP, not PNG. The plate is a photographic relief render, so its bytes are
 * the terrain itself rather than compressible noise: as a lossless 24-bit PNG
 * it costs 4.87 MB, which is by far the largest asset in the build and delays
 * first paint of the board. WebP q90 lands the same 2200x2820 image at 504 KB
 * with no visible loss — smaller than the 214-colour indexed PNG it replaces,
 * and without that version's quantisation banding in the tint gradients.
 */
const BOARD_BASE_URL: Partial<Record<MapId, TextureRef>> = {
  germany: '/art/board-germany.webp',
};

/**
 * Stand-in plate for a map whose terrain has not been painted yet (currently
 * USA). Deliberately a lit, grained substrate rather than a flat fill, so a
 * missing plate degrades to "unfinished background" instead of "broken".
 */
function placeholderBoard(aspect: number, h = 512): TextureRef {
  const w = Math.round(h * aspect);
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = linGrad(ctx, 0, 0, w, h, [
    [0, '#101a24'],
    [0.5, '#0b131c'],
    [1, '#070c13'],
  ]);
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * 0.3, h * 0.24, 0, w * 0.3, h * 0.24, Math.max(w, h) * 0.8);
  g.addColorStop(0, 'rgba(70,120,160,0.14)');
  g.addColorStop(1, 'rgba(70,120,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL();
}

let cached: ArtManifest | null = null;

/**
 * Resolves every texture the renderer needs. Called once during board boot;
 * the result is cached here so repeated calls are free.
 *
 * Guaranteed total: every field is populated and nothing throws, even without
 * a DOM. A blank sprite is recoverable; a rejected promise during board boot
 * is not.
 */
export async function loadArtManifest(): Promise<ArtManifest> {
  if (cached) return cached;

  const seatHouse = (color: PlayerColor): TextureRef =>
    safeTexture(() => {
      const p = seatPalette(color);
      return houseTexture({ base: p.base, light: p.light, dark: p.dark, ink: p.ink }, seatSigil(color));
    });

  cached = {
    boardBase: {
      germany: BOARD_BASE_URL.germany ?? safeTexture(() => placeholderBoard(0.78)),
      usa: BOARD_BASE_URL.usa ?? safeTexture(() => placeholderBoard(1.55)),
    },
    paperGrain: safeTexture(() => paperGrainTexture(256, 0.10)),
    vignette: safeTexture(() => vignetteTexture(512)),
    resourceToken: {
      coal: safeTexture(() => resourceTokenTexture('coal')),
      oil: safeTexture(() => resourceTokenTexture('oil')),
      garbage: safeTexture(() => resourceTokenTexture('garbage')),
      uranium: safeTexture(() => resourceTokenTexture('uranium')),
    },
    house: {
      red: seatHouse('red'),
      blue: seatHouse('blue'),
      green: seatHouse('green'),
      yellow: seatHouse('yellow'),
      purple: seatHouse('purple'),
      black: seatHouse('black'),
    },
    trustHouse: safeTexture(() => trustHouseTexture()),
    cityPlate: safeTexture(() => cityPlateTexture(256)),
    radialGlow: safeTexture(() => radialGlowTexture(512)),
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

const PLANT_ACCENT_FALLBACK: Record<string, [string, string]> = {
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
  const [accent, title] = PLANT_ACCENT_FALLBACK[key] ?? PLANT_ACCENT_FALLBACK.coal!;

  if (!hasDOM()) return { illustration: BLANK, accent, title };
  try {
    return plantIllustration(plant);
  } catch {
    return { illustration: BLANK, accent, title };
  }
}

/* ------------------------------------------------------------------ *
 * Palette bridge
 *
 * Design tokens live in SCSS. These read the resolved custom properties so the
 * generated art draws in exactly the same colours as the DOM UI — a hard
 * requirement of QUALITY-BAR V5 "consistent art direction".
 * ------------------------------------------------------------------ */

/**
 * Fallback mirror of --tt-player-* in styles/tokens.scss, used when there is no
 * DOM to read the resolved custom properties from (SSR, unit tests, the asset
 * generator). Keep in lockstep with tokens.scss — those values are the output
 * of a CVD separation solve and must not drift.
 */
const SEAT_HEX: Record<PlayerColor, string> = {
  red: '#d3232d',
  blue: '#1f4cd0',
  green: '#3bc872',
  yellow: '#ffca46',
  purple: '#bf61c9',
  black: '#929ca7',
};

/**
 * Reads a CSS custom property off :root and returns it as a 0xRRGGBB number.
 *
 * Handles `#rgb`, `#rrggbb` and `rgb()/rgba()`. The rgba() case matters: the
 * glow tokens are authored as rgba() so the DOM can use their alpha, and a
 * hex-only parser silently falls back on every one of them.
 */
export function cssColor(varName: string, fallback = 0xffffff): number {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return parseCssColor(raw, fallback);
}

/** Exported for tests and for callers holding a literal rather than a var name. */
export function parseCssColor(raw: string, fallback = 0xffffff): number {
  if (!raw) return fallback;

  const rgb = raw.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, Math.round(Number(v))));
    return ((r! & 255) << 16) | ((g! & 255) << 8) | (b! & 255);
  }

  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    const full = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex.slice(0, 6);
    const n = Number.parseInt(full, 16);
    return Number.isNaN(n) ? fallback : n;
  }

  return fallback;
}

export interface SeatPalette {
  base: number;
  light: number;
  dark: number;
  glow: number;
  /** Foreground colour guaranteed legible on top of `base`. */
  ink: number;
}

/**
 * Seat colours resolved from the design tokens, so board and DOM cannot drift.
 *
 * The token names are `--tt-player-<colour>`; getting this prefix wrong makes
 * every lookup fall back silently, which is exactly the kind of bug that ships.
 */
export function seatPalette(color: PlayerColor): SeatPalette {
  const fallback = Number.parseInt(SEAT_HEX[color].slice(1), 16);
  return {
    base: cssColor(`--tt-player-${color}`, fallback),
    light: cssColor(`--tt-player-${color}-light`, 0xffffff),
    dark: cssColor(`--tt-player-${color}-dark`, 0x000000),
    glow: cssColor(`--tt-player-${color}-glow`, fallback),
    ink: cssColor(`--tt-player-${color}-ink`, 0xffffff),
  };
}

/** `#rrggbb` form of a resolved colour number, for canvas and SVG fills. */
export const toHex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

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

/**
 * The seat sigil as an SVG path `d` string on a unit circle centred at (0,0).
 * Lets the SVG board draw the same glyph the house sprite carries, at vector
 * resolution, without importing the canvas code.
 */
export function seatSigilPath(sigil: SeatSigil, r = 1): string {
  if (sigil === 'circle') {
    return `M ${-r} 0 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  const pts: [number, number][] =
    sigil === 'star'
      ? Array.from({ length: 10 }, (_, i) => {
          const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
          const rr = i % 2 === 0 ? r : r * 0.45;
          return [Math.cos(a) * rr, Math.sin(a) * rr];
        })
      : (() => {
          const n = sigil === 'triangle' ? 3 : sigil === 'hexagon' ? 6 : 4;
          const rot = sigil === 'square' ? -Math.PI / 4 : -Math.PI / 2;
          return Array.from({ length: n }, (_, i) => {
            const a = rot + (i / n) * Math.PI * 2;
            return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
          });
        })();
  return `M ${pts.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join(' L ')} Z`;
}

/* ------------------------------------------------------------------ *
 * Additive exports for the SVG board renderer
 * ------------------------------------------------------------------ */

export { boardDefs, BOARD_DEF_IDS } from './svg';
export { resourceAccent } from './tokens';
export { fuelKey, plantAccent } from './plants';
export type { FuelKey } from './plants';
