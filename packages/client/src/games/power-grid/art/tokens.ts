/**
 * Resource tokens — coal, oil, garbage, uranium.
 *
 * These appear on plant cards and along the resource market track at small
 * sizes, so they are separated on THREE channels, not one:
 *
 *   silhouette  angular chunk / upright drum / cinched sack / hexagonal flask
 *   value       coal and oil are dark, garbage mid, uranium bright
 *   hue         coal cool slate, oil warm black + amber, garbage olive,
 *               uranium acid green
 *
 * Silhouette is the channel that survives both a 14 px render and a
 * deuteranope's eye, which is why each token gets a genuinely different
 * outline rather than four discs in four colours.
 */

import {
  bevel,
  css,
  dropShadow,
  hexToRgb,
  keyline,
  linGrad,
  makeCanvas,
  mix,
  radGrad,
  shade,
  type Ctx,
  type RGB,
} from './raster';
import type { ResourceType } from '@game/power-grid';

const WHITE: RGB = { r: 255, g: 255, b: 255 };

interface TokenSpec {
  base: RGB;
  dark: RGB;
  light: RGB;
  accent: RGB;
}

const SPECS: Record<ResourceType, TokenSpec> = {
  // Anthracite: cool, near-black, with a hard blue-grey sheen on fresh faces.
  coal: {
    base: hexToRgb('#39424e'),
    dark: hexToRgb('#0c1015'),
    light: hexToRgb('#8b97a6'),
    accent: hexToRgb('#5d6b7d'),
  },
  // Crude drum: warm black steel banded in oxidised amber.
  oil: {
    base: hexToRgb('#2a221c'),
    dark: hexToRgb('#0c0907'),
    light: hexToRgb('#6d5a45'),
    accent: hexToRgb('#c98229'),
  },
  // Refuse sack: olive canvas, dusty and matte.
  garbage: {
    base: hexToRgb('#8a7f3a'),
    dark: hexToRgb('#3f3a17'),
    light: hexToRgb('#d0c47a'),
    accent: hexToRgb('#6b6228'),
  },
  // Fuel flask: acid green under its own emissive glow.
  uranium: {
    base: hexToRgb('#3fbf5c'),
    dark: hexToRgb('#0f4a22'),
    light: hexToRgb('#b6ffc4'),
    accent: hexToRgb('#7dffa2'),
  },
};

/** Soft contact shadow so the token sits on a surface rather than floating. */
function contact(ctx: Ctx, S: number, cy = 0.9, rx = 0.34, alpha = 0.62): void {
  ctx.save();
  const g = radGrad(ctx, S * 0.5, S * cy, 0, S * 0.5, S * cy, S * rx, [
    [0, `rgba(0,0,0,${alpha})`],
    [0.5, `rgba(0,0,0,${alpha * 0.4})`],
    [1, 'rgba(0,0,0,0)'],
  ]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(S * 0.5, S * cy, S * rx, S * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * coal — an irregular faceted chunk
 * ------------------------------------------------------------------ */

function drawCoal(ctx: Ctx, S: number, s: TokenSpec): Path2D {
  // Deliberately jagged, with unequal edge lengths and one concave notch on the
  // lower left. An even polygon anti-aliases into a disc at 16 px, which is
  // exactly what coal must NOT look like — the whole point is that its
  // silhouette is angular where the others are round, banded or cinched.
  const outline: [number, number][] = [
    [0.11, 0.47], [0.27, 0.20], [0.46, 0.29], [0.59, 0.13], [0.81, 0.25],
    [0.91, 0.49], [0.76, 0.59], [0.88, 0.77], [0.61, 0.91], [0.38, 0.84],
    [0.30, 0.70], [0.16, 0.76],
  ];
  const p = new Path2D();
  outline.forEach(([x, y], i) => (i ? p.lineTo(x * S, y * S) : p.moveTo(x * S, y * S)));
  p.closePath();

  dropShadow(ctx, p, S * 0.06, S * 0.02, S * 0.03, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = linGrad(ctx, S * 0.2, S * 0.15, S * 0.85, S * 0.9, [
    [0, css(mix(s.base, s.light, 0.30))],
    [0.5, css(s.base)],
    [1, css(s.dark)],
  ]);
  ctx.fill(p);

  // Facets. Real coal fractures conchoidally: a few large flat planes catching
  // the light at different angles is what sells it as mineral rather than blob.
  const facets: [number, number][][] = [
    [[0.27, 0.20], [0.46, 0.29], [0.44, 0.52], [0.24, 0.46]],
    [[0.46, 0.29], [0.59, 0.13], [0.81, 0.25], [0.63, 0.42]],
    [[0.46, 0.29], [0.63, 0.42], [0.60, 0.70], [0.44, 0.52]],
    [[0.63, 0.42], [0.81, 0.25], [0.91, 0.49], [0.76, 0.59]],
    [[0.60, 0.70], [0.76, 0.59], [0.88, 0.77], [0.61, 0.91]],
    [[0.11, 0.47], [0.24, 0.46], [0.30, 0.70], [0.16, 0.76]],
    [[0.24, 0.46], [0.44, 0.52], [0.38, 0.84], [0.30, 0.70]],
  ];
  const tones = [0.50, 0.26, -0.18, -0.44, -0.56, -0.10, -0.34];
  ctx.save();
  ctx.clip(p);
  facets.forEach((f, i) => {
    const fp = new Path2D();
    f.forEach(([x, y], j) => (j ? fp.lineTo(x * S, y * S) : fp.moveTo(x * S, y * S)));
    fp.closePath();
    const t = tones[i]!;
    ctx.fillStyle = css(t >= 0 ? mix(s.base, s.light, t) : mix(s.base, s.dark, -t), 0.85);
    ctx.fill(fp);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = S * 0.010;
    ctx.stroke(fp);
  });
  // Specular glint on the top-left facet.
  ctx.fillStyle = radGrad(ctx, S * 0.35, S * 0.30, 0, S * 0.35, S * 0.30, S * 0.20, [
    [0, css(s.light, 0.55)],
    [1, css(s.light, 0)],
  ]);
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  return p;
}

/* ------------------------------------------------------------------ *
 * oil — an upright banded drum
 * ------------------------------------------------------------------ */

function drawOil(ctx: Ctx, S: number, s: TokenSpec): Path2D {
  const x = 0.24 * S;
  const w = 0.52 * S;
  const yTop = 0.20 * S;
  const h = 0.64 * S;
  const ry = 0.055 * S;

  // Body silhouette: a cylinder — vertical sides, elliptical cap and base.
  const body = new Path2D();
  body.moveTo(x, yTop);
  body.lineTo(x, yTop + h);
  body.ellipse(x + w / 2, yTop + h, w / 2, ry, 0, Math.PI, 0, true);
  body.lineTo(x + w, yTop);
  body.ellipse(x + w / 2, yTop, w / 2, ry, 0, 0, Math.PI, true);
  body.closePath();

  dropShadow(ctx, body, S * 0.06, S * 0.02, S * 0.03, 'rgba(0,0,0,0.6)');

  // Cylindrical shading: light wraps round the barrel.
  ctx.fillStyle = linGrad(ctx, x, 0, x + w, 0, [
    [0, css(mix(s.base, s.dark, 0.55))],
    [0.22, css(mix(s.base, s.light, 0.42))],
    [0.5, css(s.base)],
    [0.82, css(mix(s.base, s.dark, 0.45))],
    [1, css(mix(s.base, s.dark, 0.7))],
  ]);
  ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  // Two oxidised amber bands — the identity mark, and a warm counterpoint to
  // coal's cool slate at any size.
  for (const by of [0.36, 0.62]) {
    ctx.fillStyle = linGrad(ctx, x, 0, x + w, 0, [
      [0, css(mix(s.accent, s.dark, 0.62))],
      [0.24, css(mix(s.accent, WHITE, 0.20))],
      [0.55, css(s.accent)],
      [1, css(mix(s.accent, s.dark, 0.55))],
    ]);
    ctx.fillRect(x, yTop + h * by - S * 0.045, w, S * 0.09);
  }
  // Rolling hoops.
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = S * 0.010;
  for (const by of [0.20, 0.50, 0.80]) {
    ctx.beginPath();
    ctx.moveTo(x, yTop + h * by);
    ctx.lineTo(x + w, yTop + h * by);
    ctx.stroke();
  }
  ctx.restore();

  // Lid, seen from slightly above.
  const lid = new Path2D();
  lid.ellipse(x + w / 2, yTop, w / 2, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = radGrad(ctx, x + w * 0.34, yTop - ry * 0.4, 0, x + w / 2, yTop, w / 2, [
    [0, css(mix(s.light, WHITE, 0.25))],
    [0.6, css(mix(s.base, s.light, 0.30))],
    [1, css(mix(s.base, s.dark, 0.30))],
  ]);
  ctx.fill(lid);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = S * 0.012;
  ctx.stroke(lid);
  // Bung.
  ctx.fillStyle = css(mix(s.accent, s.dark, 0.35));
  ctx.beginPath();
  ctx.ellipse(x + w * 0.68, yTop + ry * 0.15, w * 0.09, ry * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  return body;
}

/* ------------------------------------------------------------------ *
 * garbage — a cinched sack
 * ------------------------------------------------------------------ */

function drawGarbage(ctx: Ctx, S: number, s: TokenSpec): Path2D {
  const p = new Path2D();
  // Heavy bottom, pinched neck, two flared ears — unmistakable at any size.
  p.moveTo(0.50 * S, 0.13 * S);
  p.bezierCurveTo(0.30 * S, 0.10 * S, 0.30 * S, 0.19 * S, 0.40 * S, 0.26 * S);
  p.bezierCurveTo(0.20 * S, 0.36 * S, 0.11 * S, 0.58 * S, 0.16 * S, 0.74 * S);
  p.bezierCurveTo(0.22 * S, 0.90 * S, 0.78 * S, 0.90 * S, 0.84 * S, 0.74 * S);
  p.bezierCurveTo(0.89 * S, 0.58 * S, 0.80 * S, 0.36 * S, 0.60 * S, 0.26 * S);
  p.bezierCurveTo(0.70 * S, 0.19 * S, 0.70 * S, 0.10 * S, 0.50 * S, 0.13 * S);
  p.closePath();

  dropShadow(ctx, p, S * 0.06, S * 0.02, S * 0.03, 'rgba(0,0,0,0.58)');
  ctx.fillStyle = radGrad(ctx, S * 0.36, S * 0.42, S * 0.04, S * 0.5, S * 0.6, S * 0.5, [
    [0, css(mix(s.base, s.light, 0.45))],
    [0.45, css(s.base)],
    [1, css(mix(s.base, s.dark, 0.55))],
  ]);
  ctx.fill(p);

  ctx.save();
  ctx.clip(p);
  // Creases radiating from the tie — the read that says "soft bag" rather
  // than "rock".
  ctx.strokeStyle = css(s.accent, 0.5);
  ctx.lineWidth = S * 0.016;
  ctx.lineCap = 'round';
  const creases: [number, number, number, number, number, number][] = [
    [0.47, 0.30, 0.33, 0.48, 0.28, 0.70],
    [0.52, 0.30, 0.58, 0.52, 0.62, 0.74],
    [0.50, 0.32, 0.44, 0.56, 0.46, 0.78],
    [0.55, 0.31, 0.72, 0.50, 0.74, 0.66],
  ];
  for (const [ax, ay, bx, by, cx2, cy2] of creases) {
    ctx.beginPath();
    ctx.moveTo(ax * S, ay * S);
    ctx.quadraticCurveTo(bx * S, by * S, cx2 * S, cy2 * S);
    ctx.stroke();
  }
  // Weight in the bottom of the bag.
  ctx.fillStyle = linGrad(ctx, 0, S * 0.6, 0, S * 0.9, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.42)'],
  ]);
  ctx.fillRect(0, S * 0.55, S, S * 0.45);
  ctx.restore();

  // The tie.
  ctx.strokeStyle = css(mix(s.dark, s.accent, 0.35));
  ctx.lineWidth = S * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0.41 * S, 0.255 * S);
  ctx.lineTo(0.59 * S, 0.255 * S);
  ctx.stroke();

  return p;
}

/* ------------------------------------------------------------------ *
 * uranium — a hexagonal fuel flask, emissive
 * ------------------------------------------------------------------ */

function drawUranium(ctx: Ctx, S: number, s: TokenSpec): Path2D {
  const cx = 0.5 * S;
  const cy = 0.51 * S;
  const r = 0.37 * S;
  const p = new Path2D();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 1.02;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();

  // Emissive halo, drawn first so the flask sits inside its own light.
  ctx.save();
  ctx.fillStyle = radGrad(ctx, cx, cy, r * 0.5, cx, cy, r * 1.75, [
    [0, css(s.accent, 0.45)],
    [0.5, css(s.base, 0.18)],
    [1, css(s.base, 0)],
  ]);
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  dropShadow(ctx, p, S * 0.055, S * 0.015, S * 0.025, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = linGrad(ctx, cx - r, cy - r, cx + r, cy + r, [
    [0, css(mix(s.base, s.light, 0.55))],
    [0.42, css(s.base)],
    [1, css(mix(s.base, s.dark, 0.62))],
  ]);
  ctx.fill(p);

  ctx.save();
  ctx.clip(p);
  // Bevelled shoulder faces on the hexagon, so it reads as machined metal.
  ctx.fillStyle = css(mix(s.base, s.light, 0.42), 0.55);
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r * 0.5);
  ctx.lineTo(cx, cy - r * 1.02);
  ctx.lineTo(cx + r, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.72, cy - r * 0.34);
  ctx.lineTo(cx, cy - r * 0.72);
  ctx.lineTo(cx - r * 0.72, cy - r * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.moveTo(cx - r, cy + r * 0.5);
  ctx.lineTo(cx, cy + r * 1.02);
  ctx.lineTo(cx + r, cy + r * 0.5);
  ctx.lineTo(cx + r * 0.72, cy + r * 0.34);
  ctx.lineTo(cx, cy + r * 0.72);
  ctx.lineTo(cx - r * 0.72, cy + r * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Radiation trefoil — an instantly-read icon that also works in silhouette.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = css(mix(s.dark, { r: 0, g: 0, b: 0 }, 0.45), 0.9);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const a0 = -Math.PI / 2 + (i / 3) * Math.PI * 2 - 0.52;
    const a1 = a0 + 1.05;
    ctx.arc(0, 0, r * 0.62, a0, a1);
    ctx.arc(0, 0, r * 0.26, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return p;
}

/* ------------------------------------------------------------------ */

const DRAW: Record<ResourceType, (ctx: Ctx, S: number, s: TokenSpec) => Path2D> = {
  coal: drawCoal,
  oil: drawOil,
  garbage: drawGarbage,
  uranium: drawUranium,
};

export function resourceTokenTexture(type: ResourceType, size = 256): string {
  const [c, ctx] = makeCanvas(size, size);
  const spec = SPECS[type];

  contact(ctx, size, type === 'oil' ? 0.87 : 0.885, 0.32, type === 'uranium' ? 0.5 : 0.6);
  const path = DRAW[type](ctx, size, spec);

  bevel(ctx, path, size * 0.014, 'rgba(255,255,255,0.24)', 'rgba(0,0,0,0.45)', -1, -1);
  keyline(ctx, path, size * 0.030, 'rgba(4,7,11,0.92)');

  return c.toDataURL();
}

/** The token's representative colour, for market bands and legends. */
export function resourceAccent(type: ResourceType): string {
  const s = SPECS[type];
  return css(type === 'oil' ? s.accent : shade(s.base, 0.06));
}
