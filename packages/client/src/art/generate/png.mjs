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
