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
import { encodePNG } from './png.mjs';
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
 * Soft-Voronoi region field. Hard Voronoi cells look like a vector diagram;
 * exponential soft-min weighting produces the diffuse, bleeding boundaries of a
 * printed political map. Computed on a coarse lattice and bilinearly sampled.
 */
function makeRegionField(mapId, strength) {
  if (mapId !== 'germany') return null;
  const { areas, cities } = readGermanyRegions();
  if (!cities.length) return null;

  const ids = Object.keys(areas);
  // Pull each area colour toward the terrain's value range so the wash tints
  // rather than paints. Full-strength region colours would flatten the relief.
  const cols = {};
  for (const id of ids) {
    let c = hexLin(areas[id]);
    // Halve the chroma. The printed area colours are poster-bright; at full
    // saturation they read as a colour cast over the paint rather than as the
    // tinted regions of a political-relief map.
    const gray = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    c = [lerp(gray, c[0], 0.5), lerp(gray, c[1], 0.5), lerp(gray, c[2], 0.5)];
    const lum = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    const k = 0.055 / Math.max(lum, 1e-4); // normalise to a common dark value
    cols[id] = [c[0] * k, c[1] * k, c[2] * k];
  }

  const GW = 220;
  const GH = Math.round(GW / 0.78);
  const field = new Float32Array(GW * GH * 4);
  const K = 0.085; // softness of the region boundary

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
      for (const id of ids) {
        const w = (acc[id] ?? 0) / total;
        const c = cols[id];
        r += c[0] * w; g += c[1] * w; b += c[2] * w;
      }
      // Fade the wash out where no city is near, so open country stays neutral.
      const a = strength * clamp(1 - (nearest - 0.10) / 0.22);
      const k = (gy * GW + gx) * 4;
      field[k] = r; field[k + 1] = g; field[k + 2] = b; field[k + 3] = a;
    }
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

/* ------------------------------------------------------------------ */

const HEIGHT = Number(process.env.PG_ART_HEIGHT ?? 2200);
const REGION_STRENGTH = Number(process.env.PG_ART_REGION ?? 0.34);

function build(mapId) {
  const t0 = Date.now();
  const geo = projectedGeo(mapId);
  const H = HEIGHT;
  const W = Math.round((H * geo.aspect) / 2) * 2;
  console.log(`[art] ${mapId}: ${W}x${H}`);

  const { pixels } = paintTerrain(geo, {
    width: W,
    height: H,
    projection: PROJECTION[mapId],
    regions: makeRegionField(mapId, REGION_STRENGTH),
    log: (s) => console.log(`[art] ${mapId}${s}`),
  });

  const png = encodePNG(pixels, W, H, 3);
  const file = path.join(OUT, `board-${mapId}.png`);
  fs.writeFileSync(file, png);
  console.log(
    `[art] ${mapId}: wrote ${path.relative(REPO, file)} — ${(png.length / 1048576).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const id of targets.length ? targets : ['germany']) build(id);
