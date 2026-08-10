/**
 * Player houses.
 *
 * The hard constraint is legibility: a house is ~20 px on a board that is
 * itself painted, textured and covered in connection lines. Three things buy
 * that legibility, in order of importance:
 *
 *   1. a heavy dark keyline, so the piece separates from ANY background;
 *   2. a chunky, unmistakable silhouette with a wide base;
 *   3. three-plane shading (lit roof / mid front / dark side) so it reads as a
 *      physical piece rather than a coloured pentagon.
 *
 * Seat identity is carried by colour AND by an embossed sigil (QUALITY-BAR V3
 * — colour is never the only channel), and the six hues are already staggered
 * in lightness in `tokens.scss` so they survive deuteranopia and protanopia.
 */

import {
  bevel,
  css,
  dropShadow,
  hexToRgb,
  keyline,
  linGrad,
  luminance,
  makeCanvas,
  mix,
  numToRgb,
  poly,
  shade,
  type RGB,
} from './raster';
import type { SeatSigil } from './index';

/* ------------------------------------------------------------------ *
 * geometry — one gable house in a 3/4 view, in normalised [0,1] space
 * ------------------------------------------------------------------ */

// Front face pentagon, then the two roof planes and the right-hand wall. The
// depth vector is (+0.16, -0.10): we look slightly down and from the left.
const FRONT: [number, number][] = [
  [0.16, 0.45],
  [0.42, 0.17],
  [0.68, 0.45],
  [0.68, 0.87],
  [0.16, 0.87],
];
const ROOF_L: [number, number][] = [
  [0.42, 0.17],
  [0.58, 0.07],
  [0.32, 0.35],
  [0.16, 0.45],
];
const ROOF_R: [number, number][] = [
  [0.42, 0.17],
  [0.58, 0.07],
  [0.84, 0.35],
  [0.68, 0.45],
];
const SIDE: [number, number][] = [
  [0.68, 0.45],
  [0.84, 0.35],
  [0.84, 0.77],
  [0.68, 0.87],
];
/** Outer boundary, used for the keyline, the shadow and the rim light. */
const SILHOUETTE: [number, number][] = [
  [0.16, 0.87],
  [0.16, 0.45],
  [0.32, 0.35],
  [0.58, 0.07],
  [0.84, 0.35],
  [0.84, 0.77],
  [0.68, 0.87],
];

/* ------------------------------------------------------------------ */

export interface HouseColors {
  base: number;
  light: number;
  dark: number;
  ink: number;
}

/** Draws one seat sigil centred at (cx,cy) with radius r. */
function drawSigil(sigil: SeatSigil | 'trust', cx: number, cy: number, r: number): Path2D {
  const p = new Path2D();
  const ring = (n: number, rot: number) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.closePath();
  };

  switch (sigil) {
    case 'triangle':
      ring(3, -Math.PI / 2);
      break;
    case 'square':
      ring(4, -Math.PI / 4);
      break;
    case 'diamond':
      ring(4, -Math.PI / 2);
      break;
    case 'hexagon':
      ring(6, -Math.PI / 2);
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      break;
    case 'trust':
      // Deliberately not one of the six seat sigils: a stacked double bar.
      p.rect(cx - r, cy - r * 0.62, r * 2, r * 0.5);
      p.rect(cx - r, cy + r * 0.14, r * 2, r * 0.5);
      break;
    case 'circle':
    default:
      p.arc(cx, cy, r, 0, Math.PI * 2);
      break;
  }
  return p;
}

/**
 * Renders one house sprite.
 *
 * @param colors seat ramp, already resolved from the design tokens
 * @param sigil  identity glyph embossed on the front face
 * @param size   texture edge length; 256 downsamples cleanly to 20 px
 */
export function houseTexture(colors: HouseColors, sigil: SeatSigil | 'trust', size = 256): string {
  const [c, ctx] = makeCanvas(size, size);
  const S = size;

  const base = numToRgb(colors.base);
  const light = numToRgb(colors.light);
  const dark = numToRgb(colors.dark);
  const ink = numToRgb(colors.ink);

  const sil = poly(SILHOUETTE, S, S);

  /* ---- contact + cast shadow: what makes the piece sit ON the board ---- */
  ctx.save();
  ctx.globalAlpha = 0.5;
  const gShadow = ctx.createRadialGradient(S * 0.5, S * 0.885, 0, S * 0.5, S * 0.885, S * 0.33);
  gShadow.addColorStop(0, 'rgba(0,0,0,0.72)');
  gShadow.addColorStop(0.55, 'rgba(0,0,0,0.30)');
  gShadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gShadow;
  ctx.beginPath();
  ctx.ellipse(S * 0.5, S * 0.885, S * 0.36, S * 0.085, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  dropShadow(ctx, sil, S * 0.055, S * 0.018, S * 0.028, 'rgba(0,0,0,0.55)');

  /* ---- faces ----
   * Three tone steps off the seat ramp. The roof takes the key light, the
   * front face sits at base value, the right wall drops into shadow. */
  const paintFace = (pts: [number, number][], top: RGB, bottom: RGB) => {
    const p = poly(pts, S, S);
    let minY = 1;
    let maxY = 0;
    for (const [, y] of pts) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    ctx.fillStyle = linGrad(ctx, 0, minY * S, 0, maxY * S, [
      [0, css(top)],
      [1, css(bottom)],
    ]);
    ctx.fill(p);
    return p;
  };

  // Roof, lit plane — mixes toward the seat's own light stop rather than to
  // white, so a lit roof still reads as that seat's colour.
  paintFace(ROOF_L, mix(light, base, 0.10), mix(light, base, 0.52));
  // Roof, off-key plane.
  paintFace(ROOF_R, mix(base, light, 0.34), mix(base, light, 0.06));
  // Front wall.
  const front = paintFace(FRONT, mix(base, light, 0.16), mix(base, dark, 0.30));
  // Right wall, in shadow.
  paintFace(SIDE, mix(base, dark, 0.46), mix(base, dark, 0.68));

  /* ---- plinth: a darker band at the base grounds the piece ---- */
  ctx.save();
  ctx.clip(front);
  ctx.fillStyle = linGrad(ctx, 0, S * 0.78, 0, S * 0.87, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.34)'],
  ]);
  ctx.fillRect(0, S * 0.76, S, S * 0.12);
  ctx.restore();

  /* ---- ridge and eave lines: the edges between planes ---- */
  ctx.save();
  ctx.lineWidth = Math.max(1, S * 0.008);
  ctx.strokeStyle = css(shade(dark, -0.15), 0.5);
  ctx.beginPath();
  ctx.moveTo(0.42 * S, 0.17 * S);
  ctx.lineTo(0.68 * S, 0.45 * S); // front-right gable edge
  ctx.moveTo(0.68 * S, 0.45 * S);
  ctx.lineTo(0.84 * S, 0.35 * S); // right eave
  ctx.stroke();
  // Ridge catches a specular line.
  ctx.strokeStyle = css(mix(light, { r: 255, g: 255, b: 255 }, 0.35), 0.55);
  ctx.beginPath();
  ctx.moveTo(0.42 * S, 0.17 * S);
  ctx.lineTo(0.58 * S, 0.07 * S);
  ctx.stroke();
  ctx.restore();

  /* ---- sigil, embossed into the front face ---- */
  /*
   * Under deuteranopia and protanopia the seat hues collapse into three pairs
   * — red/yellow, blue/purple, green/black — separated mainly by lightness.
   * The sigil is therefore not decoration, it is the load-bearing identity
   * channel, so it is drawn large and hard-edged enough to survive being
   * downsampled to 20 px.
   */
  const sx = 0.42 * S;
  const sy = 0.635 * S;
  const sr = 0.158 * S;
  const glyph = drawSigil(sigil, sx, sy, sr);
  ctx.save();
  ctx.clip(front);
  // Dropped relief beneath, for depth.
  ctx.save();
  ctx.translate(0, S * 0.014);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill(glyph);
  ctx.restore();
  // A counter-value halo: keeps the glyph edge crisp against the wall once the
  // sprite is scaled down and the antialiasing starts eating thin shapes.
  ctx.lineJoin = 'round';
  ctx.lineWidth = S * 0.030;
  ctx.strokeStyle = luminance(ink) > 0.4 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.42)';
  ctx.stroke(glyph);
  // The glyph itself, in the seat's guaranteed-legible ink.
  ctx.fillStyle = css(ink, 1);
  ctx.fill(glyph);
  ctx.restore();

  /* ---- inner bevel + hard keyline ---- */
  bevel(ctx, sil, S * 0.016, 'rgba(255,255,255,0.26)', 'rgba(0,0,0,0.42)', -1, -1);
  keyline(ctx, sil, S * 0.036, 'rgba(5,9,14,0.94)');

  /* ---- outer rim light on the shadow side, so the keyline does not
   * disappear against the board's own dark passages ---- */
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.lineWidth = S * 0.07;
  ctx.lineJoin = 'round';
  const halo = luminance(base) > 0.30 ? 'rgba(0,0,0,0.42)' : css(shade(base, 0.18), 0.34);
  ctx.strokeStyle = halo;
  ctx.stroke(sil);
  ctx.restore();

  return c.toDataURL();
}

/** Convenience for the Trust faction's neutral piece (§13). */
export function trustHouseTexture(size = 256): string {
  const neutral = hexToRgb('#93a2b5');
  return houseTexture(
    {
      base: (neutral.r << 16) | (neutral.g << 8) | neutral.b,
      light: 0xc8d2df,
      dark: 0x2f3742,
      ink: 0x0b1016,
    },
    'trust',
    size,
  );
}
