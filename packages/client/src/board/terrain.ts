/**
 * Region geometry for the board.
 *
 * The *painted* artwork is not made here — that is the art module's job, and
 * the board draws its plate (`loadArtManifest().boardBase[mapId]`) as a single
 * image. What this module produces is the vector counterpart: crisp region
 * outlines traced with marching squares over a deterministic scalar field, so
 *
 *   · the ink seams between regions stay razor sharp at every zoom level
 *     instead of blurring along with the raster, and
 *   · the out-of-play scrim (§1) has an exact shape to clip to.
 *
 * The field is nearest-city assignment in a domain-warped space. Warping is
 * what stops the regions reading as a Voronoi debug diagram — the borders
 * wander like coastlines instead of running along straight bisectors.
 *
 * Nothing here touches `Math.random`; identical input gives identical geometry
 * on every client.
 */

import type { GameMap } from '@pg/shared';

import { BOARD_H, boardSpace, clamp, smoothstep } from './geometry';

/* ------------------------------------------------------------------ *
 * Deterministic value noise
 * ------------------------------------------------------------------ */

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** Fractal Brownian motion in [-1, 1]. */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(fx, fy, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.01;
  }
  return (sum / norm) * 2 - 1;
}

/* ------------------------------------------------------------------ *
 * The scalar field
 * ------------------------------------------------------------------ */

export interface FieldSample {
  /** Index into `map.areas`, or -1 for sea. */
  area: number;
  /** Distance to the nearest city, in board units. */
  d1: number;
  /** Distance from the border with the next-nearest *different* area. */
  edge: number;
}

interface FieldCity {
  x: number;
  y: number;
  area: number;
}

export interface TerrainField {
  width: number;
  height: number;
  seaDistance: number;
  sample: (x: number, y: number) => FieldSample;
}

const WARP_FREQ = 1 / 260;
const WARP_AMP = 26;

/**
 * Builds the nearest-city field for a map, accelerated by a coarse bucket grid
 * so a per-pixel raster pass costs ~10 distance tests instead of 42.
 */
export function buildField(map: GameMap): TerrainField {
  const space = boardSpace(map);
  const areaIndex = new Map(map.areas.map((a, i) => [a.id, i] as const));
  const cities: FieldCity[] = map.cities.map((c) => ({
    x: c.x * space.width,
    y: c.y * space.height,
    area: areaIndex.get(c.area) ?? 0,
  }));

  const CELL = 96;
  const NEAR = 12;
  const cols = Math.ceil(space.width / CELL) + 1;
  const rows = Math.ceil(space.height / CELL) + 1;
  const buckets: Int32Array = new Int32Array(cols * rows * NEAR).fill(-1);

  const order: { i: number; d: number }[] = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = (gx + 0.5) * CELL;
      const cy = (gy + 0.5) * CELL;
      order.length = 0;
      for (let i = 0; i < cities.length; i++) {
        const c = cities[i]!;
        order.push({ i, d: (c.x - cx) ** 2 + (c.y - cy) ** 2 });
      }
      order.sort((a, b) => a.d - b.d);
      const base = (gy * cols + gx) * NEAR;
      for (let k = 0; k < NEAR && k < order.length; k++) buckets[base + k] = order[k]!.i;
    }
  }

  // Land reaches this far past the outermost cities before it becomes sea.
  const seaDistance = 0.082 * (space.width + space.height) * 0.5 + 26;

  const sample = (x: number, y: number): FieldSample => {
    const wx = x + fbm(x * WARP_FREQ, y * WARP_FREQ, 11) * WARP_AMP;
    const wy = y + fbm(x * WARP_FREQ + 53.1, y * WARP_FREQ + 91.7, 29) * WARP_AMP;

    const gx = clamp(Math.floor(x / CELL), 0, cols - 1);
    const gy = clamp(Math.floor(y / CELL), 0, rows - 1);
    const base = (gy * cols + gx) * NEAR;

    let d1 = Infinity;
    let a1 = -1;
    let d2 = Infinity;
    for (let k = 0; k < NEAR; k++) {
      const idx = buckets[base + k]!;
      if (idx < 0) break;
      const c = cities[idx]!;
      const d = Math.hypot(c.x - wx, c.y - wy);
      if (d < d1) {
        if (c.area !== a1) d2 = Math.min(d2, d1);
        d1 = d;
        a1 = c.area;
      } else if (c.area !== a1 && d < d2) {
        d2 = d;
      }
    }
    return {
      area: d1 > seaDistance ? -1 : a1,
      d1,
      edge: Number.isFinite(d2) ? d2 - d1 : 999,
    };
  };

  return { width: space.width, height: space.height, seaDistance, sample };
}

/* ------------------------------------------------------------------ *
 * Region rasters
 *
 * The regions are rasterised rather than traced as polygons. Marching squares
 * looked attractive — crisp vector seams at any zoom — but an area that wraps
 * around another produces nested loops whose winding cancels under either fill
 * rule, and Germany's six areas ended up covering barely a third of the board
 * as a result. A raster of the field cannot have that class of bug: every
 * pixel is assigned exactly once, so coverage is total by construction.
 *
 * It also looks better. A washed raster gives the regions soft, painterly
 * edges that sit *in* the plate's brushwork, where a hard vector boundary sat
 * on top of it. The crisp structure on this board comes from the routes, the
 * cost badges and the nameplates — the regions are meant to read as pigment.
 * ------------------------------------------------------------------ */

export interface RegionRaster {
  /** Region hues, composited over the painted plate. */
  tint: string;
  /** Out-of-play treatment: drained, darkened and hatched (§1). */
  scrim: string;
  /** Visual centre of each area, in board units, for region labels. */
  centroids: Record<string, { x: number; y: number }>;
  /** True when at least one area is out of play. */
  hasScrim: boolean;
}

/**
 * Longest edge of the generated rasters, in pixels. Sized so the tint still
 * holds together at maximum zoom without making the one-off generation cost
 * (~10 nearest-city tests per pixel) noticeable on mount.
 */
const REGION_RASTER_MAX = 960;

const regionCache = new Map<string, RegionRaster>();

export function regionRasters(map: GameMap, zone: readonly string[]): RegionRaster {
  const cacheKey = `${map.id}|${[...zone].sort().join(',')}`;
  const cached = regionCache.get(cacheKey);
  if (cached) return cached;

  const field = buildField(map);
  const aspect = map.aspectRatio;
  const W = Math.max(2, Math.round(aspect >= 1 ? REGION_RASTER_MAX : REGION_RASTER_MAX * aspect));
  const H = Math.max(2, Math.round(aspect >= 1 ? REGION_RASTER_MAX / aspect : REGION_RASTER_MAX));
  const sx = field.width / W;
  const sy = field.height / H;

  const rgb = map.areas.map((a) => {
    const raw = a.color.replace('#', '');
    const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
    const n = Number.parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  });
  const inZone = map.areas.map((a) => zone.includes(a.id));

  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] | null => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    return ctx ? [c, ctx] : null;
  };
  const tintPair = make();
  const scrimPair = make();
  if (!tintPair || !scrimPair) {
    return { tint: '', scrim: '', centroids: {}, hasScrim: false };
  }

  const areaAt = new Int8Array(W * H);
  const coastAt = new Float32Array(W * H);
  /** Distance from the border with the nearest other area, in board units. */
  const edgeAt = new Float32Array(W * H);
  const sums = map.areas.map(() => ({ x: 0, y: 0, n: 0 }));

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const s = field.sample(px * sx, py * sy);
      const i = py * W + px;
      areaAt[i] = s.area;
      // Feather the last stretch before the coast so the wash fades out
      // rather than ending on a hard rim.
      coastAt[i] = s.area < 0 ? 0 : clamp((field.seaDistance - s.d1) / 44, 0, 1);
      edgeAt[i] = s.edge;
      if (s.area >= 0) {
        const acc = sums[s.area];
        if (acc) {
          acc.x += px * sx;
          acc.y += py * sy;
          acc.n++;
        }
      }
    }
  }

  const tintImg = tintPair[1].createImageData(W, H);
  const scrimImg = scrimPair[1].createImageData(W, H);
  const t = tintImg.data;
  const k = scrimImg.data;

  /*
   * Region identity is carried by a tinted RIM, not by flooding the fill.
   *
   * A full-chroma wash over the whole region is a direct QUALITY-BAR V3
   * failure: it puts a red ground under the red seat's houses, a blue ground
   * under blue's, and so on, and no keyline or sigil fully recovers a fill
   * colour that has been neutralised by an identically-hued background. So the
   * area colour runs at full strength only in a band along each border, and
   * decays to a near-neutral whisper across the interior — which is where the
   * houses actually sit.
   */
  const RIM_UNITS = 78;
  const INTERIOR_ALPHA = 0.13;
  const RIM_ALPHA = 0.74;
  const INTERIOR_DESAT = 0.66;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const area = areaAt[i]!;
      if (area < 0) continue;
      const o = i * 4;

      const colour = rgb[area] ?? { r: 128, g: 128, b: 128 };
      const feather = coastAt[i]!;
      // `edge` is already the distance from the border with the nearest other
      // area, so the rim ramp comes for free.
      const rim = 1 - smoothstep(0, RIM_UNITS, edgeAt[i]!);

      const lum = colour.r * 0.299 + colour.g * 0.587 + colour.b * 0.114;
      const desat = INTERIOR_DESAT * (1 - rim);
      const r = colour.r + (lum - colour.r) * desat;
      const g = colour.g + (lum - colour.g) * desat;
      const b = colour.b + (lum - colour.b) * desat;

      t[o] = r;
      t[o + 1] = g;
      t[o + 2] = b;
      t[o + 3] = 255 * feather * (INTERIOR_ALPHA + (RIM_ALPHA - INTERIOR_ALPHA) * rim);

      if (!inZone[area]) {
        // §1: unusable for the entire game. Drained, dimmed and hatched.
        const hatch = (px + py) % 9 < 3 ? 1 : 0;
        k[o] = 24 + hatch * 8;
        k[o + 1] = 30 + hatch * 9;
        k[o + 2] = 39 + hatch * 11;
        k[o + 3] = (192 + hatch * 44) * feather;
      }
    }
  }

  tintPair[1].putImageData(tintImg, 0, 0);
  scrimPair[1].putImageData(scrimImg, 0, 0);

  const centroids: Record<string, { x: number; y: number }> = {};
  map.areas.forEach((a, i) => {
    const acc = sums[i];
    centroids[a.id] =
      acc && acc.n > 0
        ? { x: acc.x / acc.n, y: acc.y / acc.n }
        : { x: field.width / 2, y: BOARD_H / 2 };
  });

  const out: RegionRaster = {
    tint: tintPair[0].toDataURL(),
    scrim: scrimPair[0].toDataURL(),
    centroids,
    hasScrim: inZone.some((v) => !v),
  };
  if (regionCache.size > 8) regionCache.clear();
  regionCache.set(cacheKey, out);
  return out;
}

