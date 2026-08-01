/**
 * Runtime drawing kit shared by every generated sprite.
 *
 * Sprites (houses, resource tokens, plates, plant illustrations) are generated
 * in-browser rather than shipped as files, because they are driven by the live
 * CSS custom properties in `tokens.scss` — swap the theme and the artwork
 * follows. Only the board terrain, which is far too expensive per pixel, is
 * baked offline.
 *
 * Everything here is deterministic. No `Math.random`, ever: a sprite that
 * changes between reloads reads as a rendering bug.
 */

/* ------------------------------------------------------------------ *
 * canvas
 * ------------------------------------------------------------------ */

export type Ctx = CanvasRenderingContext2D;

export const hasDOM = (): boolean => typeof document !== 'undefined';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/** 1x1 transparent PNG — the never-throw fallback for every generator. */
export const BLANK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Runs a generator and guarantees a usable TextureRef. `loadArtManifest()` is
 * contractually not allowed to throw, and a half-drawn board is still better
 * than a crashed one.
 */
export function safeTexture(fn: () => string): string {
  try {
    if (!hasDOM()) return BLANK;
    return fn();
  } catch {
    return BLANK;
  }
}

/* ------------------------------------------------------------------ *
 * colour
 * ------------------------------------------------------------------ */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const numToRgb = (n: number): RGB => ({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });

export const css = (c: RGB, a = 1): string =>
  a >= 1 ? `rgb(${c.r | 0},${c.g | 0},${c.b | 0})` : `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${a})`;

export const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** Perceptual-ish lighten/darken. Positive lifts toward white, negative to black. */
export const shade = (c: RGB, amt: number): RGB =>
  amt >= 0 ? mix(c, WHITE, amt) : mix(c, BLACK, -amt);

/** Relative luminance (WCAG), used to pick readable ink over a seat colour. */
export function luminance(c: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Pushes a colour toward a target hue-ish tint without killing its identity. */
export function tint(c: RGB, target: RGB, t: number): RGB {
  return mix(c, target, t);
}

/* ------------------------------------------------------------------ *
 * deterministic noise
 * ------------------------------------------------------------------ */

export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise with smootherstep interpolation. Cheap and good enough at sprite scale. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function fbm(x: number, y: number, seed: number, octaves = 4, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(fx, fy, seed + o * 977) * amp;
    norm += amp;
    amp *= gain;
    fx *= 2.03;
    fy *= 2.03;
  }
  return sum / norm;
}

/** A tiny deterministic PRNG for per-sprite composition variety. */
export function rng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * reusable texture patterns
 * ------------------------------------------------------------------ */

let grainPattern: CanvasPattern | null = null;
let grainTile: HTMLCanvasElement | null = null;

/**
 * A seamlessly tiling grain tile. Tileability comes from the wrap-blend trick:
 * the noise field is cross-faded with copies of itself offset by one tile in
 * each direction, so opposite edges are identical by construction.
 */
export function makeGrainTile(size = 128, seed = 991, contrast = 26): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = 8 / size;
      const wx = x * f;
      const wy = y * f;
      const s = size * f;
      // wrap blend
      const n =
        (fbm(wx, wy, seed, 4) * (s - wx) * (s - wy) +
          fbm(wx - s, wy, seed, 4) * wx * (s - wy) +
          fbm(wx, wy - s, seed, 4) * (s - wx) * wy +
          fbm(wx - s, wy - s, seed, 4) * wx * wy) /
        (s * s);
      // fine speckle on top, also wrapped (integer hash is periodic on `size`)
      const sp = hash2(x, y, seed + 7) - 0.5;
      const v = 128 + (n - 0.5) * contrast * 2 + sp * contrast * 0.9;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

export function grain(ctx: Ctx, w: number, h: number, alpha: number, mode: GlobalCompositeOperation = 'overlay'): void {
  if (!grainPattern) grainPattern = ctx.createPattern(makeGrainTile(), 'repeat');
  if (!grainPattern) return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * drawing helpers
 * ------------------------------------------------------------------ */

/** Builds a Path2D from normalised [0..1] points scaled into a box. */
export function poly(pts: [number, number][], w: number, h: number, ox = 0, oy = 0): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => {
    const px = ox + x * w;
    const py = oy + y * h;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  });
  p.closePath();
  return p;
}

/** Rounded rectangle as a Path2D (avoids relying on ctx.roundRect support). */
export function roundRect(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  p.closePath();
  return p;
}

/** Linear gradient between two points, from a stop list. */
export function linGrad(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: [number, string][],
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [p, c] of stops) g.addColorStop(p, c);
  return g;
}

export function radGrad(
  ctx: Ctx,
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  stops: [number, string][],
): CanvasGradient {
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [p, c] of stops) g.addColorStop(p, c);
  return g;
}

/**
 * Draws a shape with an inner bevel: a light stroke on the light-facing edge
 * and a dark stroke opposite, clipped to the shape. This is what gives a flat
 * fill physical thickness (QUALITY-BAR V6).
 */
export function bevel(
  ctx: Ctx,
  path: Path2D,
  width: number,
  light: string,
  dark: string,
  dx = -1,
  dy = -1,
): void {
  ctx.save();
  ctx.clip(path);
  ctx.lineWidth = width * 2;
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.translate(dx * width * 0.8, dy * width * 0.8);
  ctx.strokeStyle = light;
  ctx.stroke(path);
  ctx.restore();

  ctx.save();
  ctx.translate(-dx * width * 0.8, -dy * width * 0.8);
  ctx.strokeStyle = dark;
  ctx.stroke(path);
  ctx.restore();

  ctx.restore();
}

/** Soft drop shadow under a path, drawn as an offset blurred copy. */
export function dropShadow(
  ctx: Ctx,
  path: Path2D,
  blurPx: number,
  dx: number,
  dy: number,
  color = 'rgba(0,0,0,0.62)',
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blurPx;
  ctx.shadowOffsetX = dx;
  ctx.shadowOffsetY = dy;
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fill(path);
  ctx.restore();
}

/**
 * The dark keyline every board sprite needs. On a painted, high-frequency
 * board a coloured shape with no outline dissolves; a contrasting keyline is
 * what keeps a 20 px house readable.
 */
export function keyline(ctx: Ctx, path: Path2D, width: number, color = 'rgba(4,8,12,0.92)'): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke(path);
  ctx.restore();
}
