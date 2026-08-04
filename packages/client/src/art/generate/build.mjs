/**
 * Offline art build — writes the painted board bases into `public/art/`.
 *
 *   node packages/client/src/art/generate/build.mjs
 *
 * Why offline rather than at runtime: the terrain painter is a per-pixel
 * relief-rendering pass (distance transforms, ridged multifractal, linear-space
 * lighting, blurred-elevation AO). At board resolution that is seconds of CPU —
 * fine on a build machine, unacceptable on the main thread of a game client.
 * Everything smaller (tokens, houses, plates, glows, plant art) stays as
 * runtime canvas generation so it can be driven by live CSS custom properties.
 *
 * SCOPE: Germany only. The USA board art is deferred — `ArtManifest.boardBase`
 * still carries a `usa` key, pointed at the Germany plate, so the type stays
 * satisfied and `loadArtManifest()` never throws.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIndexedPNG, encodePNG, quantise, quantiseError } from './png.mjs';
import { projectedGeo, PROJECTION } from './geo.mjs';
import { paintTerrain } from './terrain.mjs';
import { clamp, lerp } from './noise.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(here, '../../..');
const REPO = path.resolve(CLIENT, '../..');
const OUT = path.join(CLIENT, 'public', 'art');

fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ *
 * Region wash — reads the real area membership out of the shared map
 * data so the six Power Grid regions are legible in the paint itself.
 * ------------------------------------------------------------------ */

function readGermanyRegions() {
  const src = fs.readFileSync(path.join(REPO, 'packages/shared/src/data/maps/germany.ts'), 'utf8');

  const areas = {};
  const areaRe = /\{\s*id:\s*'([a-z]+)',\s*name:\s*'[^']*',\s*color:\s*'(#[0-9a-fA-F]{6})'/g;
  let m;
  while ((m = areaRe.exec(src))) areas[m[1]] = m[2];

  const cities = [];
  const cityRe = /\{\s*id:\s*'[a-z0-9_-]+',\s*name:\s*'[^']*',\s*area:\s*'([a-z]+)',\s*x:\s*([0-9.]+),\s*y:\s*([0-9.]+)/g;
  while ((m = cityRe.exec(src))) cities.push({ area: m[1], x: Number(m[2]), y: Number(m[3]) });

  return { areas, cities };
}

const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const hexLin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [S2L[(n >> 16) & 255], S2L[(n >> 8) & 255], S2L[n & 255]];
};

/**
 * Region field — a tinted BAND along each region boundary, not a wash over the
 * region.
 *
 * The previous build emitted `alpha = strength * f(distance to nearest city)`,
 * which is at its *strongest* in the middle of a region (cities are dense
 * there) and fades out only in empty country. The result was broad soft
 * gradients across whole interiors: red over Dortmund–Kassel, yellow over
 * Halle–Würzburg, blue over Köln–Wiesbaden, purple over Nürnberg–Regensburg.
 * The blue one sat directly under the blue seat's houses in Köln/Düsseldorf/
 * Essen/Dortmund, which is the exact V3 failure the comment here claimed to
 * have avoided.
 *
 * Now: take the soft-Voronoi membership, harden it to a label, distance-
 * transform the label boundary, and emit chroma only inside BAND_W of that
 * boundary with a steep rolloff. Interiors get alpha 0 — not "a little" — and
 * the band is additionally suppressed around every city so it can never land
 * under a house. Boundary shape still comes from the soft field, so the seam
 * meanders like a printed map rather than reading as a Voronoi diagram.
 */

/** Band half-width, as a fraction of board height. */
const BAND_W = 0.072;
/** Rolloff exponent — >1 concentrates the chroma hard against the boundary. */
const BAND_FALLOFF = 2.4;
/** The band is faded out between these distances from any city, so that no
 *  house or cost badge ever sits on tinted ground. Normalised board units. */
const CITY_CLEAR_IN = 0.016;
const CITY_CLEAR_OUT = 0.055;

function makeRegionField(mapId, strength) {
  if (mapId !== 'germany') return null;
  const { areas, cities } = readGermanyRegions();
  if (!cities.length) return null;

  const ids = Object.keys(areas);
  /*
   * The wash is emitted as a pure MULTIPLIER at unit luminance, never as a
   * colour to blend toward. Two reasons, both readability:
   *
   *  - a tint that cannot change value cannot darken a region, so the plate's
   *    value band stays flat across the whole board and no seat colour is
   *    harder to find in one corner than another;
   *  - the `south` area colour is #8659b5, a purple. Blending toward it is
   *    what put a magenta cast in the Alpine valleys, and it is also the worst
   *    possible ground for the purple seat's houses.
   */
  const cols = {};
  for (const id of ids) {
    let c = hexLin(areas[id]);
    // Take the chroma right down. The printed area colours are poster-bright;
    // anything near full saturation reads as a colour cast over the paint
    // rather than as the tinted regions of a political-relief map.
    const gray = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    c = [lerp(gray, c[0], 0.30), lerp(gray, c[1], 0.30), lerp(gray, c[2], 0.30)];
    const lum = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    const k = 1 / Math.max(lum, 1e-4); // unit luminance -> value-preserving tint
    cols[id] = [c[0] * k, c[1] * k, c[2] * k];
  }

  const GW = 220;
  const GH = Math.round(GW / 0.78);
  const field = new Float32Array(GW * GH * 4);
  const K = 0.085; // softness of the region boundary

  // Lattice cells are square in physical units (GH = GW / aspect), so a
  // chamfer distance in cells converts to board-height fractions by /GH.
  const label = new Int16Array(GW * GH).fill(-1);
  const cityDist = new Float32Array(GW * GH);
  const tint = new Float32Array(GW * GH * 3);

  for (let gy = 0; gy < GH; gy++) {
    const py = (gy + 0.5) / GH;
    for (let gx = 0; gx < GW; gx++) {
      const pxn = (gx + 0.5) / GW;
      const acc = {};
      let total = 0;
      let nearest = 1e9;
      for (const c of cities) {
        const d = Math.hypot(pxn - c.x, py - c.y);
        if (d < nearest) nearest = d;
        const w = Math.exp(-d / K);
        acc[c.area] = (acc[c.area] ?? 0) + w;
        total += w;
      }
      let r = 0; let g = 0; let b = 0;
      let bestW = -1; let bestI = -1;
      for (let ii = 0; ii < ids.length; ii++) {
        const w = (acc[ids[ii]] ?? 0) / total;
        const c = cols[ids[ii]];
        r += c[0] * w; g += c[1] * w; b += c[2] * w;
        if (w > bestW) { bestW = w; bestI = ii; }
      }
      const g1 = gy * GW + gx;
      // Blending unit-luminance tints keeps the blend at unit luminance too.
      tint[g1 * 3] = r; tint[g1 * 3 + 1] = g; tint[g1 * 3 + 2] = b;
      label[g1] = bestI;
      cityDist[g1] = nearest;
    }
  }

  /* --- distance transform from the label boundary (two-pass chamfer) --- */
  const INF = 1e9;
  const dist = new Float32Array(GW * GH).fill(INF);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx;
      const l = label[i];
      const edge =
        (gx > 0 && label[i - 1] !== l) ||
        (gx < GW - 1 && label[i + 1] !== l) ||
        (gy > 0 && label[i - GW] !== l) ||
        (gy < GH - 1 && label[i + GW] !== l);
      if (edge) dist[i] = 0;
    }
  }
  const D1 = 1; const D2 = Math.SQRT2;
  const relax = (i, j, w) => { if (dist[j] + w < dist[i]) dist[i] = dist[j] + w; };
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx;
    if (gx > 0) relax(i, i - 1, D1);
    if (gy > 0) relax(i, i - GW, D1);
    if (gx > 0 && gy > 0) relax(i, i - GW - 1, D2);
    if (gx < GW - 1 && gy > 0) relax(i, i - GW + 1, D2);
  }
  for (let gy = GH - 1; gy >= 0; gy--) for (let gx = GW - 1; gx >= 0; gx--) {
    const i = gy * GW + gx;
    if (gx < GW - 1) relax(i, i + 1, D1);
    if (gy < GH - 1) relax(i, i + GW, D1);
    if (gx < GW - 1 && gy < GH - 1) relax(i, i + GW + 1, D2);
    if (gx > 0 && gy < GH - 1) relax(i, i + GW - 1, D2);
  }

  /* --- alpha: band only, hard rolloff, cleared around every city --- */
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  for (let i = 0; i < GW * GH; i++) {
    const dBand = dist[i] / GH; // -> fraction of board height
    let a = dBand >= BAND_W ? 0 : strength * Math.pow(1 - dBand / BAND_W, BAND_FALLOFF);
    a *= smooth(CITY_CLEAR_IN, CITY_CLEAR_OUT, cityDist[i]);
    const k = i * 4;
    field[k] = tint[i * 3];
    field[k + 1] = tint[i * 3 + 1];
    field[k + 2] = tint[i * 3 + 2];
    field[k + 3] = a;
  }

  return (x, y) => {
    const fx = clamp(x * GW - 0.5, 0, GW - 1.001);
    const fy = clamp(y * GH - 0.5, 0, GH - 1.001);
    const ix = fx | 0; const iy = fy | 0;
    const tx = fx - ix; const ty = fy - iy;
    const o = [0, 0, 0, 0];
    for (let ch = 0; ch < 4; ch++) {
      const a = field[(iy * GW + ix) * 4 + ch];
      const b = field[(iy * GW + ix + 1) * 4 + ch];
      const c = field[((iy + 1) * GW + ix) * 4 + ch];
      const d = field[((iy + 1) * GW + ix + 1) * 4 + ch];
      o[ch] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    }
    return o[3] > 0.001 ? o : null;
  };
}

/* ------------------------------------------------------------------ *
 * Region-wash diagnostic
 *
 * The acceptance test for the boundary band: chroma (CIE C*ab) measured on the
 * REAL output pixels at each region's centroid must be at the plate's neutral
 * floor, while chroma inside the band must be visibly above it. If centroid
 * chroma tracks band chroma, the wash has leaked back into the interiors.
 * ------------------------------------------------------------------ */

function labChroma(r8, g8, b8) {
  const r = S2L[r8]; const g = S2L[g8]; const b = S2L[b8];
  const X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const Y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const Z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X / 0.95047); const fy = f(Y); const fz = f(Z / 1.08883);
  return Math.hypot(500 * (fx - fy), 200 * (fy - fz));
}

/** Mean chroma over a disc of radius `rad` (in px) centred on normalised x,y. */
function discChroma(pixels, W, H, x, y, rad) {
  const cx = Math.round(x * W); const cy = Math.round(y * H);
  let sum = 0; let n = 0;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const px = cx + dx; const py = cy + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const o = (py * W + px) * 3;
      if (pixels[o] <= pixels[o + 2]) continue; // sea is blue-dominant; skip it
      sum += labChroma(pixels[o], pixels[o + 1], pixels[o + 2]);
      n++;
    }
  }
  return n ? { c: sum / n, n } : { c: NaN, n: 0 };
}

function regionChromaStats(pixels, W, H, regionsFn) {
  const { cities } = readGermanyRegions();
  const byArea = {};
  for (const c of cities) (byArea[c.area] ??= []).push(c);

  const rows = [];
  for (const [area, list] of Object.entries(byArea)) {
    const cx = list.reduce((s, c) => s + c.x, 0) / list.length;
    const cy = list.reduce((s, c) => s + c.y, 0) / list.length;
    const centroid = discChroma(pixels, W, H, cx, cy, Math.round(H * 0.02));
    rows.push({ area, cx, cy, centroid: centroid.c });
  }

  // Band samples: scan for the points the field actually tints hardest.
  const band = [];
  if (regionsFn) {
    for (let gy = 0; gy < 260; gy++) {
      for (let gx = 0; gx < 200; gx++) {
        const x = (gx + 0.5) / 200; const y = (gy + 0.5) / 260;
        const f = regionsFn(x, y);
        if (!f || f[3] < 0.001) continue;
        band.push({ x, y, a: f[3] });
      }
    }
    band.sort((a, b) => b.a - a.a);
  }
  const top = band.slice(0, Math.max(1, Math.round(band.length * 0.15)));
  let bs = 0; let bn = 0;
  for (const p of top) {
    const d = discChroma(pixels, W, H, p.x, p.y, 2);
    if (d.n) { bs += d.c; bn++; }
  }

  const covered = band.length / (200 * 260);
  return { rows, bandChroma: bn ? bs / bn : NaN, bandCoverage: covered, maxAlpha: band.length ? band[0].a : 0 };
}

/* ------------------------------------------------------------------ *
 * Plate diagnostics
 *
 * The plate is a SUPPORTING surface: six saturated seat colours, three house
 * slots per city and ~83 cost badges sit on top of it. "Does it look nice on
 * its own" is the wrong question — the checkable question is whether its value
 * band is narrow and light enough that nothing placed on it disappears.
 * These numbers are the thing to tune against, so the build prints them.
 * ------------------------------------------------------------------ */

/**
 * @param {Uint8Array} pixels RGB8
 * @param {[number,number,number,number]} win normalised x0,y0,x1,y1 window that
 *        the shadow-chroma reading is taken from. Defaults to the Alpine front,
 *        which is where the deep valleys are and where the purple `south` area
 *        wash lands — i.e. the one place a magenta cast can actually form.
 */
/** Value stats over an index list. */
function band(pixels, idx) {
  const hist = new Uint32Array(256);
  let mean = 0;
  for (const i of idx) {
    const o = i * 3;
    const v = Math.round(pixels[o] * 0.2126 + pixels[o + 1] * 0.7152 + pixels[o + 2] * 0.0722);
    hist[v]++;
    mean += v;
  }
  const pct = (p) => {
    let acc = 0;
    const want = idx.length * p;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= want) return v;
    }
    return 255;
  };
  return { mean: mean / idx.length, p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99) };
}

const rect = (w, h, [x0, y0, x1, y1]) => {
  const out = [];
  for (let y = Math.round(y0 * h); y < Math.round(y1 * h); y++) {
    for (let x = Math.round(x0 * w); x < Math.round(x1 * w); x++) out.push(y * w + x);
  }
  return out;
};

/**
 * `land` is a window entirely inside the country, so the value band it reports
 * is the band a house actually has to be found against — the whole-plate
 * figure is dominated by sea and flatters itself.
 *
 * `shadow` is the mean colour of the darkest quartile of the Alpine front,
 * which is where the deep valleys are and where the (purple) `south` area wash
 * lands: the one place on the plate a magenta cast can form.
 */
function plateStats(pixels, w, h) {
  const all = rect(w, h, [0, 0, 1, 1]);
  const landIdx = rect(w, h, [0.30, 0.28, 0.70, 0.74]);
  const alps = rect(w, h, [0.33, 0.80, 0.78, 0.96]);

  alps.sort((a, b) => {
    const va = pixels[a * 3] * 0.2126 + pixels[a * 3 + 1] * 0.7152 + pixels[a * 3 + 2] * 0.0722;
    const vb = pixels[b * 3] * 0.2126 + pixels[b * 3 + 1] * 0.7152 + pixels[b * 3 + 2] * 0.0722;
    return va - vb;
  });
  const take = Math.max(1, Math.round(alps.length * 0.25));
  let sr = 0; let sg = 0; let sb = 0;
  for (let k = 0; k < take; k++) {
    const o = alps[k] * 3;
    sr += pixels[o]; sg += pixels[o + 1]; sb += pixels[o + 2];
  }
  const shadow = [sr / take, sg / take, sb / take];

  return { all: band(pixels, all), land: band(pixels, landIdx), shadow };
}

/* ------------------------------------------------------------------ */

/*
 * Baked resolution. The plate is a soft, low-frequency surface — every
 * high-frequency term that used to live in it was costing a megabyte and
 * aliasing anyway, and `ArtManifest.paperGrain` already supplies tooth at
 * runtime, on top, at native device resolution. `BOARD_BASE_SIZE` in
 * `src/art/index.ts` stays the plate's *layout* size; the raster is upscaled
 * into it, which is free and invisible for content with no hard edges.
 */
const HEIGHT = Number(process.env.PG_ART_HEIGHT ?? 2800);
/*
 * The wash is confined to a narrow boundary band now, so it can carry more
 * chroma than the old whole-interior version could: a seam has to be seen to
 * do its job, whereas an interior tint only ever had to be invisible.
 */
const REGION_STRENGTH = Number(process.env.PG_ART_REGION ?? 0.42);
/** Palette size. `PG_ART_INDEXED=1` writes an indexed PNG instead, for A/B. */
const COLORS = Number(process.env.PG_ART_COLORS ?? 256);
/*
 * 24-bit by default. The plate is almost entirely smooth gradient, which is
 * the worst case for an indexed palette: at 214 colours the region seams and
 * the sea banded visibly, and there was no headroom left for a HiDPI upscale.
 * See the note on the write below for the size trade-off.
 */
const TRUECOLOUR = process.env.PG_ART_INDEXED !== '1';

function build(mapId) {
  const t0 = Date.now();
  const geo = projectedGeo(mapId);
  const H = HEIGHT;
  const W = Math.round((H * geo.aspect) / 2) * 2;
  const log = (s) => console.log(`[art] ${mapId}${s}`);
  console.log(`[art] ${mapId}: ${W}x${H}`);

  const regionsFn = makeRegionField(mapId, REGION_STRENGTH);
  const { pixels } = paintTerrain(geo, {
    width: W,
    height: H,
    projection: PROJECTION[mapId],
    regions: regionsFn,
    log,
  });

  if (mapId === 'germany') {
    const rc = regionChromaStats(pixels, W, H, regionsFn);
    console.log(
      `[art] ${mapId}: region wash — band covers ${(rc.bandCoverage * 100).toFixed(1)}% of the plate,` +
        ` peak alpha ${rc.maxAlpha.toFixed(3)}, mean chroma in band C* ${rc.bandChroma.toFixed(2)}`,
    );
    for (const r of rc.rows) {
      console.log(
        `[art] ${mapId}:   centroid ${r.area.padEnd(6)} (${r.cx.toFixed(2)},${r.cy.toFixed(2)})` +
          ` chroma C* ${r.centroid.toFixed(2)}`,
      );
    }
  }

  const st = plateStats(pixels, W, H);
  const fmt = (b) => `mean ${b.mean.toFixed(1)} p10 ${b.p10} p50 ${b.p50} p90 ${b.p90} p99 ${b.p99}`;
  console.log(`[art] ${mapId}: plate  ${fmt(st.all)}`);
  console.log(
    `[art] ${mapId}: land   ${fmt(st.land)} · spread ${st.land.p90 - st.land.p10}` +
      ` · alpine shadow rgb ${st.shadow.map((v) => v.toFixed(0)).join(',')}`,
  );

  log('  encode');
  let png;
  if (TRUECOLOUR) {
    png = encodePNG(pixels, W, H, 3);
  } else {
    const { indices, palette } = quantise(pixels, W, H, COLORS);
    const err = quantiseError(pixels, indices, palette);
    console.log(
      `[art] ${mapId}: quantised to ${palette.length} colours — mean error ${err.mean.toFixed(2)}/255, peak ${err.peak}`,
    );
    png = encodeIndexedPNG(indices, palette, W, H);
  }

  const file = path.join(OUT, `board-${mapId}.png`);
  fs.writeFileSync(file, png);
  console.log(
    `[art] ${mapId}: wrote ${path.relative(REPO, file)} — ${(png.length / 1024).toFixed(0)} KB` +
      ` (${(png.length / (W * H)).toFixed(2)} B/px) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const id of targets.length ? targets : ['germany']) build(id);
