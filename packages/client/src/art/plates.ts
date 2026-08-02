/**
 * Depth layers — the pieces that turn flat compositing into layered elevation
 * (QUALITY-BAR V6).
 *
 *   cityPlate   a machined metal medallion the house slots sit on
 *   radialGlow  a white falloff the renderer tints for hover / selection
 *   vignette    edge darkening multiplied over the board
 *   paperGrain  a seamlessly tiling tooth laid over everything
 */

import { css, fbm, hash2, linGrad, makeCanvas, mix, radGrad, type Ctx, type RGB } from './raster';

const PLATE_RIM: RGB = { r: 62, g: 78, b: 96 };
const PLATE_FACE: RGB = { r: 22, g: 32, b: 44 };
const PLATE_WELL: RGB = { r: 12, g: 18, b: 26 };

/* ------------------------------------------------------------------ *
 * city plate
 * ------------------------------------------------------------------ */

/**
 * A circular plate: raised bevelled rim, brushed annulus, recessed centre.
 * Every ring is a separate lit surface, which is what reads as machined metal
 * instead of as three concentric fills.
 */
export function cityPlateTexture(size = 256): string {
  const [c, ctx] = makeCanvas(size, size);
  const S = size;
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.455;

  // Ambient occlusion pooling under the plate.
  ctx.fillStyle = radGrad(ctx, cx, cy + S * 0.03, R * 0.8, cx, cy + S * 0.03, R * 1.1, [
    [0, 'rgba(0,0,0,0.55)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  ctx.fillRect(0, 0, S, S);

  // Outer rim: a lit torus. Light from the upper left.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = linGrad(ctx, cx - R, cy - R, cx + R, cy + R, [
    [0, css(mix(PLATE_RIM, { r: 190, g: 214, b: 236 }, 0.42))],
    [0.34, css(PLATE_RIM)],
    [0.62, css(mix(PLATE_RIM, PLATE_WELL, 0.55))],
    [1, css(mix(PLATE_RIM, PLATE_WELL, 0.15))],
  ]);
  ctx.fill();

  // Brushed annulus.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.90, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = linGrad(ctx, cx - R, cy - R, cx + R, cy + R, [
    [0, css(mix(PLATE_FACE, PLATE_RIM, 0.75))],
    [0.45, css(PLATE_FACE)],
    [1, css(mix(PLATE_FACE, PLATE_WELL, 0.8))],
  ]);
  ctx.fillRect(0, 0, S, S);
  // Radial brushing: fine spokes, deterministic.
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = Math.max(1, S * 0.004);
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2;
    const j = hash2(i, 3, 5150);
    ctx.strokeStyle = j > 0.5 ? 'rgba(190,214,236,0.5)' : 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42);
    ctx.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
    ctx.stroke();
  }
  ctx.restore();

  // Recessed well in the middle, with its own inner shadow.
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = radGrad(ctx, cx - R * 0.2, cy - R * 0.24, R * 0.05, cx, cy, R * 0.62, [
    [0, css(mix(PLATE_WELL, PLATE_RIM, 0.24))],
    [0.62, css(PLATE_WELL)],
    [1, css(mix(PLATE_WELL, { r: 0, g: 0, b: 0 }, 0.5))],
  ]);
  ctx.fill();
  // Inner shadow on the well's upper-left lip.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = S * 0.035;
  ctx.beginPath();
  ctx.arc(cx, cy - S * 0.012, R * 0.62, Math.PI * 0.85, Math.PI * 2.1);
  ctx.stroke();
  ctx.restore();

  // Rivets on the diagonals.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const rx = cx + Math.cos(a) * R * 0.775;
    const ry = cy + Math.sin(a) * R * 0.775;
    const rr = S * 0.026;
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.fillStyle = radGrad(ctx, rx - rr * 0.4, ry - rr * 0.4, 0, rx, ry, rr, [
      [0, 'rgba(196,220,242,0.85)'],
      [0.55, css(PLATE_RIM)],
      [1, 'rgba(0,0,0,0.7)'],
    ]);
    ctx.fill();
  }

  // Specular sweep across the top-left quadrant.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = radGrad(ctx, cx - R * 0.42, cy - R * 0.52, 0, cx - R * 0.42, cy - R * 0.52, R * 1.05, [
    [0, 'rgba(150,196,236,0.20)'],
    [1, 'rgba(150,196,236,0)'],
  ]);
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  // Hard outer keyline.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = S * 0.016;
  ctx.strokeStyle = 'rgba(4,8,12,0.85)';
  ctx.stroke();

  return c.toDataURL();
}

/* ------------------------------------------------------------------ *
 * radial glow
 * ------------------------------------------------------------------ */

/**
 * White so the consumer can tint it to any seat or state colour. The falloff
 * is deliberately not a plain linear ramp: a bright core, a long shoulder and
 * a faint outer ring make a pulse read as light rather than as a grey disc.
 */
export function radialGlowTexture(size = 512): string {
  const [c, ctx] = makeCanvas(size, size);
  const S = size;
  ctx.fillStyle = radGrad(ctx, S / 2, S / 2, 0, S / 2, S / 2, S / 2, [
    [0, 'rgba(255,255,255,1)'],
    [0.10, 'rgba(255,255,255,0.92)'],
    [0.26, 'rgba(255,255,255,0.52)'],
    [0.44, 'rgba(255,255,255,0.24)'],
    [0.60, 'rgba(255,255,255,0.10)'],
    [0.78, 'rgba(255,255,255,0.035)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillRect(0, 0, S, S);

  // Faint containment ring — gives selection pulses a defined edge.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = S * 0.012;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.335, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  return c.toDataURL();
}

/* ------------------------------------------------------------------ *
 * vignette
 * ------------------------------------------------------------------ */

/**
 * Multiplied over the board edges. Drawn per-pixel with a noise-perturbed
 * radius: a pure mathematical gradient bands visibly on a dark screen, and the
 * perturbation both hides that and reads as an organic paper edge.
 */
export function vignetteTexture(size = 512): string {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size - 0.5;
      const ny = (y + 0.5) / size - 0.5;
      const wobble = (fbm((x / size) * 3.5, (y / size) * 3.5, 4242, 3) - 0.5) * 0.055;
      const d = Math.hypot(nx * 2, ny * 2 * 1.03) + wobble;
      const t = Math.max(0, Math.min(1, (d - 0.58) / 0.78));
      const a = t * t * (3 - 2 * t) * 0.72;
      const i = (y * size + x) * 4;
      // A very slightly blue-black edge sits better on the slate substrate
      // than neutral black.
      img.data[i] = 2;
      img.data[i + 1] = 5;
      img.data[i + 2] = 9;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/* ------------------------------------------------------------------ *
 * paper grain
 * ------------------------------------------------------------------ */

/**
 * A seamlessly tiling tooth. Two components: directional fibre (noise stretched
 * on one axis, like laid paper) and fine speckle. Tileability comes from the
 * wrap-blend trick — the field is cross-faded with copies of itself offset by
 * exactly one tile, so opposite edges match by construction.
 */
export function paperGrainTexture(size = 256, alpha = 0.10): string {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);

  const F = 6; // noise periods across the tile
  const wrapped = (fx: number, fy: number, seed: number, sx: number, sy: number): number => {
    const u = fx * sx;
    const v = fy * sy;
    const su = F * sx;
    const sv = F * sy;
    return (
      (fbm(u, v, seed, 4) * (su - u) * (sv - v) +
        fbm(u - su, v, seed, 4) * u * (sv - v) +
        fbm(u, v - sv, seed, 4) * (su - u) * v +
        fbm(u - su, v - sv, seed, 4) * u * v) /
      (su * sv)
    );
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * F;
      const fy = (y / size) * F;
      // Fibre: strongly anisotropic, so it reads as a paper/canvas weave.
      const fibre = wrapped(fx, fy, 8123, 1, 7.5) - 0.5;
      const weave = wrapped(fx, fy, 5501, 7.5, 1) - 0.5;
      const broad = wrapped(fx, fy, 2207, 1, 1) - 0.5;
      // Speckle: integer hash is exactly periodic on `size`, so it tiles free.
      const speck = hash2(x, y, 61) - 0.5;

      const v = 128 + (fibre * 46 + weave * 30 + broad * 58 + speck * 34);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** Shared helper: lays the grain over an in-progress canvas. */
export function overlayGrain(ctx: Ctx, w: number, h: number, alpha: number): void {
  const [tile, tctx] = makeCanvas(64, 64);
  const img = tctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = 128 + (hash2(x, y, 17) - 0.5) * 120;
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
