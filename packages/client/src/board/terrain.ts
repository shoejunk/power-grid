/**
 * Painted terrain generation.
 *
 * QUALITY-BAR V2 requires the board to read as painted artwork with texture,
 * depth and lighting — "not flat fills". Two artefacts come out of this module,
 * and the board uses both:
 *
 *  1. `paintTerrain()` — a raster, embedded as a single `<image>`. It carries
 *     everything that *should* be soft: pigment mottling, hill-shading from a
 *     real height field, coastline, sea contours, paper grain. Rasterising it
 *     once means pan/zoom is a single image transform rather than thousands of
 *     filtered vector ops, which is what keeps M6 (60 fps) achievable.
 *  2. `areaOutlines()` — crisp vector borders for the same regions, traced with
 *     marching squares off the identical scalar field, so the ink lines stay
 *     razor sharp at every zoom level and the out-of-zone scrim (§1) has an
 *     exact shape to clip to.
 *
 * Both are derived from one deterministic field: nearest-city assignment in a
 * domain-warped space. Warping is what stops the regions looking like a Voronoi
 * debug diagram — the borders wander like coastlines instead of running in
 * straight bisectors.
 *
 * Nothing here touches `Math.random`; identical input gives identical art on
 * every client.
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
 * Colour helpers
 * ------------------------------------------------------------------ */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

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
 * Raster: the painted backdrop
 * ------------------------------------------------------------------ */

/** Longest edge of the generated raster, in device pixels. */
const RASTER_MAX = 1280;

const rasterCache = new Map<string, string>();

/**
 * Paints the board backdrop and returns it as a `data:` URI.
 *
 * Deliberately synchronous and cached: it costs ~120-220 ms once per map, and
 * the caller runs it off the first paint so nothing blocks.
 */
export function paintTerrain(map: GameMap): string {
  const cached = rasterCache.get(map.id);
  if (cached) return cached;

  const field = buildField(map);
  const aspect = map.aspectRatio;
  const W = Math.round(aspect >= 1 ? RASTER_MAX : RASTER_MAX * aspect);
  const H = Math.round(aspect >= 1 ? RASTER_MAX / aspect : RASTER_MAX);
  const sx = field.width / W;
  const sy = field.height / H;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const areaRgb = map.areas.map((a) => hexToRgb(a.color));

  /* --- pass 1: height field, so lighting has real normals to work with --- */
  const height = new Float32Array(W * H);
  const areaAt = new Int8Array(W * H);
  const edgeAt = new Float32Array(W * H);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = px * sx;
      const y = py * sy;
      const s = field.sample(x, y);
      const i = py * W + px;
      areaAt[i] = s.area;
      edgeAt[i] = s.edge;

      const coast = smoothstep(field.seaDistance, field.seaDistance - 34, s.d1);
      const ridge = smoothstep(0, 58, s.edge);
      const detail = fbm(x / 46, y / 46, 7, 5) * 0.5 + fbm(x / 13, y / 13, 61, 3) * 0.16;
      height[i] =
        s.area < 0
          ? -0.55 + detail * 0.1
          : coast * (0.55 + 0.45 * ridge) + detail * 0.34;
    }
  }

  /* --- pass 2: shade and paint --- */
  const img = ctx.createImageData(W, H);
  const data = img.data;
  // Key light from the upper left, the convention every painted board uses.
  const LX = -0.62;
  const LY = -0.72;
  const LZ = 0.52;
  const shadeScale = 210 / RASTER_MAX;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const xm = px > 0 ? i - 1 : i;
      const xp = px < W - 1 ? i + 1 : i;
      const ym = py > 0 ? i - W : i;
      const yp = py < H - 1 ? i + W : i;
      const dhx = (height[xp]! - height[xm]!) / shadeScale;
      const dhy = (height[yp]! - height[ym]!) / shadeScale;
      const nl = Math.hypot(dhx, dhy, 1) || 1;
      const lambert = clamp((-dhx * LX + -dhy * LY + LZ) / nl, 0, 1.35);

      const area = areaAt[i]!;
      const edge = edgeAt[i]!;
      const x = px * sx;
      const y = py * sy;

      let r: number;
      let g: number;
      let b: number;

      if (area < 0) {
        /* --- sea: deep slate with faint bathymetric rings --- */
        const depth = smoothstep(0, 130, field.sample(x, y).d1 - field.seaDistance);
        const ringPhase = ((field.sample(x, y).d1 - field.seaDistance) / 30) % 1;
        const ring = Math.pow(1 - Math.abs(ringPhase * 2 - 1), 8) * 0.16;
        const churn = fbm(x / 70, y / 70, 133, 4) * 0.5 + 0.5;
        r = mix(20, 8, depth) + ring * 44 + churn * 7;
        g = mix(33, 15, depth) + ring * 58 + churn * 9;
        b = mix(46, 24, depth) + ring * 70 + churn * 12;
      } else {
        const base = areaRgb[area] ?? { r: 120, g: 120, b: 120 };

        // Painterly pigment variation at two scales.
        const mottleA = fbm(x / 96, y / 96, 3, 4);
        const mottleB = fbm(x / 24, y / 24, 41, 3);
        const pigment = 1 + mottleA * 0.17 + mottleB * 0.075;

        // Regions are lighter in their interior and sink into ink at the seams.
        const interior = smoothstep(0, 74, edge);
        const seam = smoothstep(0, 9, edge);

        r = base.r * pigment;
        g = base.g * pigment;
        b = base.b * pigment;

        // Warm the interior toward parchment, cool the rim toward slate.
        r = mix(r * 0.62 + 30, r * 0.92 + 42, interior);
        g = mix(g * 0.62 + 34, g * 0.92 + 44, interior);
        b = mix(b * 0.62 + 42, b * 0.92 + 48, interior);

        // Ink seep along the border.
        const ink = 0.34 + 0.66 * seam;
        r *= ink;
        g *= ink;
        b *= ink;

        // Coastal sand rim where the land meets the sea.
        const shore = smoothstep(field.seaDistance - 16, field.seaDistance, field.sample(x, y).d1);
        r = mix(r, 118, shore * 0.5);
        g = mix(g, 108, shore * 0.5);
        b = mix(b, 88, shore * 0.5);

        const light = 0.58 + 0.62 * lambert;
        r *= light;
        g *= light;
        b *= light;
      }

      // Paper grain, deterministic so the board never shimmers.
      const grain = (hash2(px, py, 909) - 0.5) * 13;
      data[i * 4] = clamp(r + grain, 0, 255);
      data[i * 4 + 1] = clamp(g + grain, 0, 255);
      data[i * 4 + 2] = clamp(b + grain, 0, 255);
      data[i * 4 + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  // A gentle vignette so the board sits in its frame instead of floating.
  const vg = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(2,5,9,0.62)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const url = canvas.toDataURL('image/jpeg', 0.9);
  rasterCache.set(map.id, url);
  return url;
}

/* ------------------------------------------------------------------ *
 * Vector: region outlines via marching squares
 * ------------------------------------------------------------------ */

type Loop = { x: number; y: number }[];

const key = (x: number, y: number): string => `${Math.round(x * 4)}:${Math.round(y * 4)}`;

/**
 * Marching squares over a boolean grid, producing closed loops in board units.
 * The standard 16-case table, with the two ambiguous saddles resolved
 * consistently (case 5 / 10) so loops always close.
 */
function marchingSquares(
  inside: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
): Loop[] {
  const segs: [number, number, number, number][] = [];
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : inside[y * cols + x]!);

  for (let y = -1; y < rows; y++) {
    for (let x = -1; x < cols; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;

      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      const N: [number, number] = [cx + cell / 2, cy];
      const E: [number, number] = [cx + cell, cy + cell / 2];
      const S: [number, number] = [cx + cell / 2, cy + cell];
      const Wp: [number, number] = [cx, cy + cell / 2];
      const push = (a: [number, number], b: [number, number]): void => {
        segs.push([a[0], a[1], b[0], b[1]]);
      };

      switch (code) {
        case 1: push(Wp, S); break;
        case 2: push(S, E); break;
        case 3: push(Wp, E); break;
        case 4: push(N, E); break;
        case 5: push(Wp, N); push(S, E); break;
        case 6: push(N, S); break;
        case 7: push(Wp, N); break;
        case 8: push(N, Wp); break;
        case 9: push(N, S); break;
        case 10: push(N, E); push(S, Wp); break;
        case 11: push(N, E); break;
        case 12: push(E, Wp); break;
        case 13: push(E, S); break;
        case 14: push(S, Wp); break;
        default: break;
      }
    }
  }

  /* Chain the segments into loops by matching endpoints. */
  const starts = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const k = key(s[0], s[1]);
    const list = starts.get(k);
    if (list) list.push(i);
    else starts.set(k, [i]);
  });

  const used = new Array<boolean>(segs.length).fill(false);
  const loops: Loop[] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const first = segs[i]!;
    const loop: Loop = [{ x: first[0], y: first[1] }, { x: first[2], y: first[3] }];
    let cursor = key(first[2], first[3]);

    for (let guard = 0; guard < segs.length + 4; guard++) {
      const candidates = starts.get(cursor);
      let next = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!used[c]) {
            next = c;
            break;
          }
        }
      }
      if (next < 0) break;
      used[next] = true;
      const s = segs[next]!;
      loop.push({ x: s[2], y: s[3] });
      cursor = key(s[2], s[3]);
    }
    if (loop.length > 6) loops.push(loop);
  }

  return loops;
}

/** Chaikin corner-cutting: turns the stair-stepped march into a smooth curve. */
function chaikin(loop: Loop, iterations: number): Loop {
  let pts = loop;
  for (let n = 0; n < iterations; n++) {
    const out: Loop = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

function loopToPath(loop: Loop): string {
  if (loop.length < 3) return '';
  let d = `M${loop[0]!.x.toFixed(1)} ${loop[0]!.y.toFixed(1)}`;
  for (let i = 1; i < loop.length; i++) d += `L${loop[i]!.x.toFixed(1)} ${loop[i]!.y.toFixed(1)}`;
  return `${d}Z`;
}

export interface AreaOutline {
  areaId: string;
  /** One `d` string covering every loop belonging to the area. */
  d: string;
  /** Visual centre, for the region nameplate. */
  centroid: { x: number; y: number };
}

const outlineCache = new Map<string, AreaOutline[]>();

/**
 * Traces every region boundary off the same field the raster uses, so the ink
 * lines land exactly on the painted seams.
 */
export function areaOutlines(map: GameMap): AreaOutline[] {
  const cached = outlineCache.get(map.id);
  if (cached) return cached;

  const field = buildField(map);
  const CELL = 7;
  const cols = Math.ceil(field.width / CELL) + 2;
  const rows = Math.ceil(field.height / CELL) + 2;

  const grid = new Int8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      grid[y * cols + x] = field.sample((x + 0.5) * CELL, (y + 0.5) * CELL).area;
    }
  }

  const inside = new Uint8Array(cols * rows);
  const out: AreaOutline[] = map.areas.map((area, index) => {
    for (let i = 0; i < grid.length; i++) inside[i] = grid[i] === index ? 1 : 0;
    const loops = marchingSquares(inside, cols, rows, CELL)
      .map((l) => chaikin(l, 2))
      .filter((l) => l.length > 20);

    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const l of loops) {
      for (const p of l) {
        sx += p.x;
        sy += p.y;
        n++;
      }
    }
    return {
      areaId: area.id,
      d: loops.map(loopToPath).join(' '),
      centroid: n > 0 ? { x: sx / n, y: sy / n } : { x: field.width / 2, y: BOARD_H / 2 },
    };
  });

  outlineCache.set(map.id, out);
  return out;
}
