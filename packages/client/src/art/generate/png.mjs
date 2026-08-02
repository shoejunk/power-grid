/**
 * Minimal, dependency-free PNG encoder (Node only).
 *
 * The art pipeline generates large painted terrain rasters offline. Node has no
 * canvas, and we are not allowed to add dependencies, so we write the PNG bytes
 * ourselves: `zlib` ships with Node and PNG's container format is small.
 *
 * Supports colour type 2 (RGB8) and 6 (RGBA8) with adaptive per-scanline
 * filtering — the filter choice matters a lot for file size on noisy painted
 * imagery, so we run the standard minimum-sum-of-absolute-differences heuristic
 * over all five filter types rather than defaulting to none.
 */

import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Filters one scanline five ways and keeps the cheapest, which is what gives
 * deflate something compressible to chew on.
 */
function filterScanlines(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const line = raw.subarray(y * stride, (y + 1) * stride);
    const scores = [0, 0, 0, 0, 0];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      const v0 = x;
      const v1 = (x - a) & 0xff;
      const v2 = (x - b) & 0xff;
      const v3 = (x - ((a + b) >> 1)) & 0xff;
      const v4 = (x - paeth(a, b, c)) & 0xff;
      cand[0][i] = v0;
      cand[1][i] = v1;
      cand[2][i] = v2;
      cand[3][i] = v3;
      cand[4][i] = v4;
      // Signed-magnitude cost, the heuristic from the PNG spec.
      scores[0] += v0 < 128 ? v0 : 256 - v0;
      scores[1] += v1 < 128 ? v1 : 256 - v1;
      scores[2] += v2 < 128 ? v2 : 256 - v2;
      scores[3] += v3 < 128 ? v3 : 256 - v3;
      scores[4] += v4 < 128 ? v4 : 256 - v4;
    }
    let best = 0;
    for (let f = 1; f < 5; f++) if (scores[f] < scores[best]) best = f;
    const base = y * (stride + 1);
    out[base] = best;
    cand[best].copy(out, base + 1);
    prev = Buffer.from(line);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Indexed colour
 *
 * A truecolour plate is ~1.1 bytes/pixel after deflate and is the largest
 * asset in the build, which delays first paint of the board. The plate is a
 * low-chroma, narrow-value-band painted surface — exactly the content 256
 * well-chosen colours reproduce with error below the JND — so palettising it
 * costs nothing visible and roughly thirds the file.
 *
 * Everything below is deterministic: same pixels in, same bytes out.
 * ------------------------------------------------------------------ */

/** Cheap perceptual channel weights (2:4:1). Green carries the value. */
const CW_R = 2 / 7;
const CW_G = 4 / 7;
const CW_B = 1 / 7;

/**
 * Median cut over a 5-5-5 histogram.
 *
 * Boxes are split on the axis with the widest *perceptually weighted* extent,
 * at the count-weighted median, and the box chosen to split next is the one
 * with the largest count x extent — so gradients that occupy a lot of pixels
 * and a lot of range (the sea ramp, the hillshade) get the entries, and rare
 * outliers (snow) get one each instead of a quarter of the palette.
 */
function medianCut(pixels, n, colors) {
  const BINS = 32768;
  const count = new Uint32Array(BINS);
  const sr = new Float64Array(BINS);
  const sg = new Float64Array(BINS);
  const sb = new Float64Array(BINS);

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const r = pixels[o]; const g = pixels[o + 1]; const b = pixels[o + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    count[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }

  const occupied = [];
  for (let k = 0; k < BINS; k++) if (count[k]) occupied.push(k);
  if (occupied.length <= colors) {
    return occupied.map((k) => [
      Math.round(sr[k] / count[k]),
      Math.round(sg[k] / count[k]),
      Math.round(sb[k] / count[k]),
    ]);
  }

  const axisOf = (k, a) => (a === 0 ? (k >> 10) & 31 : a === 1 ? (k >> 5) & 31 : k & 31);
  const makeBox = (bins) => {
    let c = 0;
    const lo = [31, 31, 31];
    const hi = [0, 0, 0];
    for (const k of bins) {
      c += count[k];
      for (let a = 0; a < 3; a++) {
        const v = axisOf(k, a);
        if (v < lo[a]) lo[a] = v;
        if (v > hi[a]) hi[a] = v;
      }
    }
    const w = [CW_R, CW_G, CW_B];
    let axis = 0;
    let ext = -1;
    for (let a = 0; a < 3; a++) {
      const e = (hi[a] - lo[a]) * w[a];
      if (e > ext) { ext = e; axis = a; }
    }
    return { bins, count: c, axis, ext, score: c * ext };
  };

  let boxes = [makeBox(occupied)];
  while (boxes.length < colors) {
    let bi = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].bins.length > 1 && boxes[i].score > best) { best = boxes[i].score; bi = i; }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    const a = box.axis;
    const sorted = box.bins.slice().sort((p, q) => axisOf(p, a) - axisOf(q, a) || p - q);
    const half = box.count / 2;
    let acc = 0;
    let cut = 0;
    for (; cut < sorted.length - 1; cut++) {
      acc += count[sorted[cut]];
      if (acc >= half) break;
    }
    const left = sorted.slice(0, cut + 1);
    const right = sorted.slice(cut + 1);
    if (!left.length || !right.length) { box.score = 0; continue; }
    boxes.splice(bi, 1, makeBox(left), makeBox(right));
  }

  return boxes.map((box) => {
    let c = 0; let r = 0; let g = 0; let b = 0;
    for (const k of box.bins) { c += count[k]; r += sr[k]; g += sg[k]; b += sb[k]; }
    return [Math.round(r / c), Math.round(g / c), Math.round(b / c)];
  });
}

/** 8x8 Bayer, normalised to [-0.5, 0.5]. */
// prettier-ignore
const BAYER = Float32Array.from([
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
], (v) => v / 64 - 0.5);

/**
 * Quantises to an indexed image.
 *
 * The dither is an ordered 8x8 Bayer rather than Floyd-Steinberg on purpose:
 * error diffusion produces a different, unpredictable value at every pixel,
 * which is precisely what deflate cannot compress. A low-amplitude ordered
 * pattern breaks the banding in the sea ramp for a few percent of file size.
 *
 * @returns {{indices: Uint8Array, palette: number[][]}}
 */
export function quantise(pixels, width, height, colors = 256, dither = 1.6) {
  const n = width * height;
  const palette = medianCut(pixels, n, colors);
  // Order by value so neighbouring pixels get neighbouring indices — that is
  // what makes the PNG line filters worth anything on palette data.
  palette.sort(
    (a, b) =>
      a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722 - (b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722),
  );

  const P = palette.length;
  const pr = new Int32Array(P);
  const pg = new Int32Array(P);
  const pb = new Int32Array(P);
  for (let i = 0; i < P; i++) { pr[i] = palette[i][0]; pg[i] = palette[i][1]; pb[i] = palette[i][2]; }

  // Nearest-entry lookup over a 6-6-6 cube, filled lazily: the plate touches a
  // small fraction of colour space, so most of the 262144 cells are never asked
  // for and a full precompute would be wasted work.
  const LUT = new Int16Array(262144).fill(-1);
  const nearest = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = LUT[key];
    if (idx >= 0) return idx;
    let best = Infinity;
    idx = 0;
    for (let i = 0; i < P; i++) {
      const dr = r - pr[i];
      const dg = g - pg[i];
      const db = b - pb[i];
      const d = CW_R * dr * dr + CW_G * dg * dg + CW_B * db * db;
      if (d < best) { best = d; idx = i; }
    }
    LUT[key] = idx;
    return idx;
  };

  const indices = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 3;
      const d = BAYER[(y & 7) * 8 + (x & 7)] * dither;
      const r = Math.min(255, Math.max(0, Math.round(pixels[o] + d)));
      const g = Math.min(255, Math.max(0, Math.round(pixels[o + 1] + d)));
      const b = Math.min(255, Math.max(0, Math.round(pixels[o + 2] + d)));
      indices[i] = nearest(r, g, b);
    }
  }

  return { indices, palette };
}

/** Mean and peak per-channel error of a quantisation, for the build log. */
export function quantiseError(pixels, indices, palette) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < indices.length; i++) {
    const p = palette[indices[i]];
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const e = Math.abs(pixels[o + ch] - p[ch]);
      sum += e;
      if (e > peak) peak = e;
    }
  }
  return { mean: sum / (indices.length * 3), peak };
}

/**
 * @param {Uint8Array} pixels interleaved samples, length = w*h*channels
 * @param {number} width
 * @param {number} height
 * @param {number} channels 3 = RGB, 4 = RGBA, 2 = grey+alpha
 */
export function encodePNG(pixels, width, height, channels = 3) {
  const colorType = channels === 4 ? 6 : channels === 2 ? 4 : 2;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const filtered = filterScanlines(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.length), width, height, channels);
  const idat = zlib.deflateSync(filtered, { level: 9, memLevel: 9, windowBits: 15, strategy: zlib.constants.Z_DEFAULT_STRATEGY });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Colour-type-3 (indexed) PNG. Still a plain `.png` — no MIME games, no
 * format sniffing, nothing downstream has to know.
 *
 * Filtering indexed data is usually a pessimisation, because index values are
 * not numerically continuous. Here they are: `quantise()` sorts the palette by
 * value, so adjacent pixels really do get adjacent indices and the line
 * filters pay. Both are tried and the smaller kept, because which one wins
 * depends on the image and guessing is free to get wrong.
 *
 * @param {Uint8Array} indices one palette index per pixel
 * @param {number[][]} palette up to 256 [r,g,b] entries
 */
export function encodeIndexedPNG(indices, palette, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach(([r, g, b], i) => {
    plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b;
  });

  const raw = Buffer.from(indices.buffer, indices.byteOffset, indices.length);
  const deflate = (buf) =>
    zlib.deflateSync(buf, { level: 9, memLevel: 9, windowBits: 15, strategy: zlib.constants.Z_DEFAULT_STRATEGY });

  const adaptive = deflate(filterScanlines(raw, width, height, 1));

  const none = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    none[y * (width + 1)] = 0;
    raw.copy(none, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const flat = deflate(none);

  const idat = flat.length < adaptive.length ? flat : adaptive;

  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
