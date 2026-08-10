/**
 * The painted terrain renderer.
 *
 * This is deliberately a *relief-painting* pipeline, not a "flat fill + noise"
 * shortcut — QUALITY-BAR V2 fails anything that reads as the latter. The order
 * of operations mirrors how a matte painter would build the plate:
 *
 *   1. landmask + signed distance field to the coast
 *   2. elevation field   — regional tilt, ridge envelopes, ridged multifractal,
 *                          fbm detail, river incision
 *   3. albedo            — hypsometric ramp x moisture, slope-driven rock,
 *                          macro patchwork variation, brushwork
 *   4. lighting          — Lambert key (warm) + hemispheric sky (cool) + rim,
 *                          computed in LINEAR light, plus a blurred-elevation
 *                          ambient-occlusion term so valleys sit in shadow
 *   5. water             — shelf-to-abyss depth ramp, current striations,
 *                          shoal band and a broad specular sheen
 *   6. finishing         — region wash, coastline ink, warm/cool grade, canvas
 *                          tooth, edge falloff
 *   7. plate levels      — the whole render squeezed into a narrow, light
 *                          value band with its chroma pulled back
 *
 * Step 7 is the one to read first if you are here to change how the board
 * looks. Steps 1-6 are about what the terrain IS; step 7 is about what the
 * plate is FOR. It is a supporting surface: six saturated seat colours, three
 * house slots per city and ~83 connection-cost badges sit on top of it, and
 * the plate's only real job is that none of them can get lost in it. Every
 * time this file has drifted, it has drifted by letting steps 1-6 spend value
 * and chroma that step 7 then has to claw back.
 *
 * `build.mjs` prints the numbers that decide it — land value mean, its
 * p10..p90 spread, and the Alpine shadow colour. Tune against those.
 *
 * Everything is seeded. Two runs produce identical bytes.
 */

import { makeFbm, makeRidged, makeSimplex, clamp, lerp, smoothstep, smootherstep } from './noise.mjs';
import { PROJECTION } from './geo.mjs';

/* ------------------------------------------------------------------ *
 * colour utilities — lighting is done in linear space, which is the
 * difference between "painted" and "muddy".
 * ------------------------------------------------------------------ */

const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** linear -> sRGB, as 0..1. Perceptual space: where value decisions belong. */
const l2s01 = (v) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;

/** '#rrggbb' -> linear [r,g,b] */
function hexLin(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [S2L[(n >> 16) & 255], S2L[(n >> 8) & 255], S2L[n & 255]];
}
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Samples a stop list [[pos, linRGB], ...] */
function ramp(stops, t) {
  t = clamp(t);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      return mix3(c0, c1, smoothstep(p0, p1, t));
    }
  }
  return stops[stops.length - 1][1];
}

/* ------------------------------------------------------------------ *
 * exact euclidean distance transform (Felzenszwalb & Huttenlocher)
 * ------------------------------------------------------------------ */

const INF = 1e20;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared-distance transform of a field where 0 = seed, INF = free. */
function edt2d(grid, w, h) {
  const size = Math.max(w, h);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size + 1);
  const z = new Float64Array(size + 2);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
  return grid;
}

/* ------------------------------------------------------------------ *
 * polygon rasterisation
 * ------------------------------------------------------------------ */

/** Scanline-fills a closed polygon given in [0,1] space. */
function fillPoly(mask, w, h, poly, value) {
  const pts = poly.map(([x, y]) => [x * w, y * h]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi <= cy ? yj > cy : yj <= cy) {
        xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx = Math.max(0, Math.ceil(xs[k] - 0.5));
      const ex = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      const row = y * w;
      for (let x = sx; x <= ex; x++) mask[row + x] = value;
    }
  }
}

/* ------------------------------------------------------------------ *
 * geometry helpers
 * ------------------------------------------------------------------ */

/** Catmull-Rom resample of a polyline, so coastlines curve instead of kinking. */
function smoothPath(pts, subdiv = 8, closed = false) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const at = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/**
 * Fractal midpoint displacement along a path normal. Real coastlines are
 * fractal; a smoothed political outline alone looks like clip art.
 */
function roughen(pts, simplex, amp, freq, closed = false) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const d =
      simplex(p[0] * freq, p[1] * freq) * amp +
      simplex(p[0] * freq * 2.7 + 11.3, p[1] * freq * 2.7 - 4.1) * amp * 0.45 +
      simplex(p[0] * freq * 6.1 - 3.7, p[1] * freq * 6.1 + 9.4) * amp * 0.2;
    return [p[0] - dy * d, p[1] + dx * d];
  });
}

/** Distance (in normalised units) from a point to a polyline, bbox-culled. */
function polylineStamp(w, h, pts, radius, cb) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius) * w));
    const x1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + radius) * w));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - radius) * h));
    const y1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + radius) * h));
    const vx = bx - ax;
    const vy = by - ay;
    const vv = vx * vx + vy * vy || 1e-9;
    for (let y = y0; y <= y1; y++) {
      const py = (y + 0.5) / h;
      for (let x = x0; x <= x1; x++) {
        const px = (x + 0.5) / w;
        let t = ((px - ax) * vx + (py - ay) * vy) / vv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (ax + t * vx);
        const dy = py - (ay + t * vy);
        const d = Math.hypot(dx, dy);
        if (d < radius) cb(y * w + x, d, dx, dy);
      }
    }
  }
}

/** Separable box blur, run three times ≈ gaussian. Used for the AO term. */
function blur(src, w, h, r, passes = 3) {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc -= a[row + clamp(x - r, 0, w - 1)];
        acc += a[row + clamp(x + r + 1, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc -= b[clamp(y - r, 0, h - 1) * w + x];
        acc += b[clamp(y + r + 1, 0, h - 1) * w + x];
      }
    }
  }
  return a;
}

/* ------------------------------------------------------------------ *
 * palettes
 *
 * THIS PLATE IS A SUPPORTING SURFACE, NOT A HERO IMAGE. Six saturated seat
 * colours, three house slots per city and ~83 connection-cost badges sit on
 * top of it. Everything below is chosen so that nothing placed on the board
 * can sink into it:
 *
 *   - held in a narrow, LIGHT mid band. The dark seats — black #78889b and
 *     purple #b06bff — are the ones at risk, and they are only at risk over a
 *     dark ground. An understated board beats a board where a player cannot
 *     find their house.
 *   - low chroma. The old ramps were a muddy green-brown; these are a
 *     desaturated sage/oatmeal that reads as ground without competing with
 *     any seat hue.
 *   - the value SPREAD inside the ramp is small. Hue and texture carry the
 *     terrain story; value is reserved for the pieces on top.
 * ------------------------------------------------------------------ */

const WET_RAMP = [
  [0.00, hexLin('#5d6b5d')], // marsh / river plain — cool, slightly blue green
  [0.09, hexLin('#65735c')], // lowland pasture
  [0.20, hexLin('#6e7a5f')], // rolling farmland — the dominant board colour
  [0.34, hexLin('#747d61')], // mixed arable
  [0.50, hexLin('#787d64')], // hill country, olive
  [0.64, hexLin('#7c7d69')], // upland heath
  [0.76, hexLin('#828071')], // treeline
  [0.87, hexLin('#8d897c')], // bare rock
  [0.95, hexLin('#a5a096')], // scree
  [1.00, hexLin('#d6d8d4')], // snow
];

const DRY_RAMP = [
  [0.00, hexLin('#6f6a5b')],
  [0.14, hexLin('#787059')],
  [0.32, hexLin('#7f755d')],
  [0.50, hexLin('#867a62')],
  [0.68, hexLin('#8a8069')],
  [0.82, hexLin('#8f8877')],
  [0.92, hexLin('#9c968c')],
  [1.00, hexLin('#d2d4d2')],
];

const ROCK = hexLin('#8d877c');
// Forest is the single biggest darkener on the plate — it covers most of the
// south. Kept as a HUE shift with only a little value drop, not a black hole.
const FOREST = hexLin('#4c5b4c');
const SEA_SHELF = hexLin('#2b4756');
const SEA_MID = hexLin('#233c49');
const SEA_DEEP = hexLin('#1a2f3a');
const FOAM = hexLin('#4f7481');
/*
 * Rivers are blended in as a fixed colour, NOT multiplied by the key light, so
 * their value has to be set against the lit land rather than against the
 * ramps. Lifting this with the rest of the palette made the Rhine and the
 * Danube read brighter than their banks — ice, not water. Held ~20 levels
 * under the land median so they stay legibly incised.
 */
const RIVER = hexLin('#2a4450');

/* ---- plate levels (see the PLATE LEVELS block at the end of the paint) ----
 * Every one of these is a readability control, not a taste control. The
 * numbers the build prints — value mean / p10 / p90 — are the acceptance
 * signal: land wants a mean near 115 and a p10..p90 spread under ~55. */
const IN_LO = 0.04; // raw render's black point ...
const IN_HI = 0.55; // ... and its white point, in perceptual 0..1
const LAND_FLOOR = 0.285; // darkest a land pixel may go
const LAND_CEIL = 0.675; // lightest, snow included
const SEA_FLOOR = 0.130;
const SEA_CEIL = 0.375;
const BAND_GAMMA = 0.80; // <1 lifts the mids and rolls the highlights off
const CHROMA = 0.82; // pull toward neutral; the seat colours own saturation

const KEY_LIGHT = hexLin('#fff0dc'); // warm, low sun from the north-west
const SKY_LIGHT = hexLin('#7d9aa8'); // cool hemispheric fill
// Neutral, a touch cyan. The old bounce was a warm brown (#332e28); mixed with
// the sky fill it tipped deep valleys toward magenta once the (purple) south
// region wash was on top of them.
const BOUNCE = hexLin('#3c4448');

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

/**
 * @param {object} geo   from projectedGeo()
 * @param {object} opts  { width, height, regions? }
 * @returns {{pixels: Uint8Array, width: number, height: number}}
 */
export function paintTerrain(geo, opts) {
  const W = opts.width;
  const H = opts.height;
  const N = W * H;
  const seed = geo.seed;
  const proj = opts.projection;

  const log = opts.log ?? (() => {});

  const inv = (x, y) => [proj.lat0 - (y - proj.y0) / proj.sy, proj.lon0 + (x - proj.x0) / proj.sx];

  const sx = makeSimplex(seed + 1);
  // 5 octaves, not 7. With lacunarity 2.04 and gain 0.52 each octave adds
  // roughly the SAME amount of slope, so the top two octaves were pure
  // per-pixel hillshade noise — they read as grit, not as terrain, and they
  // were most of what made the plate incompressible.
  const fbmDetail = makeFbm(seed + 2, 5, 2.04, 0.52);
  const fbmMacro = makeFbm(seed + 3, 4, 2.11, 0.55);
  const fbmWarp = makeFbm(seed + 4, 3, 2.0, 0.5);
  const ridged = makeRidged(seed + 5, 7, 2.09, 0.52);
  const fbmMoist = makeFbm(seed + 6, 4, 2.03, 0.5);
  const fbmBrush = makeFbm(seed + 7, 3, 2.4, 0.5);
  const sxWave = makeSimplex(seed + 8);
  const fbmTooth = makeFbm(seed + 9, 2, 2.6, 0.5);

  /* ---- 1. landmask + coastal SDF -------------------------------- */

  log('  outline');
  // Roughen then smooth: fractal detail first at the control-point level, then
  // Catmull-Rom so the result is organic but not jagged.
  const coast = smoothPath(roughen(smoothPath(geo.outline, 6, true), sx, 0.0075, 9.0, true), 3, true);

  const land = new Uint8Array(N);
  fillPoly(land, W, H, coast, 1);
  for (const lake of geo.lakes) {
    const l = smoothPath(roughen(smoothPath(lake, 6, true), sx, 0.004, 14, true), 3, true);
    fillPoly(land, W, H, l, 0);
  }

  log('  distance field');
  const dLand = new Float64Array(N);
  const dSea = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    dLand[i] = land[i] ? 0 : INF; // -> distance from any pixel to nearest land
    dSea[i] = land[i] ? INF : 0; // -> distance from any pixel to nearest sea
  }
  edt2d(dLand, W, H);
  edt2d(dSea, W, H);

  // Signed distance in normalised units (positive inland).
  const sdf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    sdf[i] = (land[i] ? Math.sqrt(dSea[i]) : -Math.sqrt(dLand[i])) / H;
  }
  // Soft land coverage for antialiasing the shoreline.
  const cov = new Float32Array(N);
  const px = 1 / H;
  for (let i = 0; i < N; i++) cov[i] = clamp(sdf[i] / (1.4 * px) + 0.5);

  /* ---- 2. elevation --------------------------------------------- */

  log('  ridge envelope');
  // Range envelopes are smooth, so they are computed on a coarse grid and
  // bilinearly upsampled — the crisp detail comes from ridged noise at full res.
  const GW = 256;
  const GH = Math.round((GW * H) / W);
  const env = new Float32Array(GW * GH);
  const envR = new Float32Array(GW * GH);
  for (const range of geo.ranges) {
    const path = smoothPath(range.pts, 10, false);
    // range.w is in degrees; convert to normalised units on each axis.
    const rw = Math.max(range.w * proj.sx, range.w * proj.sy) * 0.75;
    for (let gy = 0; gy < GH; gy++) {
      const py = (gy + 0.5) / GH;
      for (let gx = 0; gx < GW; gx++) {
        const pxn = (gx + 0.5) / GW;
        let best = 1e9;
        for (let i = 0; i + 1 < path.length; i++) {
          const ax = path[i][0];
          const ay = path[i][1];
          const vx = path[i + 1][0] - ax;
          const vy = path[i + 1][1] - ay;
          const vv = vx * vx + vy * vy || 1e-9;
          let t = ((pxn - ax) * vx + (py - ay) * vy) / vv;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ddx = pxn - (ax + t * vx);
          const ddy = py - (ay + t * vy);
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < best) best = d2;
        }
        const d = Math.sqrt(best);
        if (d < rw) {
          const f = smootherstep(1, 0, d / rw);
          const k = gy * GW + gx;
          const v = f * range.h;
          if (v > env[k]) {
            env[k] = v;
            envR[k] = range.r;
          } else {
            env[k] = Math.max(env[k], env[k] * 0.85 + v * 0.85);
            envR[k] = Math.max(envR[k], range.r * f);
          }
        }
      }
    }
  }
  const sampleEnv = (arr, x, y) => {
    const fx = clamp(x * GW - 0.5, 0, GW - 1.001);
    const fy = clamp(y * GH - 0.5, 0, GH - 1.001);
    const ix = fx | 0;
    const iy = fy | 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const a = arr[iy * GW + ix];
    const b = arr[iy * GW + ix + 1];
    const c = arr[(iy + 1) * GW + ix];
    const d = arr[(iy + 1) * GW + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  };

  log('  elevation');
  const elev = new Float32Array(N);
  const moist = new Float32Array(N);
  // `relief` is the local "how mountainous is this" factor. It gates how much
  // high-frequency elevation detail exists, which is what keeps the north
  // German plain reading as a PLAIN instead of a corduroy of micro-ridges.
  const relief = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const ny = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = (x + 0.5) / W;
      const [lat, lon] = inv(nx, ny);

      /*
       * Domain warp, applied at THREE strengths rather than one.
       *
       * A single 0.09 warp is ~150 px at plate resolution. On the ridge chains
       * that is exactly right — it is what stops the ranges reading as a
       * uniform noise blanket. On the detail octaves it is far wider than the
       * features it is displacing, so it drags them into long smears, and
       * those smears are the streaky, blotchy mid-frequency passages that show
       * up at 1:1. The fix is to keep the warp where the features are big and
       * damp it to almost nothing where they are small.
       */
      const wu = fbmWarp(nx * 2.1, ny * 2.1);
      const wv = fbmWarp(nx * 2.1 + 7.7, ny * 2.1 - 3.3);
      const wx = nx + wu * 0.09; // ridge chains
      const wy = ny + wv * 0.09;
      const mx = nx + wu * 0.030; // secondary dissection
      const my = ny + wv * 0.030;
      const dx = nx + wu * 0.008; // fine detail — effectively unwarped
      const dy = ny + wv * 0.008;

      const envH = sampleEnv(env, nx, ny);
      const envRough = sampleEnv(envR, nx, ny);
      const rel = clamp(envH * 1.75 + 0.05);
      relief[i] = rel;

      let e = geo.baseTilt(lat, lon);
      e += envH;
      // Ridged multifractal carves crests, but only inside a range envelope.
      // Two scales: a primary chain and a finer dissection, so ranges read as
      // ridge-and-valley systems rather than smooth dunes.
      // Scaled by envH (absolute range height), not by `rel`: a 400 m upland
      // must not grow the same crest amplitude as the Alps.
      const rough = (0.05 + envRough * 0.45) * (0.22 + envH * 1.05);
      e += (ridged(wx * 7.0, wy * 7.0) - 0.30) * rough * 1.45;
      e += (ridged(mx * 17.0 + 4.4, my * 17.0 - 1.9) - 0.30) * rough * 0.46;
      e += (ridged(dx * 40.0 - 9.1, dy * 40.0 + 6.7) - 0.30) * rough * 0.13;
      // Mid-frequency dissection scales with relief. Kept low on purpose: the
      // board carries 42 city plates and 80-odd connection lines on top, so
      // the terrain has to read as a calm, lit surface, not as a busy DEM.
      // Amplitude x frequency is what a hillshade actually responds to, so
      // this term is the loudest thing on the plate for its size — it is the
      // one to hold down, not the tooth above it.
      e += fbmDetail(dx * 6.0, dy * 6.0) * (0.003 + rel * 0.034);
      // A slow, always-present undulation so the plain breathes without
      // turning into hills.
      e += fbmMacro(nx * 1.9 + 5.1, ny * 1.9 - 2.3) * 0.022;
      e += fbmMacro(nx * 4.4 - 8.7, ny * 4.4 + 6.2) * (0.004 + rel * 0.020);

      // Coastal taper: land must reach sea level at the shore. Wide and soft —
      // a tight taper builds a cliff wall all the way round the country.
      const s = sdf[i];
      e *= smootherstep(0, 0.045, s);
      elev[i] = Math.max(0, e);

      const m = geo.moisture(lat, lon) + fbmMoist(nx * 4.3 + 21, ny * 4.3 - 8) * 0.16;
      moist[i] = clamp(m);
    }
  }

  if (process.env.PG_ART_STATS) {
    const hist = new Array(14).fill(0);
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (!land[i]) continue;
      n++;
      hist[Math.min(13, Math.floor(elev[i] / 0.1))]++;
    }
    log(
      '  elev histogram (0.1 bins): ' + hist.map((v) => ((v / n) * 100).toFixed(1)).join(' '),
    );
  }

  /* ---- 2b. river incision --------------------------------------- */

  log('  rivers');
  const riverMask = new Float32Array(N);
  for (const river of geo.rivers) {
    const path = smoothPath(roughen(smoothPath(river.pts, 8, false), sx, 0.0055, 22, false), 3, false);
    const R = river.w * 0.0021; // channel half-width in normalised units
    polylineStamp(W, H, path, R * 9, (i, d) => {
      const core = smootherstep(R, R * 0.2, d);
      if (core > riverMask[i]) riverMask[i] = core;
      // A wide, shallow floodplain rather than a trench — a narrow deep carve
      // produces steep banks, and steep banks produce ugly rock rims.
      const valley = smootherstep(R * 9, R * 0.8, d);
      elev[i] -= valley * valley * 0.016 * river.w;
      if (elev[i] < 0) elev[i] = 0;
    });
  }

  /* ---- 3. lighting basis ---------------------------------------- */

  log('  ambient occlusion');
  const elevBlurNear = blur(elev, W, H, Math.max(2, Math.round(H / 300)), 2);
  const elevBlurFar = blur(elev, W, H, Math.max(4, Math.round(H / 90)), 2);

  /* ---- 4. paint -------------------------------------------------- */

  log('  paint');
  const out = new Uint8Array(N * 3);

  // Key light direction: azimuth 315° (upper-left), altitude 40°.
  const az = (315 * Math.PI) / 180;
  const alt = (40 * Math.PI) / 180;
  const Lx = Math.cos(alt) * Math.sin(az);
  const Ly = -Math.cos(alt) * Math.cos(az);
  const Lz = Math.sin(alt);
  // Vertical exaggeration. `dzdx * W` is already a gradient in NORMALISED
  // space, so this must be a constant — scaling it by resolution made the
  // hillshade three times stronger at 2200px than at 700px, which is why
  // low-res previews and the shipped plate never matched.
  const EX = 0.85;

  const regions = opts.regions ?? null;

  for (let y = 0; y < H; y++) {
    const ny = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = (x + 0.5) / W;
      const c = cov[i];

      /* --- surface normal from the elevation field --- */
      const xm = x > 0 ? i - 1 : i;
      const xp = x < W - 1 ? i + 1 : i;
      const ym = y > 0 ? i - W : i;
      const yp = y < H - 1 ? i + W : i;
      const dzdx = (elev[xp] - elev[xm]) * 0.5;
      const dzdy = (elev[yp] - elev[ym]) * 0.5;
      let Nx = -dzdx * EX * W;
      let Ny = -dzdy * EX * H;
      let Nz = 1;
      const nl = Math.hypot(Nx, Ny, Nz) || 1;
      Nx /= nl; Ny /= nl; Nz /= nl;
      const slope = Math.hypot(dzdx * W, dzdy * H); // ~ tangent of slope

      let r; let g; let b;

      if (c > 0.001) {
        /* ============ LAND ============ */
        const e = elev[i];
        const rel = relief[i];
        // Normalise elevation for the hypsometric ramp. Germany's Alps sit
        // around 1.2 in field units; clamp keeps the snow band tiny.
        const eN = clamp(e / 1.05);

        const wet = ramp(WET_RAMP, eN);
        const dry = ramp(DRY_RAMP, eN);
        let alb = mix3(dry, wet, moist[i]);

        // Farmland parcels. Quantising a low-frequency field into plateaus and
        // giving each a small albedo offset reproduces the quilted look of
        // cultivated lowland — the thing that most says "map" rather than
        // "noise". Only appears on gentle, low ground.
        const parcelRaw = sx(nx * 34 + 3.1, ny * 34 - 5.9) * 0.62 + sx(nx * 71 - 12, ny * 71 + 4) * 0.38;
        const parcel = Math.round(parcelRaw * 2.2) / 2.2;
        const farmable = clamp(1 - rel * 2.4) * clamp(1 - smoothstep(0.22, 0.48, eN));
        alb = [
          alb[0] * (1 + parcel * 0.13 * farmable),
          alb[1] * (1 + parcel * 0.10 * farmable),
          alb[2] * (1 + parcel * 0.02 * farmable),
        ];

        // Forest cover: dark blue-green mottling, denser on high and steep
        // ground, which is exactly where German forest actually is.
        const forestN =
          fbmMacro(nx * 6.4 - 40, ny * 6.4 + 13) * 0.62 + fbmDetail(nx * 17, ny * 17) * 0.38;
        const forest = smoothstep(0.02, 0.30, forestN + rel * 0.30 + smoothstep(0.10, 0.55, eN) * 0.22);
        alb = mix3(alb, FOREST, forest * (0.34 + rel * 0.16));

        // Steep faces expose rock — but ONLY at altitude. Gating on elevation
        // as well as slope is what stops every coastal cliff and river bank in
        // the lowlands from turning into a beige scree ring.
        const highGate = smoothstep(0.30, 0.58, eN);
        const rockAmt = clamp(
          smoothstep(1.8, 4.6, slope) * 0.85 * highGate + smoothstep(0.62, 0.90, eN) * 0.75,
        );
        alb = mix3(alb, ROCK, rockAmt);

        // Macro patchwork: large slow hue/value drift. Real painted maps are
        // never uniform, and this is the main anti-"flat fill" term.
        const macro = fbmMacro(nx * 2.4 + 31, ny * 2.4 + 17);
        const macro2 = fbmMacro(nx * 5.6 - 12, ny * 5.6 + 40);
        alb = [
          alb[0] * (1 + macro * 0.15 + macro2 * 0.06),
          alb[1] * (1 + macro * 0.13 + macro2 * 0.06),
          alb[2] * (1 + macro * 0.07 - macro2 * 0.02),
        ];

        // Brushwork: fine value break-up, oriented by the warp field. This is
        // the tooth the plate keeps — high frequency, low contrast. It is the
        // CONTRAST that was making it read as grit, not the frequency.
        // Second octave dropped from 190 to 120 cycles for the same reason as
        // the tooth below: at the shipping bake width 190 cycles lands near
        // Nyquist, so it read as grit and cost more than the macro terms.
        const brush = fbmBrush(nx * 62, ny * 62) * 0.038 + fbmBrush(nx * 120 + 5, ny * 120 - 9) * 0.014;
        const bf = 1 + brush;
        alb = [alb[0] * bf, alb[1] * bf, alb[2] * bf];

        /* --- lighting --- */
        const diff = Math.max(0, Nx * Lx + Ny * Ly + Nz * Lz);
        // Wrapped diffuse softens terminators the way aerial perspective does.
        const wrap = Math.max(0, (Nx * Lx + Ny * Ly + Nz * Lz + 0.35) / 1.35);
        const key = diff * 0.72 + wrap * 0.34;
        const sky = 0.30 + 0.30 * (Nz * 0.5 + 0.5);
        /*
         * Cavity / AO from the difference against blurred elevation. Both are
         * now shallow: AO is what carries V6 depth, but every stop of it is a
         * stop of the value budget spent on ground the pieces have to be read
         * against. Shape, not darkness.
         */
        const cav = smootherstep(-0.030, 0.030, e - elevBlurNear[i]) * 0.30 + 0.70;
        const ao = smootherstep(-0.10, 0.10, e - elevBlurFar[i]) * 0.34 + 0.66;
        const occl = clamp(cav * 0.45 + ao * 0.55, 0.55, 1.10);

        // Key down, sky up: a flatter, more ambient key is what holds the
        // hillshade inside a narrow band without deleting it.
        r = alb[0] * (KEY_LIGHT[0] * key * 1.16 + SKY_LIGHT[0] * sky * 1.05 + BOUNCE[0] * 0.26) * occl;
        g = alb[1] * (KEY_LIGHT[1] * key * 1.16 + SKY_LIGHT[1] * sky * 1.05 + BOUNCE[1] * 0.26) * occl;
        b = alb[2] * (KEY_LIGHT[2] * key * 1.16 + SKY_LIGHT[2] * sky * 1.05 + BOUNCE[2] * 0.26) * occl;

        // Rim: cool bounce on slopes facing away from the key, keeps shadows alive.
        const rim = Math.pow(Math.max(0, -(Nx * Lx + Ny * Ly)), 2) * 0.10;
        r += SKY_LIGHT[0] * rim; g += SKY_LIGHT[1] * rim; b += SKY_LIGHT[2] * rim;

        // Snow. Gated on ABSOLUTE elevation, so only the Alps get it — the
        // Harz and the Erzgebirge are 1000 m hills, not glaciers.
        if (e > 0.86) {
          const sn = smoothstep(0.86, 1.22, e) * clamp(1 - slope * 0.42);
          const sc = 0.40 * sn * (0.40 + key);
          r += sc * 1.00; g += sc * 1.03; b += sc * 1.09;
        }

        /* --- rivers over the land --- */
        const rm = riverMask[i];
        if (rm > 0) {
          const spec = Math.pow(clamp(Nz), 8) * 0.022;
          r = lerp(r, RIVER[0] + spec, rm * 0.82);
          g = lerp(g, RIVER[1] + spec * 1.15, rm * 0.82);
          b = lerp(b, RIVER[2] + spec * 1.5, rm * 0.82);
        }

        /* --- region wash: a whisper of the six area colours ---
         * A pure multiplier at unit luminance (see makeRegionField): it can
         * shift hue but it cannot change value, so no region ends up a darker
         * or busier place to put a house than any other. */
        if (regions) {
          const reg = regions(nx, ny);
          if (reg) {
            const [tr, tg, tb, ra] = reg;
            r *= lerp(1, tr, ra);
            g *= lerp(1, tg, ra);
            b *= lerp(1, tb, ra);
          }
        }
      } else {
        r = g = b = 0;
      }

      /* ============ WATER ============ */
      if (c < 0.999) {
        const d = -sdf[i]; // distance offshore, normalised
        const depth = clamp(d / 0.085);
        let sea = ramp(
          [
            [0.0, SEA_SHELF],
            [0.30, SEA_MID],
            [1.0, SEA_DEEP],
          ],
          depth,
        );

        // Currents: domain-warped striations, plus a fine ripple. Painted seas
        // always have directional structure; a flat gradient reads as plastic.
        const cw = fbmWarp(nx * 3.4 + 60, ny * 3.4 + 12) * 0.12;
        const cur =
          sxWave((nx + cw) * 7.5, (ny + cw) * 26.0) * 0.5 +
          sxWave((nx + cw) * 19.0 + 3, (ny + cw) * 58.0 - 7) * 0.28 +
          fbmBrush(nx * 130, ny * 130) * 0.5;
        const curF = 1 + cur * 0.115 * (0.35 + 0.65 * (1 - depth));
        sea = [sea[0] * curF, sea[1] * curF * 1.01, sea[2] * curF * 1.03];

        // Broad specular sheen from the same key light, strongest top-left.
        const sheen = Math.pow(clamp(1 - Math.hypot(nx - 0.24, ny - 0.16) * 1.05), 3) * 0.055;
        sea = [sea[0] + sheen * 0.9, sea[1] + sheen * 1.05, sea[2] + sheen * 1.2];

        // Shoal band right at the coast. Kept deliberately tight and dim: a
        // wide bright rim reads as a video-game outline, not as shallow water.
        const shoal = smootherstep(0.011, 0.0, d);
        const foam = smootherstep(0.0022, 0.0, d) * smoothstep(0.0, 0.0006, d);
        sea = mix3(sea, FOAM, shoal * shoal * 0.11 + foam * 0.18);

        r = lerp(sea[0], r, c);
        g = lerp(sea[1], g, c);
        b = lerp(sea[2], b, c);
      }

      /* ---- coastline ink: a fine dark line, the cartographer's tell ---- */
      const edge = Math.abs(sdf[i]);
      if (edge < 0.0016) {
        const k = smootherstep(0.0016, 0.0002, edge) * 0.42;
        r *= 1 - k * 0.85; g *= 1 - k * 0.85; b *= 1 - k * 0.72;
      }

      /* ---- canvas tooth: high-frequency value break-up over everything ----
       * The frequency here is in cycles across the plate, so it used to get
       * FINER as the bake resolution went up: at the old 1092px width, 520
       * cycles was ~2px per cycle; the tooth was effectively per-pixel noise,
       * which is the single most expensive thing you can put in a PNG and the
       * main reason the 24-bit export did not fit in budget.
       *
       * Held at a fixed *feature size* instead — ~9px at the shipping bake —
       * so raising the resolution buys real detail rather than more
       * incompressible noise. `ArtManifest.paperGrain` composites the actual
       * fine tooth over this at runtime at native device resolution, which is
       * where a 1px-scale texture belongs; baking a second copy of it only
       * ever aliased against the first. */
      const tooth = fbmTooth(nx * 240, ny * 240) * 0.010;
      r *= 1 + tooth; g *= 1 + tooth; b *= 1 + tooth;

      /* ---- atmosphere: a slow warm-to-cool sweep along the light axis.
       * Unifies the plate the way a glaze pass unifies a painting, and
       * reinforces where the key light is coming from. Halved: as a value
       * gradient across the whole plate it directly widens the band, and the
       * board's corners are as likely to hold a house as its centre. ---- */
      const atmo = clamp((nx * 0.55 + ny * 0.45) * 1.15 - 0.08);
      const warm = 1 - atmo;
      r *= 1 + warm * 0.042 - atmo * 0.026;
      g *= 1 + warm * 0.016 - atmo * 0.010;
      b *= 1 - warm * 0.022 + atmo * 0.034;

      /* ---- grade: warm highlights, neutral-cool shadows ----
       * The shadow lift is deliberately G ~= B with R below both: neutral
       * tipped a little cyan. The old lift was blue-heavy and, under the
       * purple south wash, showed as magenta in the valleys. */
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const t = clamp(lum * 3.2);
      r = r * (1 + 0.07 * t) + 0.0030 * (1 - t);
      g = g * (1 + 0.02 * t) + 0.0052 * (1 - t);
      b = b * (1 - 0.01 * t) + 0.0056 * (1 - t);

      /* ---- board edge falloff ---- */
      const vx2 = (nx - 0.5) * 2;
      const vy2 = (ny - 0.5) * 2;
      const vig = 1 - smootherstep(0.72, 1.55, Math.hypot(vx2, vy2 * 0.96)) * 0.24;
      r *= vig; g *= vig; b *= vig;

      /* ================= PLATE LEVELS =================
       *
       * The last word on readability, and the reason it is a single explicit
       * remap rather than a dozen scattered multipliers: everything above is
       * about what the terrain IS, this is about what the plate is FOR.
       *
       * Perceptual value is squeezed into [floor, ceil] — a band roughly a
       * third as wide as the raw render, sitting high enough that the two dark
       * seats (black #78889b, purple #b06bff) sit clearly *below* their
       * surroundings instead of dissolving into them. Chroma is pulled back at
       * the same time, because the muddy green-brown was competing with the
       * seat hues, and a supporting surface must not.
       *
       * Water keeps a lower band so land and sea stay unmistakable, but is
       * lifted well clear of black so the coast still reads as a lit edge.
       */
      let R = l2s01(r); let G = l2s01(g); let B = l2s01(b);
      const v = R * 0.2126 + G * 0.7152 + B * 0.0722;
      const floorV = lerp(SEA_FLOOR, LAND_FLOOR, c);
      const ceilV = lerp(SEA_CEIL, LAND_CEIL, c);
      const vN = clamp((v - IN_LO) / (IN_HI - IN_LO));
      const v2 = floorV + (ceilV - floorV) * Math.pow(vN, BAND_GAMMA);
      if (v > 1e-4) {
        // Rescale to the target value, then pull the result toward that same
        // value to take chroma out. One knob for lightness, one for saturation.
        const k = v2 / v;
        R = lerp(v2, R * k, CHROMA);
        G = lerp(v2, G * k, CHROMA);
        B = lerp(v2, B * k, CHROMA);
      } else {
        R = G = B = v2;
      }

      const o = i * 3;
      // Round, not truncate: Uint8Array assignment truncates, which is a
      // systematic half-level darkening across the whole plate.
      out[o] = Math.round(clamp(R) * 255);
      out[o + 1] = Math.round(clamp(G) * 255);
      out[o + 2] = Math.round(clamp(B) * 255);
    }
  }

  return { pixels: out, width: W, height: H };
}

export { PROJECTION };
