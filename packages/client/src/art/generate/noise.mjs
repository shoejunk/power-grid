/**
 * Deterministic procedural noise for the offline terrain painter.
 *
 * Everything here is seeded and integer-hashed — no Math.random anywhere — so
 * re-running the generator reproduces byte-identical output. That is a hard
 * requirement: the art must not shimmer or drift between builds.
 */

/* ---------- integer hashing ---------- */

export function hash2(x, y, seed) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/* ---------- gradient (simplex) noise ---------- */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Builds a permutation table from a seed (xorshift32 shuffle). */
function permTable(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = (seed | 0) || 1;
  for (let i = 255; i > 0; i--) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

/** Returns a simplex2 sampler in [-1,1] for the given seed. */
export function makeSimplex(seed) {
  const perm = permTable(seed);
  return function simplex2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = GRAD[perm[ii + perm[jj]] & 7];
      t0 *= t0;
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      t1 *= t1;
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      t2 *= t2;
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  };
}

/**
 * Fractal Brownian motion. `octaves` layers of simplex at doubling frequency
 * and halving amplitude — the workhorse for terrain, moisture and grain.
 */
export function makeFbm(seed, octaves = 6, lacunarity = 2.03, gain = 0.5) {
  const noise = makeSimplex(seed);
  let norm = 0;
  let a = 1;
  for (let o = 0; o < octaves; o++) { norm += a; a *= gain; }
  return (x, y) => {
    let sum = 0;
    let amp = 1;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(fx, fy);
      fx *= lacunarity;
      fy *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  };
}

/**
 * Ridged multifractal — 1-|n| folded and squared. This is what makes mountains
 * look like mountains (sharp crests, smooth valleys) instead of lumpy blobs.
 */
export function makeRidged(seed, octaves = 6, lacunarity = 2.07, gain = 0.5) {
  const noise = makeSimplex(seed);
  let norm = 0;
  let a = 1;
  for (let o = 0; o < octaves; o++) { norm += a; a *= gain; }
  return (x, y) => {
    let sum = 0;
    let amp = 1;
    let fx = x;
    let fy = y;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(noise(fx, fy));
      n *= n;
      n *= weight;
      weight = Math.min(1, Math.max(0, n * 2.4));
      sum += amp * n;
      fx *= lacunarity;
      fy *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  };
}

/* ---------- small helpers ---------- */

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Blender-style smootherstep; nicer falloff for lighting and washes. */
export const smootherstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
