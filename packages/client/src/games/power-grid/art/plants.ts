/**
 * Power plant card illustrations.
 *
 * §1 of the rules says the illustration has no gameplay effect. That is true of
 * the *rules*, and irrelevant to the *interface*: a player scanning the market
 * decides what to bid on by fuel type, so the picture has to say "this burns
 * coal" before the icon row is read. So each fuel category gets a distinct
 * industrial silhouette AND a distinct key colour, and the composition varies
 * deterministically with the plant's printed number so the 42 cards are not
 * six images repeated seven times.
 *
 * Built as a layered matte: graded sky, sun glow, hazed far ridge, mid-ground
 * machinery with rim light, foreground ground, plumes, then grain and vignette.
 * Layering and light are what make procedural art look painted; a flat icon on
 * a flat field is the failure mode.
 */

import {
  css,
  fbm,
  hexToRgb,
  linGrad,
  makeCanvas,
  mix,
  radGrad,
  rng,
  shade,
  type Ctx,
  type RGB,
} from './raster';
import { overlayGrain } from './plates';
import type { PowerPlant } from '@game/power-grid';

export type FuelKey = 'coal' | 'oil' | 'garbage' | 'uranium' | 'hybrid' | 'eco';

interface Theme {
  accent: string;
  skyTop: RGB;
  skyBottom: RGB;
  sun: RGB;
  ridge: RGB;
  ground: RGB;
  metal: RGB;
  titles: string[];
}

const THEMES: Record<FuelKey, Theme> = {
  coal: {
    accent: '#8b6b4a',
    skyTop: hexToRgb('#221b21'),
    skyBottom: hexToRgb('#7a4c2c'),
    sun: hexToRgb('#ffb765'),
    ridge: hexToRgb('#241c1c'),
    ground: hexToRgb('#171313'),
    metal: hexToRgb('#2b2622'),
    titles: ['Lignite Boiler', 'Anthracite Furnace', 'Coal Steam Works', 'Brown Coal Station', 'Pithead Generator'],
  },
  oil: {
    accent: '#5a6b8b',
    skyTop: hexToRgb('#161d2c'),
    skyBottom: hexToRgb('#4a5570'),
    sun: hexToRgb('#ffd0a0'),
    ridge: hexToRgb('#181e29'),
    ground: hexToRgb('#111620'),
    metal: hexToRgb('#232b39'),
    titles: ['Oil Burner', 'Fuel Oil Turbine', 'Crude Fired Plant', 'Distillate Station', 'Heavy Oil Works'],
  },
  garbage: {
    accent: '#b3922f',
    skyTop: hexToRgb('#20200f'),
    skyBottom: hexToRgb('#6d6224'),
    sun: hexToRgb('#ffe28a'),
    ridge: hexToRgb('#221f14'),
    ground: hexToRgb('#151308'),
    metal: hexToRgb('#2a2717'),
    titles: ['Refuse Incinerator', 'Waste-to-Energy Plant', 'Municipal Burner', 'Refuse Furnace', 'Recovery Furnace'],
  },
  uranium: {
    accent: '#3fbf55',
    skyTop: hexToRgb('#07161a'),
    skyBottom: hexToRgb('#164a3c'),
    sun: hexToRgb('#a6ffd2'),
    ridge: hexToRgb('#0d1d1e'),
    ground: hexToRgb('#081214'),
    metal: hexToRgb('#1a2a2a'),
    titles: ['Fission Reactor', 'Pressurised Water Pile', 'Nuclear Station', 'Breeder Reactor', 'Containment Block'],
  },
  hybrid: {
    accent: '#a2764f',
    skyTop: hexToRgb('#1d1a20'),
    skyBottom: hexToRgb('#6b5236'),
    sun: hexToRgb('#ffc98a'),
    ridge: hexToRgb('#221d1c'),
    ground: hexToRgb('#151211'),
    metal: hexToRgb('#2a2621'),
    titles: ['Hybrid Furnace', 'Dual-Fuel Station', 'Coal & Oil Works', 'Convertible Boiler', 'Mixed Firing Plant'],
  },
  eco: {
    accent: '#46e2ff',
    skyTop: hexToRgb('#0a2233'),
    skyBottom: hexToRgb('#2e7f9a'),
    sun: hexToRgb('#d8fbff'),
    ridge: hexToRgb('#12303c'),
    ground: hexToRgb('#0c1f28'),
    metal: hexToRgb('#20404c'),
    // Titles must describe what is actually drawn. The eco scene is always
    // wind turbines plus a solar bank, so no tidal or geothermal names.
    titles: ['Renewable Array', 'Wind Farm', 'Solar Field', 'Turbine Park', 'Wind & Solar Works'],
  },
};

/* ------------------------------------------------------------------ *
 * scene primitives
 *
 * Every structure is drawn the same way: a vertical gradient body (never a
 * flat silhouette), a rim light down the sun-facing edge, and a dark keyline.
 * That trio is what gives a 40 px chimney visible form.
 * ------------------------------------------------------------------ */

interface Paint {
  metal: RGB;
  rim: RGB;
  sunX: number;
}

function body(ctx: Ctx, path: Path2D, p: Paint, top: number, bottom: number, lift = 0): void {
  ctx.fillStyle = linGrad(ctx, 0, top, 0, bottom, [
    [0, css(shade(p.metal, 0.20 + lift))],
    [0.55, css(shade(p.metal, 0.02 + lift))],
    [1, css(shade(p.metal, -0.35))],
  ]);
  ctx.fill(path);
}

function rimLight(ctx: Ctx, path: Path2D, p: Paint, w: number, alpha = 0.7): void {
  ctx.save();
  ctx.clip(path);
  ctx.lineWidth = w * 2;
  ctx.strokeStyle = css(p.rim, alpha);
  ctx.save();
  ctx.translate(p.sunX < 0.5 ? w : -w, 0);
  ctx.stroke(path);
  ctx.restore();
  ctx.restore();
}

function outline(ctx: Ctx, path: Path2D, w: number): void {
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke(path);
}

/** Hyperboloid natural-draught cooling tower. */
function coolingTower(ctx: Ctx, p: Paint, x: number, baseY: number, w: number, h: number): void {
  const path = new Path2D();
  const topW = w * 0.62;
  const waistW = w * 0.50;
  path.moveTo(x - w / 2, baseY);
  path.bezierCurveTo(x - waistW / 2 - w * 0.06, baseY - h * 0.55, x - topW / 2, baseY - h * 0.8, x - topW / 2, baseY - h);
  path.lineTo(x + topW / 2, baseY - h);
  path.bezierCurveTo(x + topW / 2, baseY - h * 0.8, x + waistW / 2 + w * 0.06, baseY - h * 0.55, x + w / 2, baseY);
  path.closePath();
  body(ctx, path, p, baseY - h, baseY);
  // Lip.
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(x - w, baseY - h, w * 2, h * 0.045);
  ctx.restore();
  rimLight(ctx, path, p, w * 0.055);
  outline(ctx, path, Math.max(1, w * 0.035));
}

/** Tapered chimney with hazard banding. */
function chimney(ctx: Ctx, p: Paint, x: number, baseY: number, w: number, h: number, bands = true): void {
  const path = new Path2D();
  path.moveTo(x - w / 2, baseY);
  path.lineTo(x - w * 0.30, baseY - h);
  path.lineTo(x + w * 0.30, baseY - h);
  path.lineTo(x + w / 2, baseY);
  path.closePath();
  body(ctx, path, p, baseY - h, baseY);
  if (bands) {
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x - w, baseY - h * (0.86 - i * 0.16), w * 2, h * 0.045);
    ctx.restore();
  }
  rimLight(ctx, path, p, w * 0.10);
  outline(ctx, path, Math.max(1, w * 0.07));
}

/** Boiler house / turbine hall — a stepped industrial block. */
function hall(ctx: Ctx, p: Paint, x: number, baseY: number, w: number, h: number, seed: number): void {
  const r = rng(seed);
  const path = new Path2D();
  path.moveTo(x - w / 2, baseY);
  path.lineTo(x - w / 2, baseY - h * 0.72);
  path.lineTo(x - w * 0.18, baseY - h * 0.72);
  path.lineTo(x - w * 0.18, baseY - h);
  path.lineTo(x + w * 0.34, baseY - h);
  path.lineTo(x + w * 0.34, baseY - h * 0.58);
  path.lineTo(x + w / 2, baseY - h * 0.58);
  path.lineTo(x + w / 2, baseY);
  path.closePath();
  body(ctx, path, p, baseY - h, baseY);
  // Lit windows — the detail that makes the plant read as running.
  ctx.save();
  ctx.clip(path);
  for (let i = 0; i < 22; i++) {
    if (r() < 0.42) continue;
    const wx = x - w / 2 + r() * w;
    const wy = baseY - h * 0.1 - r() * h * 0.75;
    ctx.fillStyle = `rgba(255,196,120,${0.14 + r() * 0.34})`;
    ctx.fillRect(wx, wy, w * 0.042, h * 0.030);
  }
  ctx.restore();
  rimLight(ctx, path, p, w * 0.02);
  outline(ctx, path, Math.max(1, w * 0.02));
}

/** Distillation column with collar rings. */
function column(ctx: Ctx, p: Paint, x: number, baseY: number, w: number, h: number): void {
  const path = new Path2D();
  path.moveTo(x - w / 2, baseY);
  path.lineTo(x - w / 2, baseY - h + w * 0.5);
  path.quadraticCurveTo(x - w / 2, baseY - h, x, baseY - h);
  path.quadraticCurveTo(x + w / 2, baseY - h, x + w / 2, baseY - h + w * 0.5);
  path.lineTo(x + w / 2, baseY);
  path.closePath();
  body(ctx, path, p, baseY - h, baseY);
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(1, w * 0.10);
  for (let i = 1; i < 6; i++) {
    const yy = baseY - (h * i) / 6;
    ctx.beginPath();
    ctx.moveTo(x - w, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
  }
  ctx.restore();
  rimLight(ctx, path, p, w * 0.13);
  outline(ctx, path, Math.max(1, w * 0.09));
}

/** Spherical pressure tank on legs. */
function sphereTank(ctx: Ctx, p: Paint, x: number, baseY: number, r: number): void {
  ctx.strokeStyle = css(shade(p.metal, -0.4));
  ctx.lineWidth = Math.max(1, r * 0.10);
  for (const dx of [-0.62, -0.2, 0.2, 0.62]) {
    ctx.beginPath();
    ctx.moveTo(x + r * dx, baseY - r * 0.55);
    ctx.lineTo(x + r * dx * 1.15, baseY);
    ctx.stroke();
  }
  const path = new Path2D();
  path.arc(x, baseY - r * 1.15, r, 0, Math.PI * 2);
  ctx.fillStyle = radGrad(ctx, x - r * 0.35, baseY - r * 1.5, r * 0.06, x, baseY - r * 1.15, r, [
    [0, css(shade(p.metal, 0.44))],
    [0.6, css(shade(p.metal, 0.02))],
    [1, css(shade(p.metal, -0.42))],
  ]);
  ctx.fill(path);
  outline(ctx, path, Math.max(1, r * 0.09));
}

/** Reactor containment dome. */
function dome(ctx: Ctx, p: Paint, x: number, baseY: number, w: number, h: number): void {
  const path = new Path2D();
  const r = w / 2;
  path.moveTo(x - r, baseY);
  path.lineTo(x - r, baseY - (h - r));
  path.arc(x, baseY - (h - r), r, Math.PI, 0);
  path.lineTo(x + r, baseY);
  path.closePath();
  body(ctx, path, p, baseY - h, baseY, 0.06);
  rimLight(ctx, path, p, w * 0.03);
  outline(ctx, path, Math.max(1, w * 0.025));
}

/** Three-blade wind turbine. */
function turbine(ctx: Ctx, p: Paint, x: number, baseY: number, h: number, phase: number): void {
  const w = h * 0.045;
  const hubY = baseY - h;
  const mast = new Path2D();
  mast.moveTo(x - w, baseY);
  mast.lineTo(x - w * 0.42, hubY);
  mast.lineTo(x + w * 0.42, hubY);
  mast.lineTo(x + w, baseY);
  mast.closePath();
  ctx.fillStyle = linGrad(ctx, x - w, 0, x + w, 0, [
    [0, css(shade(p.metal, 0.55))],
    [0.55, css(shade(p.metal, 0.24))],
    [1, css(shade(p.metal, -0.2))],
  ]);
  ctx.fill(mast);
  outline(ctx, mast, Math.max(1, w * 0.5));

  const bl = h * 0.42;
  ctx.save();
  ctx.translate(x, hubY);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(phase + (i / 3) * Math.PI * 2);
    const b = new Path2D();
    b.moveTo(0, -bl * 0.06);
    b.quadraticCurveTo(bl * 0.55, -bl * 0.10, bl, -bl * 0.012);
    b.quadraticCurveTo(bl * 0.55, bl * 0.045, 0, bl * 0.06);
    b.closePath();
    ctx.fillStyle = css(shade(p.metal, 0.5));
    ctx.fill(b);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, h * 0.006);
    ctx.stroke(b);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, h * 0.026, 0, Math.PI * 2);
  ctx.fillStyle = css(shade(p.metal, 0.62));
  ctx.fill();
  ctx.restore();
}

/** Tilted solar panel rank. */
function solarBank(ctx: Ctx, p: Paint, x: number, baseY: number, w: number, h: number, accent: RGB): void {
  const path = new Path2D();
  path.moveTo(x - w / 2, baseY);
  path.lineTo(x - w * 0.34, baseY - h);
  path.lineTo(x + w / 2, baseY - h);
  path.lineTo(x + w * 0.34, baseY);
  path.closePath();
  ctx.fillStyle = linGrad(ctx, x - w / 2, baseY, x + w / 2, baseY - h, [
    [0, css(mix(accent, { r: 0, g: 0, b: 0 }, 0.55))],
    [0.5, css(mix(accent, { r: 255, g: 255, b: 255 }, 0.16))],
    [1, css(mix(accent, { r: 0, g: 0, b: 0 }, 0.32))],
  ]);
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, w * 0.008);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + w * 0.16 * t + w * t, baseY);
    ctx.lineTo(x - w * 0.34 + w * 0.84 * t, baseY - h);
    ctx.stroke();
  }
  ctx.restore();
  outline(ctx, path, Math.max(1, w * 0.012));
  ctx.strokeStyle = css(shade(p.metal, -0.3));
  ctx.lineWidth = Math.max(1, w * 0.02);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h * 0.5);
  ctx.lineTo(x + w * 0.02, baseY + h * 0.16);
  ctx.stroke();
}

/** Rising plume of steam or smoke — clustered puffs, thinning with height. */
function plume(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  alpha: number,
  seed: number,
  drift = 0.35,
): void {
  const r = rng(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const px = x + t * h * drift + (r() - 0.5) * w * (0.4 + t * 1.5);
    const py = y - t * h;
    const pr = w * (0.42 + t * 1.5) * (0.6 + r() * 0.6);
    const a = alpha * (1 - t) * (1 - t) * (0.35 + r() * 0.65);
    ctx.fillStyle = radGrad(ctx, px, py, 0, px, py, pr, [
      [0, css(color, a)],
      [0.55, css(color, a * 0.42)],
      [1, css(color, 0)],
    ]);
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Gas flare — a bright tongue of flame with its own bloom. */
function flare(ctx: Ctx, x: number, y: number, s: number, seed: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = radGrad(ctx, x, y - s * 0.5, 0, x, y - s * 0.5, s * 2.4, [
    [0, 'rgba(255,170,70,0.55)'],
    [0.45, 'rgba(255,120,40,0.18)'],
    [1, 'rgba(255,100,30,0)'],
  ]);
  ctx.fillRect(x - s * 3, y - s * 3.5, s * 6, s * 5);
  const r = rng(seed);
  for (let i = 0; i < 3; i++) {
    const p = new Path2D();
    const hh = s * (1.1 + r() * 0.7);
    const ww = s * (0.34 + r() * 0.22);
    p.moveTo(x - ww, y);
    p.quadraticCurveTo(x - ww * 0.5, y - hh * 0.6, x + (r() - 0.5) * s * 0.4, y - hh);
    p.quadraticCurveTo(x + ww * 0.6, y - hh * 0.5, x + ww, y);
    p.closePath();
    ctx.fillStyle = i === 0 ? 'rgba(255,228,170,0.85)' : `rgba(255,${140 + i * 30},60,0.45)`;
    ctx.fill(p);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * the scene
 * ------------------------------------------------------------------ */

function drawIllustration(fuel: FuelKey, variant: number, W: number, H: number): string {
  const [c, ctx] = makeCanvas(W, H);
  const th = THEMES[fuel];
  const r = rng(variant * 2654435761 + 17);
  const horizon = H * (0.70 + (r() - 0.5) * 0.06);
  const sunX = fuel === 'eco' ? 0.72 : 0.22 + r() * 0.16;
  const p: Paint = { metal: th.metal, rim: th.sun, sunX };

  /* --- sky --- */
  ctx.fillStyle = linGrad(ctx, 0, 0, 0, horizon, [
    [0, css(th.skyTop)],
    [0.55, css(mix(th.skyTop, th.skyBottom, 0.55))],
    [1, css(th.skyBottom)],
  ]);
  ctx.fillRect(0, 0, W, horizon + 1);

  // Sun and its bloom.
  const sx = W * sunX;
  const sy = horizon - H * (0.10 + r() * 0.12);
  ctx.fillStyle = radGrad(ctx, sx, sy, 0, sx, sy, H * 0.62, [
    [0, css(th.sun, 0.55)],
    [0.14, css(th.sun, 0.24)],
    [0.42, css(th.sun, 0.07)],
    [1, css(th.sun, 0)],
  ]);
  ctx.fillRect(0, 0, W, horizon + 1);
  ctx.fillStyle = css(th.sun, 0.82);
  ctx.beginPath();
  ctx.arc(sx, sy, H * 0.032, 0, Math.PI * 2);
  ctx.fill();

  // Cloud strata. Drawn as discrete, soft-edged lenticular forms rather than
  // full-width bands: a band that runs edge to edge at constant alpha reads as
  // gradient banding, i.e. as a rendering artifact, not as weather.
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const cy = H * (0.07 + i * 0.085) + (r() - 0.5) * H * 0.04;
    const cx = W * (r() * 1.2 - 0.1);
    const cw = W * (0.22 + r() * 0.34);
    const ch = H * (0.010 + r() * 0.022);
    const a = (0.05 + r() * 0.10) * (1 - i / 9);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ch / cw);
    ctx.fillStyle = radGrad(ctx, 0, 0, 0, 0, 0, cw, [
      [0, css(th.sun, a)],
      [0.55, css(th.sun, a * 0.45)],
      [1, css(th.sun, 0)],
    ]);
    ctx.beginPath();
    ctx.arc(0, 0, cw, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  /* --- far ridge, hazed back --- */
  const ridgePath = new Path2D();
  ridgePath.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) {
    const n = fbm(x / W * 4.2 + variant, 3.1, 771, 3);
    ridgePath.lineTo(x, horizon - H * 0.035 - n * H * 0.10);
  }
  ridgePath.lineTo(W, H);
  ridgePath.closePath();
  ctx.fillStyle = css(mix(th.ridge, th.skyBottom, 0.42));
  ctx.fill(ridgePath);

  // Atmospheric haze sitting on the horizon line.
  ctx.fillStyle = linGrad(ctx, 0, horizon - H * 0.16, 0, horizon + H * 0.02, [
    [0, css(th.skyBottom, 0)],
    [1, css(th.skyBottom, 0.55)],
  ]);
  ctx.fillRect(0, horizon - H * 0.16, W, H * 0.18);

  /* --- machinery, per fuel --- */
  const g = horizon + H * 0.02; // ground line the structures stand on

  if (fuel === 'coal' || fuel === 'hybrid') {
    const towers = 1 + (variant % 2);
    for (let i = 0; i < towers; i++) {
      const tx = W * (0.30 + i * 0.19);
      const th2 = H * (0.40 + r() * 0.08);
      plume(ctx, tx, g - th2, W * 0.055, H * 0.52, hexToRgb('#d8cfc4'), 0.30, variant * 31 + i, 0.28);
      coolingTower(ctx, p, tx, g, W * 0.155, th2);
    }
    hall(ctx, p, W * 0.63, g, W * 0.30, H * 0.20, variant * 7 + 3);
    const cx2 = W * 0.755;
    const chH = H * (0.46 + r() * 0.10);
    plume(ctx, cx2, g - chH, W * 0.032, H * 0.46, hexToRgb('#8a7f76'), 0.34, variant * 13 + 5, 0.42);
    chimney(ctx, p, cx2, g, W * 0.048, chH);
    if (fuel === 'hybrid') {
      sphereTank(ctx, p, W * 0.135, g, W * 0.052);
      column(ctx, p, W * 0.88, g, W * 0.045, H * 0.30);
    }
    // Ember glow at the boiler base.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = radGrad(ctx, W * 0.63, g, 0, W * 0.63, g, W * 0.24, [
      [0, 'rgba(255,140,50,0.30)'],
      [1, 'rgba(255,140,50,0)'],
    ]);
    ctx.fillRect(0, g - H * 0.2, W, H * 0.3);
    ctx.restore();
  } else if (fuel === 'oil') {
    const cols = 2 + (variant % 3);
    for (let i = 0; i < cols; i++) {
      column(ctx, p, W * (0.30 + i * 0.115), g, W * 0.050, H * (0.28 + ((i * 7 + variant) % 5) * 0.045));
    }
    hall(ctx, p, W * 0.14, g, W * 0.20, H * 0.15, variant * 11 + 2);
    sphereTank(ctx, p, W * 0.74, g, W * 0.062);
    sphereTank(ctx, p, W * 0.86, g, W * 0.046);
    const fx = W * 0.62;
    const fh = H * 0.44;
    chimney(ctx, p, fx, g, W * 0.030, fh, false);
    flare(ctx, fx, g - fh, H * 0.075, variant * 19 + 1);
    plume(ctx, fx, g - fh - H * 0.08, W * 0.028, H * 0.28, hexToRgb('#6f6a63'), 0.26, variant * 5 + 9, 0.5);
  } else if (fuel === 'garbage') {
    hall(ctx, p, W * 0.42, g, W * 0.44, H * 0.26, variant * 17 + 4);
    const cx2 = W * (0.66 + (variant % 3) * 0.04);
    const chH = H * (0.52 + r() * 0.08);
    plume(ctx, cx2, g - chH, W * 0.034, H * 0.44, hexToRgb('#9a9276'), 0.34, variant * 23 + 6, 0.46);
    chimney(ctx, p, cx2, g, W * 0.052, chH);
    // Refuse heap and its conveyor.
    const heap = new Path2D();
    heap.moveTo(W * 0.02, g);
    heap.bezierCurveTo(W * 0.06, g - H * 0.10, W * 0.12, g - H * 0.13, W * 0.18, g - H * 0.06);
    heap.bezierCurveTo(W * 0.21, g - H * 0.02, W * 0.22, g, W * 0.24, g);
    heap.closePath();
    ctx.fillStyle = linGrad(ctx, 0, g - H * 0.13, 0, g, [
      [0, css(shade(hexToRgb(th.accent), -0.28))],
      [1, css(shade(hexToRgb(th.accent), -0.68))],
    ]);
    ctx.fill(heap);
    outline(ctx, heap, Math.max(1, W * 0.004));
    ctx.strokeStyle = css(shade(th.metal, 0.35));
    ctx.lineWidth = Math.max(1, W * 0.012);
    ctx.beginPath();
    ctx.moveTo(W * 0.16, g - H * 0.04);
    ctx.lineTo(W * 0.32, g - H * 0.22);
    ctx.stroke();
  } else if (fuel === 'uranium') {
    const domes = 1 + (variant % 2);
    for (let i = 0; i < domes; i++) {
      dome(ctx, p, W * (0.30 + i * 0.22), g, W * 0.19, H * (0.30 + i * 0.03));
    }
    hall(ctx, p, W * 0.70, g, W * 0.26, H * 0.17, variant * 29 + 8);
    const tx = W * 0.845;
    const tH = H * 0.34;
    plume(ctx, tx, g - tH, W * 0.05, H * 0.40, hexToRgb('#bfe8dd'), 0.26, variant * 37 + 2, 0.22);
    coolingTower(ctx, p, tx, g, W * 0.13, tH);
    // Cherenkov spill — the unmistakable nuclear read.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = radGrad(ctx, W * 0.36, g - H * 0.06, 0, W * 0.36, g - H * 0.06, W * 0.34, [
      [0, 'rgba(90,255,190,0.28)'],
      [0.4, 'rgba(60,220,170,0.10)'],
      [1, 'rgba(60,220,170,0)'],
    ]);
    ctx.fillRect(0, g - H * 0.4, W, H * 0.5);
    ctx.restore();
  } else {
    // eco
    const n = 3 + (variant % 3);
    for (let i = 0; i < n; i++) {
      const tx = W * (0.14 + (i / Math.max(1, n - 1)) * 0.58);
      const th2 = H * (0.30 + ((i * 5 + variant) % 4) * 0.035);
      turbine(ctx, p, tx, g - H * 0.02, th2, (variant + i) * 0.7);
    }
  }

  /* --- foreground ground --- */
  ctx.fillStyle = linGrad(ctx, 0, g - H * 0.01, 0, H, [
    [0, css(mix(th.ground, th.skyBottom, 0.22))],
    [0.4, css(th.ground)],
    [1, css(shade(th.ground, -0.35))],
  ]);
  ctx.fillRect(0, g - H * 0.012, W, H);
  // Ground texture: a few dark sweeps so it is not a flat band.
  ctx.save();
  ctx.globalAlpha = 0.30;
  for (let i = 0; i < 7; i++) {
    const y = g + (i / 7) * (H - g) + r() * H * 0.02;
    ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.6)' : css(th.skyBottom, 0.18);
    ctx.lineWidth = H * (0.006 + r() * 0.012);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(W * 0.3, y + H * 0.012, W * 0.7, y - H * 0.012, W, y + H * 0.006);
    ctx.stroke();
  }
  ctx.restore();

  /* --- foreground pass: anything standing IN FRONT of the ground line must
   * be drawn after it, or the ground fill clips it. --- */
  if (fuel === 'eco') {
    solarBank(ctx, p, W * 0.80, g + H * 0.11, W * 0.26, H * 0.10, hexToRgb(th.accent));
    solarBank(ctx, p, W * 0.53, g + H * 0.18, W * 0.22, H * 0.088, hexToRgb(th.accent));
  }

  /* --- finishing: grain, then a vignette that focuses the silhouette --- */
  overlayGrain(ctx, W, H, 0.11);
  ctx.fillStyle = radGrad(ctx, W * 0.5, H * 0.46, H * 0.28, W * 0.5, H * 0.46, W * 0.72, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.55)'],
  ]);
  ctx.fillRect(0, 0, W, H);
  // A warm top-edge sheen ties the card into the panel language.
  ctx.fillStyle = linGrad(ctx, 0, 0, 0, H * 0.10, [
    [0, 'rgba(255,255,255,0.055)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillRect(0, 0, W, H * 0.10);

  return c.toDataURL();
}

/* ------------------------------------------------------------------ */

export function fuelKey(plant: PowerPlant): FuelKey {
  if (plant.accepts.length === 0) return 'eco';
  if (plant.accepts.length > 1) return 'hybrid';
  return plant.accepts[0] as FuelKey;
}

const cache = new Map<string, { illustration: string; accent: string; title: string }>();

/** Number of distinct compositions generated per fuel category. */
const VARIANTS = 5;

export function plantIllustration(plant: PowerPlant): {
  illustration: string;
  accent: string;
  title: string;
} {
  const fuel = fuelKey(plant);
  const th = THEMES[fuel] ?? THEMES.coal;
  // Variant is a pure function of the printed number, so a given card always
  // looks the same — across reloads, clients and replays.
  const variant = Math.abs(plant.id * 2654435761) % VARIANTS;
  const key = `${fuel}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const art = {
    illustration: drawIllustration(fuel, variant, 512, 320),
    accent: th.accent,
    title: th.titles[variant % th.titles.length]!,
  };
  cache.set(key, art);
  return art;
}

export function plantAccent(plant: PowerPlant): string {
  return (THEMES[fuelKey(plant)] ?? THEMES.coal).accent;
}
