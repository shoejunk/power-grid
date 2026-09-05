/**
 * Painted winter scenes for the seven places on the board.
 *
 * The board has to sit next to the survivor portraits without embarrassing
 * itself, so these are authored the way a matte painting is built up rather
 * than the way a diagram is: sky, far silhouette, mid structure, snow field,
 * foreground drift, falling snow — each layer cooler, hazier and lower in
 * contrast than the one in front of it. Every surface is glazed with a
 * gradient, every horizontal edge carries a lumpy snow load, and the whole
 * scene is pushed through a low-amplitude displacement so no edge is
 * mechanically straight. That last filter is what stops it reading as vector.
 *
 * Everything is `viewBox` geometry — there is no raster anywhere, so the board
 * is as sharp at 3840×2160 as it is at 1280×720 (V13).
 *
 * `<defs>` are declared **once** for the whole board by `BoardArtDefs` and
 * referenced by fragment id from all seven scenes: seven copies of a filter
 * chain would be seven times the work for identical output.
 *
 * These scenes are decorative. Nothing here is the only carrier of any piece
 * of state — the warm light in an occupied building repeats what the survivor
 * standees below it already say.
 */

import type { LocationId } from '@game/dead-of-winter';

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/** Every non-colony scene is authored in this box. Ratio 33:19. */
const LOC_W = 132;
const LOC_H = 76;

/** The colony is a panorama across the full width of the board. Ratio 19:3. */
const HUB_W = 456;
const HUB_H = 72;

/* ------------------------------------------------------------------ *
 * Deterministic scatter
 *
 * Trees, drifts and snowflakes want to look scattered, not placed, but they
 * must be identical on every render or the board would shimmer on each state
 * update. A seeded generator gives both.
 * ------------------------------------------------------------------ */

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const n2 = (v: number): string => Math.round(v * 100) / 100 + '';

/** A row of conifers as one path — a treeline, not a set of trees. */
function conifers(
  seed: number,
  x0: number,
  x1: number,
  base: number,
  hMin: number,
  hMax: number,
  step: number,
): string {
  const r = rng(seed);
  let d = `M${n2(x0 - 8)} ${n2(base + 10)} L${n2(x0 - 8)} ${n2(base)}`;
  let x = x0 - 8;
  while (x < x1 + 6) {
    const w = step * (0.7 + r() * 0.75);
    const h = hMin + r() * (hMax - hMin);
    const lean = (r() - 0.5) * w * 0.25;
    d +=
      ` L${n2(x)} ${n2(base)}` +
      ` L${n2(x + w * 0.28)} ${n2(base - h * 0.42)}` +
      ` L${n2(x + w * 0.16)} ${n2(base - h * 0.46)}` +
      ` L${n2(x + w * 0.5 + lean)} ${n2(base - h)}` +
      ` L${n2(x + w * 0.84)} ${n2(base - h * 0.46)}` +
      ` L${n2(x + w * 0.72)} ${n2(base - h * 0.42)}` +
      ` L${n2(x + w)} ${n2(base)}`;
    x += w * 0.74;
  }
  d += ` L${n2(x1 + 8)} ${n2(base)} L${n2(x1 + 8)} ${n2(base + 10)} Z`;
  return d;
}

/** A distant town: blocky roofs, no detail, low contrast. */
function skylineBlocks(
  seed: number,
  x0: number,
  x1: number,
  base: number,
  hMin: number,
  hMax: number,
): string {
  const r = rng(seed);
  let d = `M${n2(x0 - 8)} ${n2(base + 10)}`;
  let x = x0 - 8;
  while (x < x1 + 6) {
    const w = 5 + r() * 13;
    const h = hMin + r() * (hMax - hMin);
    d += ` L${n2(x)} ${n2(base - h)} L${n2(x + w)} ${n2(base - h)}`;
    x += w;
  }
  d += ` L${n2(x1 + 8)} ${n2(base + 10)} Z`;
  return d;
}

/** A snow drift: a soft, uneven crest running across the scene. */
function drift(seed: number, w: number, top: number, bottom: number, bumps: number, amp: number): string {
  const r = rng(seed);
  const seg = (w + 20) / bumps;
  let d = `M-10 ${n2(bottom)} L-10 ${n2(top + r() * amp)}`;
  for (let i = 0; i < bumps; i++) {
    const x0 = -10 + i * seg;
    const x1 = x0 + seg;
    d += ` Q${n2(x0 + seg * 0.5)} ${n2(top - amp * (0.3 + r() * 1.1))} ${n2(x1)} ${n2(top + (r() - 0.4) * amp)}`;
  }
  d += ` L${n2(w + 10)} ${n2(bottom)} Z`;
  return d;
}

/** Settled snow on a horizontal edge — lumpy on top, thin at the ends. */
function snowLoad(seed: number, x: number, y: number, w: number, t: number): string {
  const r = rng(seed);
  const n = Math.max(2, Math.round(w / 7));
  let d = `M${n2(x)} ${n2(y + t * 0.5)} L${n2(x)} ${n2(y)}`;
  for (let i = 0; i < n; i++) {
    const a = x + (w * i) / n;
    const b = x + (w * (i + 1)) / n;
    d += ` Q${n2((a + b) / 2)} ${n2(y - t * (0.55 + r()))} ${n2(b)} ${n2(y - t * 0.15 * r())}`;
  }
  d += ` L${n2(x + w)} ${n2(y + t * 0.5)} Z`;
  return d;
}

/* ------------------------------------------------------------------ *
 * Shared defs — declared once for the whole board
 * ------------------------------------------------------------------ */

export function BoardArtDefs(): JSX.Element {
  return (
    <svg className="dow-art-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        {/* -- skies ------------------------------------------------- */}
        <linearGradient id="dowSky" x1="0" y1="0" x2="0.12" y2="1">
          <stop offset="0" stopColor="#08151f" />
          <stop offset="0.34" stopColor="#12303f" />
          <stop offset="0.66" stopColor="#2f5768" />
          <stop offset="0.87" stopColor="#5c7b87" />
          <stop offset="1" stopColor="#8a9ba0" />
        </linearGradient>
        <linearGradient id="dowSkyDusk" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#c39a72" stopOpacity="0.5" />
          <stop offset="0.45" stopColor="#8b7d78" stopOpacity="0.22" />
          <stop offset="1" stopColor="#8b7d78" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dowHaze" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#b9ccd4" stopOpacity="0.55" />
          <stop offset="1" stopColor="#b9ccd4" stopOpacity="0" />
        </linearGradient>

        {/* -- ground ------------------------------------------------ */}
        <linearGradient id="dowSnowFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9dae4" />
          <stop offset="1" stopColor="#8fa9bb" />
        </linearGradient>
        <linearGradient id="dowSnowMid" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#e2edf3" />
          <stop offset="0.55" stopColor="#bed0dd" />
          <stop offset="1" stopColor="#93aec2" />
        </linearGradient>
        <linearGradient id="dowSnowNear" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#f6fafc" />
          <stop offset="0.4" stopColor="#dbe8ef" />
          <stop offset="1" stopColor="#9db5c6" />
        </linearGradient>
        <linearGradient id="dowSnowCap" x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0" stopColor="#fbfdfe" />
          <stop offset="0.6" stopColor="#dfebf2" />
          <stop offset="1" stopColor="#adc3d2" />
        </linearGradient>
        {/* The last band of the scene dissolves into the panel body so the
            art has no bottom edge to read as a frame. */}
        <linearGradient id="dowSink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1a24" stopOpacity="0" />
          <stop offset="0.55" stopColor="#0a1a24" stopOpacity="0.72" />
          <stop offset="1" stopColor="#08151e" stopOpacity="1" />
        </linearGradient>
        {/* Guarantees the panel title keeps its contrast over whatever the
            scene happens to put behind it (V6). */}
        <linearGradient id="dowTopScrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#050f16" stopOpacity="0.86" />
          <stop offset="0.5" stopColor="#050f16" stopOpacity="0.5" />
          <stop offset="1" stopColor="#050f16" stopOpacity="0" />
        </linearGradient>

        {/* -- built materials --------------------------------------- */}
        <linearGradient id="dowBrick" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#6f5049" />
          <stop offset="0.5" stopColor="#543c37" />
          <stop offset="1" stopColor="#37282a" />
        </linearGradient>
        <linearGradient id="dowStone" x1="0" y1="0" x2="1" y2="0.25">
          <stop offset="0" stopColor="#97a1a4" />
          <stop offset="0.55" stopColor="#6c797f" />
          <stop offset="1" stopColor="#48555d" />
        </linearGradient>
        <linearGradient id="dowConcrete" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#7f8b90" />
          <stop offset="0.5" stopColor="#5b686e" />
          <stop offset="1" stopColor="#3c484f" />
        </linearGradient>
        <linearGradient id="dowSteel" x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0" stopColor="#788489" />
          <stop offset="0.45" stopColor="#4d5a61" />
          <stop offset="1" stopColor="#303c44" />
        </linearGradient>
        <linearGradient id="dowPlank" x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0" stopColor="#9a7749" />
          <stop offset="0.5" stopColor="#77582f" />
          <stop offset="1" stopColor="#4e3a22" />
        </linearGradient>
        <linearGradient id="dowRoofDark" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#34434c" />
          <stop offset="1" stopColor="#18252d" />
        </linearGradient>
        <linearGradient id="dowGlass" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#28414c" />
          <stop offset="0.5" stopColor="#132029" />
          <stop offset="1" stopColor="#0a1219" />
        </linearGradient>
        <linearGradient id="dowGlassLit" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ffe0ab" />
          <stop offset="0.55" stopColor="#e5a862" stopOpacity="1" />
          <stop offset="1" stopColor="#8a5320" />
        </linearGradient>

        {/* -- light ------------------------------------------------- */}
        <radialGradient id="dowWarmGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffdda6" stopOpacity="0.85" />
          <stop offset="0.35" stopColor="#f4b569" stopOpacity="0.4" />
          <stop offset="1" stopColor="#e09a4a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="dowBlueGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c8ecff" stopOpacity="0.9" />
          <stop offset="0.3" stopColor="#57b4f0" stopOpacity="0.45" />
          <stop offset="1" stopColor="#3d8fd0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="dowRedGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd0c6" stopOpacity="0.85" />
          <stop offset="0.32" stopColor="#f4675a" stopOpacity="0.4" />
          <stop offset="1" stopColor="#c9382c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="dowMoon" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f4fbff" stopOpacity="0.95" />
          <stop offset="0.16" stopColor="#dcecf4" stopOpacity="0.5" />
          <stop offset="1" stopColor="#9fc0d0" stopOpacity="0" />
        </radialGradient>
        {/* Light falling out of a doorway onto snow. */}
        <linearGradient id="dowSpill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd79c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffc27a" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="dowVignette" cx="0.5" cy="0.42" r="0.75">
          <stop offset="0.45" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#00080e" stopOpacity="0.55" />
        </radialGradient>

        {/* -- surface texture --------------------------------------- */}
        <pattern id="dowBrickTex" width="7" height="3.4" patternUnits="userSpaceOnUse">
          <rect width="7" height="3.4" fill="none" />
          <path d="M0 3.2H7M3.5 0V3.2M0 1.5H7" stroke="#0d1116" strokeOpacity="0.3" strokeWidth="0.35" />
          <path d="M0 3.0H7" stroke="#c9d6dc" strokeOpacity="0.13" strokeWidth="0.3" />
        </pattern>
        <pattern id="dowPlankTex" width="3.2" height="8" patternUnits="userSpaceOnUse">
          <path d="M3.05 0V8" stroke="#241a10" strokeOpacity="0.5" strokeWidth="0.4" />
          <path d="M0.6 0V8" stroke="#e2c79b" strokeOpacity="0.12" strokeWidth="0.3" />
        </pattern>
        <pattern id="dowCorrTex" width="2.4" height="6" patternUnits="userSpaceOnUse">
          <path d="M0.4 0V6" stroke="#0e161b" strokeOpacity="0.45" strokeWidth="0.5" />
          <path d="M1.5 0V6" stroke="#dbe8ee" strokeOpacity="0.12" strokeWidth="0.45" />
        </pattern>

        {/* -- filters ----------------------------------------------- *
         * dowPaint is the whole point: a slow, low-amplitude displacement
         * that breaks every straight edge just enough to read as a brush
         * rather than a rectangle. It wraps the static body of each scene,
         * never the animated snowfall, so it rasterises once. */}
        <filter
          id="dowPaint"
          x="-6%"
          y="-6%"
          width="112%"
          height="112%"
          colorInterpolationFilters="sRGB"
          filterUnits="objectBoundingBox"
          primitiveUnits="userSpaceOnUse"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.09 0.13" numOctaves="2" seed="17" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        {/* Canvas tooth. Composited over the finished scene in `overlay`. */}
        <filter
          id="dowGrain"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
          filterUnits="objectBoundingBox"
          primitiveUnits="userSpaceOnUse"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" seed="5" stitchTiles="stitch" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.62
                    0 0 0 0 0.66
                    0 0 0 0 0.72
                    0.95 0 0 0 -0.34"
          />
        </filter>

        <filter id="dowBloom" x="-70%" y="-70%" width="240%" height="240%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <filter id="dowSmoke" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.14" numOctaves="2" seed="23" result="s" />
          <feDisplacementMap in="SourceGraphic" in2="s" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
      </defs>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Layer primitives
 * ------------------------------------------------------------------ */

interface BandProps {
  w: number;
  h: number;
}

/** Sky, cloud banding, low dusk warmth and the haze that sits on the horizon. */
function Sky({ w, h, horizon, seed }: BandProps & { horizon: number; seed: number }): JSX.Element {
  const r = rng(seed);
  return (
    <g>
      <rect x={-10} y={-10} width={w + 20} height={horizon + 12} fill="url(#dowSky)" />
      {[0, 1, 2, 3].map((i) => {
        const cy = 4 + r() * (horizon * 0.62);
        const rx = w * (0.18 + r() * 0.34);
        return (
          <ellipse
            key={i}
            cx={r() * w}
            cy={cy}
            rx={rx}
            ry={2.2 + r() * 3.4}
            fill={i % 2 ? '#2b5163' : '#1b3947'}
            opacity={0.3 + r() * 0.26}
          />
        );
      })}
      <rect x={-10} y={horizon - h * 0.34} width={w + 20} height={h * 0.34 + 4} fill="url(#dowSkyDusk)" />
      <rect x={-10} y={horizon - h * 0.2} width={w + 20} height={h * 0.2 + 4} fill="url(#dowHaze)" />
    </g>
  );
}

/** The snow field: three planes, each nearer one brighter and more contrasty. */
function Ground({ w, h, horizon, seed }: BandProps & { horizon: number; seed: number }): JSX.Element {
  return (
    <g>
      <rect x={-10} y={horizon - 1} width={w + 20} height={h - horizon + 12} fill="url(#dowSnowFar)" />
      <path d={drift(seed, w, horizon + (h - horizon) * 0.28, h + 10, 5, h * 0.035)} fill="url(#dowSnowMid)" />
      <path
        d={drift(seed + 7, w, horizon + (h - horizon) * 0.62, h + 10, 4, h * 0.055)}
        fill="url(#dowSnowNear)"
      />
      {/* Wind-scoured ripples catching the low key light. */}
      <g opacity="0.5" stroke="#ffffff" strokeOpacity="0.5" strokeLinecap="round" fill="none">
        {Array.from({ length: 7 }, (_, i) => {
          const r = rng(seed * 13 + i)();
          const y = horizon + (h - horizon) * (0.34 + i * 0.09);
          const x = w * (0.04 + r * 0.6);
          return (
            <path
              key={i}
              d={`M${n2(x)} ${n2(y)} q${n2(w * 0.09)} ${n2(-0.5 - r)} ${n2(w * 0.2 + r * 8)} 0`}
              strokeWidth={0.35 + r * 0.3}
            />
          );
        })}
      </g>
    </g>
  );
}

/** A long, soft, cold shadow cast across snow. */
function CastShadow({
  x,
  y,
  w,
  h,
  skew = 0.5,
  opacity = 0.3,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  skew?: number;
  opacity?: number;
}): JSX.Element {
  return (
    <path
      d={`M${n2(x)} ${n2(y)} L${n2(x + w)} ${n2(y)} L${n2(x + w + h * skew)} ${n2(y + h)} L${n2(x + h * skew)} ${n2(y + h)} Z`}
      fill="#2c4a63"
      opacity={opacity}
    />
  );
}

/** Contact shading where a structure meets the snow. */
function Contact({ x, y, w, h = 2.2 }: { x: number; y: number; w: number; h?: number }): JSX.Element {
  return <ellipse cx={x + w / 2} cy={y} rx={w * 0.62} ry={h} fill="#25455c" opacity="0.4" />;
}

/** A lit window: warm interior, cold reflection, a spill of light on the sill. */
function Window({
  x,
  y,
  w,
  h,
  lit = false,
  bars = 0,
  arch = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lit?: boolean;
  bars?: number;
  arch?: boolean;
}): JSX.Element {
  const d = arch
    ? `M${n2(x)} ${n2(y + h)} L${n2(x)} ${n2(y + w / 2)} Q${n2(x + w / 2)} ${n2(y - w * 0.16)} ${n2(x + w)} ${n2(y + w / 2)} L${n2(x + w)} ${n2(y + h)} Z`
    : `M${n2(x)} ${n2(y)} H${n2(x + w)} V${n2(y + h)} H${n2(x)} Z`;
  return (
    <g>
      <path d={d} fill={lit ? '#f0b464' : 'url(#dowGlass)'} />
      {lit ? <path d={d} fill="#ffe3ac" opacity="0.55" /> : null}
      {lit ? (
        <ellipse cx={x + w / 2} cy={y + h / 2} rx={w * 1.5} ry={h * 1.15} fill="url(#dowWarmGlow)" opacity="0.6" />
      ) : (
        <path
          d={`M${n2(x)} ${n2(y + h)} L${n2(x + w * 0.62)} ${n2(y)} L${n2(x + w)} ${n2(y)} L${n2(x + w * 0.38)} ${n2(y + h)} Z`}
          fill="#8fb6c8"
          opacity="0.14"
        />
      )}
      {Array.from({ length: bars }, (_, i) => (
        <path
          key={i}
          d={`M${n2(x + (w * (i + 1)) / (bars + 1))} ${n2(y)} V${n2(y + h)}`}
          stroke="#0e161c"
          strokeOpacity="0.8"
          strokeWidth="0.4"
        />
      ))}
      <path d={`M${n2(x)} ${n2(y + h)} H${n2(x + w)}`} stroke="#e8f2f7" strokeOpacity="0.5" strokeWidth="0.45" />
    </g>
  );
}

/** A grid of windows on a facade. */
function WindowGrid({
  x,
  y,
  cols,
  rows,
  cw,
  ch,
  gapX,
  gapY,
  litMask = 0,
  bars = 0,
}: {
  x: number;
  y: number;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  gapX: number;
  gapY: number;
  litMask?: number;
  bars?: number;
}): JSX.Element {
  const out: JSX.Element[] = [];
  for (let r0 = 0; r0 < rows; r0++) {
    for (let c = 0; c < cols; c++) {
      const idx = r0 * cols + c;
      out.push(
        <Window
          key={idx}
          x={x + c * (cw + gapX)}
          y={y + r0 * (ch + gapY)}
          w={cw}
          h={ch}
          bars={bars}
          lit={((litMask >> idx) & 1) === 1}
        />,
      );
    }
  }
  return <g>{out}</g>;
}

/** Plywood nailed over an opening, cross-braced. */
function Boarded({ x, y, w, h, seed }: { x: number; y: number; w: number; h: number; seed: number }): JSX.Element {
  const r = rng(seed);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="url(#dowGlass)" />
      {[0, 1, 2].map((i) => {
        const ty = y + 0.6 + (i * (h - 1.6)) / 2.4;
        const tilt = (r() - 0.5) * 1.2;
        return (
          <g key={i}>
            <path
              d={`M${n2(x - 0.6)} ${n2(ty + tilt)} L${n2(x + w + 0.6)} ${n2(ty - tilt)} L${n2(x + w + 0.6)} ${n2(ty - tilt + h * 0.3)} L${n2(x - 0.6)} ${n2(ty + tilt + h * 0.3)} Z`}
              fill="url(#dowPlank)"
            />
            <path
              d={`M${n2(x - 0.6)} ${n2(ty + tilt)} L${n2(x + w + 0.6)} ${n2(ty - tilt)}`}
              stroke="#f0dcb6"
              strokeOpacity="0.22"
              strokeWidth="0.3"
            />
          </g>
        );
      })}
      <rect x={x} y={y} width={w} height={h} fill="url(#dowPlankTex)" opacity="0.5" />
    </g>
  );
}

/** Falling snow. Outside the paint filter so animating it stays cheap. */
function Snowfall({ w, h, seed, density = 26 }: BandProps & { seed: number; density?: number }): JSX.Element {
  const r = rng(seed);
  const layers = [
    { n: Math.round(density * 0.45), rr: 0.34, o: 0.34, cls: 'dow-snowfall--far' },
    { n: Math.round(density * 0.35), rr: 0.52, o: 0.5, cls: 'dow-snowfall--mid' },
    { n: Math.round(density * 0.2), rr: 0.78, o: 0.72, cls: 'dow-snowfall--near' },
  ];
  return (
    <g className="dow-snowfall" aria-hidden="true">
      {layers.map((layer, li) => (
        <g key={li} className={layer.cls} opacity={layer.o}>
          {Array.from({ length: layer.n }, (_, i) => (
            <circle key={i} cx={n2(r() * (w + 8) - 4)} cy={n2(r() * h)} r={layer.rr} fill="#f2f9fc" />
          ))}
          {Array.from({ length: layer.n }, (_, i) => (
            <circle key={`b${i}`} cx={n2(r() * (w + 8) - 4)} cy={n2(r() * h - h)} r={layer.rr} fill="#f2f9fc" />
          ))}
        </g>
      ))}
    </g>
  );
}

/** Grain, vignette, the sink into the panel body, and the header scrim. */
function Finish({ w, h }: BandProps): JSX.Element {
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} fill="url(#dowVignette)" />
      <rect className="dow-scene__grain" x={0} y={0} width={w} height={h} filter="url(#dowGrain)" />
      <rect x={-4} y={h - h * 0.19} width={w + 8} height={h * 0.19 + 2} fill="url(#dowSink)" />
      <rect x={-4} y={-2} width={w + 8} height={h * 0.42} fill="url(#dowTopScrim)" />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * The six search sites
 * ------------------------------------------------------------------ */

interface SceneProps {
  lit: boolean;
}

const HORIZON = 44;

function PoliceStation({ lit }: SceneProps): JSX.Element {
  return (
    <>
      <Sky w={LOC_W} h={LOC_H} horizon={HORIZON} seed={3} />
      <path d={skylineBlocks(31, 0, LOC_W, HORIZON - 1, 5, 16)} fill="#2b4757" opacity="0.72" />
      <path d={conifers(52, 88, LOC_W, HORIZON, 5, 10, 7)} fill="#223b48" opacity="0.8" />
      <Ground w={LOC_W} h={LOC_H} horizon={HORIZON} seed={9} />

      {/* long shadow of the station thrown left across the snow */}
      <CastShadow x={14} y={51} w={86} h={9} skew={-0.85} opacity={0.28} />

      {/* -- the station: brick, parapet, sallyport ------------------- */}
      <g>
        <Contact x={16} y={52.4} w={92} />
        {/* left wing */}
        <path d="M16 27H60V52H16Z" fill="url(#dowBrick)" />
        <path d="M16 27H60V52H16Z" fill="url(#dowBrickTex)" opacity="0.85" />
        {/* taller centre block */}
        <path d="M60 21H92V52H60Z" fill="url(#dowBrick)" />
        <path d="M60 21H92V52H60Z" fill="url(#dowBrickTex)" opacity="0.85" />
        <path d="M60 21H92V52H60Z" fill="#0a1319" opacity="0.16" />
        {/* garage / sallyport */}
        <path d="M92 30H116V52H92Z" fill="url(#dowConcrete)" />
        <path d="M95 35H113V52H95Z" fill="url(#dowSteel)" />
        <path d="M95 35H113V52H95Z" fill="url(#dowCorrTex)" opacity="0.7" />
        <path d="M95 39H113M95 43H113M95 47H113" stroke="#0d151b" strokeOpacity="0.45" strokeWidth="0.35" />

        {/* string course + parapet snow */}
        <path d={snowLoad(11, 15, 27, 45, 2.3)} fill="url(#dowSnowCap)" />
        <path d={snowLoad(12, 59, 21, 33, 2.6)} fill="url(#dowSnowCap)" />
        <path d={snowLoad(13, 91, 30, 25, 2.1)} fill="url(#dowSnowCap)" />

        {/* barred windows */}
        <WindowGrid x={19} y={32} cols={4} rows={1} cw={7} ch={7} gapX={3.4} gapY={0} bars={3} litMask={lit ? 0b0010 : 0} />
        <WindowGrid x={63} y={26} cols={3} rows={1} cw={7} ch={6} gapX={3.6} gapY={0} bars={3} litMask={lit ? 0b010 : 0} />

        {/* entrance: recessed door, steps, sign board */}
        <path d="M72 38H82V52H72Z" fill="#0c161d" />
        <path d="M73.2 39.4H80.8V52H73.2Z" fill={lit ? '#e9b26a' : '#182833'} />
        {lit ? <path d="M70 52 L84 52 L92 62 L62 62 Z" fill="url(#dowSpill)" /> : null}
        <path d="M68 52H86L88 55H66Z" fill="url(#dowSnowCap)" />
        <path d="M66 55H88L90 57.6H64Z" fill="url(#dowSnowCap)" opacity="0.92" />
        <rect x="69.5" y="33.4" width="15" height="3.6" rx="0.5" fill="#16242e" />
        <rect x="70.4" y="34.2" width="13.2" height="2" rx="0.4" fill="#5f9dc4" opacity="0.5" />

        {/* blue lamp on the corner, and its bloom */}
        <rect x="88.4" y="18.5" width="2.4" height="3.2" rx="0.8" fill="#4ea8f0" />
        <ellipse cx="89.6" cy="20" rx="11" ry="8" fill="url(#dowBlueGlow)" />
        <path d="M89.6 20 L74 52 H60 Z" fill="#4ea8f0" opacity="0.09" />
      </g>

      {/* -- cruiser, foreground left -------------------------------- */}
      <g>
        <CastShadow x={7} y={64.5} w={34} h={5} skew={-0.7} opacity={0.34} />
        <path
          d="M4 65.5 Q5 60.5 11 60 L18 55.6 Q24.5 54.2 31 55.8 L36 60.2 Q41.5 60.8 42 65.4 Z"
          fill="url(#dowSteel)"
        />
        <path d="M18.6 56.6 Q24.4 55.4 30.2 56.8 L34 60 H15.4 Z" fill="url(#dowGlass)" />
        <path d="M18.6 56.6 Q24.4 55.4 30.2 56.8 L28 58.2 H17.4 Z" fill="#9dc0d2" opacity="0.22" />
        <path d={snowLoad(21, 5, 60.6, 36, 1.5)} fill="url(#dowSnowCap)" opacity="0.95" />
        {/* light bar */}
        <rect x="19.5" y="53.6" width="10.5" height="2.2" rx="0.7" fill="#1b2830" />
        <rect x="20.2" y="54" width="4.4" height="1.5" rx="0.5" fill="#5fb9f5" />
        <rect x="25.2" y="54" width="4.4" height="1.5" rx="0.5" fill="#f0655a" />
        <ellipse cx="22.4" cy="54.8" rx="8" ry="5" fill="url(#dowBlueGlow)" opacity="0.85" />
        <ellipse cx="27.4" cy="54.8" rx="7" ry="4.6" fill="url(#dowRedGlow)" opacity="0.7" />
        <circle cx="12" cy="65.4" r="2.6" fill="#151f26" />
        <circle cx="34" cy="65.4" r="2.6" fill="#151f26" />
        <path d="M42 62 Q46 61.4 47.6 63.6" stroke="#e6f1f6" strokeOpacity="0.4" strokeWidth="0.5" fill="none" />
      </g>

      {/* toppled barrier, right foreground */}
      <g>
        <path d="M104 62 L124 60.4 L124.6 62.2 L104.6 63.8 Z" fill="url(#dowPlank)" />
        <path d="M107 63.6 L109 68.6 M120 62.4 L122 67.4" stroke="#4c3a22" strokeWidth="1.1" />
        <path d={snowLoad(33, 103, 61, 22, 1.2)} fill="url(#dowSnowCap)" opacity="0.9" />
      </g>

      <path d={drift(41, LOC_W, 66, LOC_H + 8, 4, 2.6)} fill="url(#dowSnowNear)" />
    </>
  );
}

function GroceryStore({ lit }: SceneProps): JSX.Element {
  return (
    <>
      <Sky w={LOC_W} h={LOC_H} horizon={HORIZON} seed={6} />
      <path d={skylineBlocks(19, 0, LOC_W, HORIZON - 2, 3, 10)} fill="#294453" opacity="0.6" />
      {/* water tower on the far ridge */}
      <g fill="#25404e" opacity="0.7">
        <path d="M14 28 H26 L24 33 H16 Z" />
        <path d="M17 33 L17.6 42 M23 33 L22.4 42 M17.3 37 H22.7" stroke="#25404e" strokeWidth="0.7" />
      </g>
      <Ground w={LOC_W} h={LOC_H} horizon={HORIZON} seed={14} />

      <CastShadow x={10} y={51} w={100} h={10} skew={-0.7} opacity={0.26} />

      {/* -- pole sign ------------------------------------------------ */}
      <g>
        <path d="M9.4 24 V54 M12.6 24 V54" stroke="#3d4a52" strokeWidth="1.1" />
        <rect x="4" y="17" width="14" height="9" rx="1" fill="url(#dowSteel)" />
        <rect x="5" y="18" width="12" height="7" rx="0.6" fill={lit ? '#f0c073' : '#213440'} />
        <path d="M6 19.6 H14 M6 21.6 H12.5 M6 23.4 H15" stroke="#0d161c" strokeOpacity="0.55" strokeWidth="0.7" />
        <path d="M12 17 L18 26" stroke="#0a1116" strokeOpacity="0.5" strokeWidth="0.6" />
        {lit ? <ellipse cx="11" cy="21.5" rx="16" ry="11" fill="url(#dowWarmGlow)" opacity="0.5" /> : null}
        <path d={snowLoad(51, 4, 17, 14, 1.6)} fill="url(#dowSnowCap)" />
      </g>

      {/* -- the store ------------------------------------------------ */}
      <g>
        <Contact x={22} y={52.6} w={98} />
        <path d="M22 30H120V52H22Z" fill="url(#dowConcrete)" />
        {/* roof sign spine */}
        <path d="M40 21H104V30H40Z" fill="url(#dowSteel)" />
        <path d="M42 22.6H102V28.4H42Z" fill="#16232c" />
        <g fill={lit ? '#ffd694' : '#7f939d'} opacity={lit ? 0.95 : 0.5}>
          <rect x="46" y="24" width="4.6" height="3.2" rx="0.4" />
          <rect x="52.4" y="24" width="4.6" height="3.2" rx="0.4" />
          <rect x="58.8" y="24" width="2.6" height="3.2" rx="0.4" />
          <rect x="66" y="24" width="4.6" height="3.2" rx="0.4" opacity="0.35" />
          <rect x="72.4" y="24" width="4.6" height="3.2" rx="0.4" />
          <rect x="78.8" y="24" width="4.6" height="3.2" rx="0.4" />
          <rect x="85.2" y="24" width="4.6" height="3.2" rx="0.4" opacity="0.3" />
          <rect x="91.6" y="24" width="4.6" height="3.2" rx="0.4" />
        </g>
        {lit ? <rect x="42" y="22.6" width="60" height="5.8" fill="url(#dowWarmGlow)" opacity="0.35" /> : null}
        <path d={snowLoad(55, 39, 21, 66, 2.4)} fill="url(#dowSnowCap)" />

        {/* awning over the storefront */}
        <path d="M20 34 L122 34 L126 41.4 L16 41.4 Z" fill="#5d3a37" />
        <g>
          {Array.from({ length: 11 }, (_, i) => (
            <path
              key={i}
              d={`M${n2(20 + i * 9.3)} 34 L${n2(24.6 + i * 9.3)} 34 L${n2(21.4 + i * 9.3)} 41.4 L${n2(16.8 + i * 9.3)} 41.4 Z`}
              fill="#c9c0ad"
              opacity="0.55"
            />
          ))}
        </g>
        <path d="M16 41.4 H126" stroke="#0b1218" strokeOpacity="0.6" strokeWidth="0.6" />
        <path d={snowLoad(57, 19, 34, 104, 2.2)} fill="url(#dowSnowCap)" />

        {/* storefront glazing, part boarded */}
        <path d="M26 42H118V52H26Z" fill="url(#dowGlass)" />
        <Boarded x={26} y={42} w={20} h={10} seed={71} />
        <Boarded x={95} y={42} w={17} h={10} seed={73} />
        <path d="M48 42H70V52H48Z" fill={lit ? '#e8ae62' : 'url(#dowGlass)'} opacity={lit ? 0.9 : 1} />
        {lit ? <path d="M48 52 L70 52 L78 63 L40 63 Z" fill="url(#dowSpill)" /> : null}
        <path d="M72 43H82V52H72Z" fill="#0e1a21" />
        <path d="M73 44H81V52H73Z" fill={lit ? '#f2c37c' : '#1c2c36'} />
        <path d="M84 42V52M46 42V52M70 42V52M94 42V52" stroke="#2b3b45" strokeWidth="0.5" />
        {/* cracked pane */}
        <path d="M86 43.5 L89.5 47 L87.5 49.5 M89.5 47 L93 45.5" stroke="#cfe4ee" strokeOpacity="0.5" strokeWidth="0.3" fill="none" />
      </g>

      {/* -- carts in the snow --------------------------------------- */}
      <g>
        <CastShadow x={26} y={64} w={16} h={4} skew={-0.6} opacity={0.32} />
        {/* upright cart */}
        <g stroke="#c3d3dc" strokeWidth="0.55" fill="none" opacity="0.9">
          <path d="M28 58 L30 58 L32.4 65.2 H41.6" />
          <path d="M31.4 63.4 H43 L45 57.4 H30" />
          <path d="M32.4 61.4 H43.6 M33.5 59.4 H44.4 M35 57.4 V63.4 M39 57.4 V63.4" strokeWidth="0.35" />
        </g>
        <circle cx="34" cy="66.4" r="1.1" fill="#1a252c" />
        <circle cx="42" cy="66.4" r="1.1" fill="#1a252c" />
        <path d={snowLoad(61, 30, 57.6, 15, 1.1)} fill="url(#dowSnowCap)" opacity="0.9" />
        {/* tipped cart, half buried */}
        <g stroke="#b5c8d3" strokeWidth="0.5" fill="none" opacity="0.75">
          <path d="M96 66.5 L100 60 L112 62 L109.4 68" />
          <path d="M98.6 62.6 L110.6 64.6 M97.4 64.4 L109.8 66.4" strokeWidth="0.32" />
        </g>
        <circle cx="112.6" cy="61.4" r="1" fill="#1a252c" />
        <path d={drift(63, LOC_W, 66.5, LOC_H + 8, 4, 2.4)} fill="url(#dowSnowNear)" />
        {/* spilled cans */}
        <circle cx="60" cy="68.4" r="0.9" fill="#7d6a4e" />
        <circle cx="64.4" cy="69.4" r="0.8" fill="#6b7d6a" />
        <circle cx="55" cy="69.8" r="0.75" fill="#87604c" />
      </g>
    </>
  );
}

function School({ lit }: SceneProps): JSX.Element {
  return (
    <>
      <Sky w={LOC_W} h={LOC_H} horizon={HORIZON} seed={11} />
      <path
        d={`M-10 ${HORIZON} Q28 ${HORIZON - 11} 62 ${HORIZON - 3} Q96 ${HORIZON - 13} ${LOC_W + 10} ${HORIZON - 2} L${LOC_W + 10} ${HORIZON + 8} L-10 ${HORIZON + 8} Z`}
        fill="#28404d"
        opacity="0.62"
      />
      <path d={conifers(77, 0, 40, HORIZON - 1, 6, 12, 7)} fill="#20353f" opacity="0.85" />
      <Ground w={LOC_W} h={LOC_H} horizon={HORIZON} seed={18} />

      <CastShadow x={16} y={51} w={100} h={11} skew={-0.75} opacity={0.27} />

      {/* -- flagpole ------------------------------------------------- */}
      <g>
        <path d="M15.4 12 V56" stroke="#a9b8bf" strokeWidth="0.7" />
        <circle cx="15.4" cy="11.4" r="0.9" fill="#d8e5ea" />
        <path d="M16 13 L26 15.4 L23.6 17.2 L26.4 19.6 L16 20.6 Z" fill="#8f4a44" opacity="0.85" />
        <path d="M16 13 L26 15.4 L21 16 Z" fill="#e6ecef" opacity="0.28" />
        <ellipse cx="15.4" cy="56.2" rx="3.4" ry="1.3" fill="#25455c" opacity="0.4" />
      </g>

      {/* -- gym block (right) --------------------------------------- */}
      <g>
        <Contact x={92} y={52.6} w={30} />
        <path d="M92 24H122V52H92Z" fill="url(#dowBrick)" />
        <path d="M92 24H122V52H92Z" fill="url(#dowBrickTex)" opacity="0.8" />
        <path d="M92 24H122V52H92Z" fill="#08111a" opacity="0.22" />
        <path d="M94 27H120V32H94Z" fill="url(#dowGlass)" />
        <path d="M99 27V32M105 27V32M111 27V32M116 27V32" stroke="#25353f" strokeWidth="0.4" />
        <path d={snowLoad(81, 91, 24, 32, 2.4)} fill="url(#dowSnowCap)" />
      </g>

      {/* -- main two-storey block ----------------------------------- */}
      <g>
        <Contact x={20} y={52.6} w={74} />
        <path d="M20 28H94V52H20Z" fill="url(#dowBrick)" />
        <path d="M20 28H94V52H20Z" fill="url(#dowBrickTex)" opacity="0.85" />
        <path d={snowLoad(83, 19, 28, 76, 2.5)} fill="url(#dowSnowCap)" />
        {/* cupola */}
        <path d="M50 20H64V28H50Z" fill="url(#dowStone)" />
        <path d="M49 20 L57 13.4 L65 20 Z" fill="url(#dowRoofDark)" />
        <path d={snowLoad(85, 49.5, 19.2, 15, 1.6)} fill="url(#dowSnowCap)" />
        <path d="M50.5 15.6 L57 11 L63.5 15.6 Z" fill="#eef6f9" opacity="0.75" />
        <circle cx="57" cy="23.6" r="2.4" fill="#101c23" />
        <circle cx="57" cy="23.6" r="1.8" fill={lit ? '#f0c479' : '#7e929c'} opacity="0.8" />
        <path d="M57 23.6 V22 M57 23.6 L58.4 24.4" stroke="#0d151a" strokeWidth="0.35" />

        {/* two rows of tall windows */}
        <WindowGrid x={24} y={31} cols={7} rows={1} cw={6} ch={7.4} gapX={3.7} gapY={0} litMask={lit ? 0b0100100 : 0} />
        <WindowGrid x={24} y={41.6} cols={7} rows={1} cw={6} ch={7.4} gapX={3.7} gapY={0} litMask={lit ? 0b0001000 : 0} />
        <path d="M22 39.6 H92" stroke="#e6f0f5" strokeOpacity="0.22" strokeWidth="0.8" />

        {/* entrance */}
        <path d="M50 40H64V52H50Z" fill="url(#dowStone)" />
        <path d="M48.6 39 L57 34.6 L65.4 39 Z" fill="url(#dowRoofDark)" />
        <path d={snowLoad(87, 48.6, 38.4, 17, 1.5)} fill="url(#dowSnowCap)" />
        <path d="M52.4 42H61.6V52H52.4Z" fill={lit ? '#e8ae62' : '#0f1c24'} />
        {lit ? <path d="M50 52 L64 52 L71 62 L43 62 Z" fill="url(#dowSpill)" /> : null}
        <path d="M47 52H67L69.4 55.4H44.6Z" fill="url(#dowSnowCap)" />
      </g>

      {/* -- swing frame, foreground --------------------------------- */}
      <g stroke="#41525b" strokeWidth="0.75" fill="none">
        <path d="M96 68 L101 59 L112 59 L117 68" />
        <path d="M101 59 H112" />
        <path d="M103.4 59.6 V64.6 M106 59.6 V64.6" strokeWidth="0.35" stroke="#8ea3ad" />
        <path d="M103 64.6 H106.4" strokeWidth="0.6" stroke="#6b7c85" />
      </g>
      <path d={drift(91, LOC_W, 65.5, LOC_H + 8, 5, 2.5)} fill="url(#dowSnowNear)" />
      {/* fence posts poking out of the drift */}
      <g fill="#4a5a62">
        <rect x="30" y="62" width="1.3" height="6" rx="0.4" />
        <rect x="41" y="63.4" width="1.3" height="5" rx="0.4" />
        <rect x="52.6" y="64.6" width="1.3" height="4.4" rx="0.4" />
      </g>
    </>
  );
}

function GasStation({ lit }: SceneProps): JSX.Element {
  return (
    <>
      <Sky w={LOC_W} h={LOC_H} horizon={HORIZON} seed={23} />
      <path d={conifers(101, 0, LOC_W, HORIZON - 1, 4, 9, 6)} fill="#243c48" opacity="0.7" />
      <Ground w={LOC_W} h={LOC_H} horizon={HORIZON} seed={27} />

      {/* -- price totem, left --------------------------------------- */}
      <g>
        <path d="M8.6 26 V55 M13.4 26 V55" stroke="#42505a" strokeWidth="1.2" />
        <rect x="3" y="14" width="16" height="13" rx="1.2" fill="url(#dowSteel)" />
        <rect x="4.2" y="15.2" width="13.6" height="4" rx="0.5" fill="#b8452f" opacity="0.8" />
        <rect x="4.2" y="20" width="13.6" height="5.8" rx="0.5" fill="#0e1a21" />
        <g fill={lit ? '#ffcf85' : '#5d737e'}>
          <rect x="5.4" y="21.2" width="2.4" height="3.4" rx="0.3" />
          <rect x="8.6" y="21.2" width="2.4" height="3.4" rx="0.3" opacity="0.25" />
          <rect x="11.8" y="21.2" width="2.4" height="3.4" rx="0.3" />
          <rect x="15" y="21.2" width="2" height="3.4" rx="0.3" opacity="0.5" />
        </g>
        {lit ? <ellipse cx="11" cy="22.8" rx="15" ry="10" fill="url(#dowWarmGlow)" opacity="0.4" /> : null}
        <path d={snowLoad(111, 3, 14, 16, 1.7)} fill="url(#dowSnowCap)" />
      </g>

      {/* -- shop box, right ----------------------------------------- */}
      <g>
        <Contact x={96} y={52.6} w={30} />
        <path d="M96 32H124V52H96Z" fill="url(#dowConcrete)" />
        <path d={snowLoad(113, 95, 32, 30, 2.3)} fill="url(#dowSnowCap)" />
        <Window x={100} y={36} w={11} h={8} lit={lit} />
        <path d="M114 38H121V52H114Z" fill="#0f1b22" />
        <path d="M115 39H120V52H115Z" fill={lit ? '#e9b268' : '#1b2b34'} />
        {lit ? <path d="M114 52 L121 52 L126 61 L108 61 Z" fill="url(#dowSpill)" opacity="0.7" /> : null}
      </g>

      {/* -- canopy over the pump islands ---------------------------- */}
      <g>
        <CastShadow x={26} y={53} w={64} h={9} skew={-0.55} opacity={0.3} />
        {/* columns */}
        <path d="M32 30H36V54H32Z" fill="url(#dowSteel)" />
        <path d="M82 30H86V54H82Z" fill="url(#dowSteel)" />
        {/* deck */}
        <path d="M22 24H96V31H22Z" fill="url(#dowSteel)" />
        <path d="M22 31H96V33H22Z" fill="#1a262d" />
        <path d={snowLoad(115, 21, 24, 76, 3)} fill="url(#dowSnowCap)" />
        <path d="M24 25.4H94" stroke="#e6f2f7" strokeOpacity="0.2" strokeWidth="0.5" />
        {/* under-canopy light — the warm accent of this scene */}
        <ellipse cx="59" cy="33" rx="34" ry="4" fill={lit ? '#ffd79c' : '#7d8f99'} opacity={lit ? 0.5 : 0.16} />
        {lit ? (
          <>
            <path d="M28 33 L90 33 L104 56 L14 56 Z" fill="url(#dowSpill)" opacity="0.55" />
            <ellipse cx="59" cy="36" rx="40" ry="14" fill="url(#dowWarmGlow)" opacity="0.35" />
          </>
        ) : null}

        {/* pump islands */}
        <path d="M40 50H60V53.4H40Z" fill="#4d5960" />
        <path d="M62 50H80V53.4H62Z" fill="#4d5960" />
        <path d={snowLoad(117, 39, 50, 22, 1.2)} fill="url(#dowSnowCap)" opacity="0.9" />
        <path d={snowLoad(119, 61, 50, 20, 1.2)} fill="url(#dowSnowCap)" opacity="0.9" />
        {/* pumps */}
        <g>
          <rect x="44" y="38" width="5.4" height="12" rx="0.7" fill="url(#dowSteel)" />
          <rect x="45" y="39.4" width="3.4" height="3.4" rx="0.3" fill={lit ? '#ffd08a' : '#16232b'} />
          <rect x="66" y="38" width="5.4" height="12" rx="0.7" fill="url(#dowSteel)" />
          <rect x="67" y="39.4" width="3.4" height="3.4" rx="0.3" fill={lit ? '#ffd08a' : '#16232b'} />
          {/* a hose left trailing in the snow */}
          <path
            d="M71.4 44 Q77 46.5 76 51.6 Q75 56.4 82 57.2"
            stroke="#1d2a31"
            strokeWidth="0.7"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </g>

      {/* -- abandoned car at the near pump --------------------------- */}
      <g>
        <CastShadow x={12} y={65} w={30} h={5} skew={-0.6} opacity={0.32} />
        <path d="M9 65.6 Q10 61.4 15.4 60.8 L21 57 Q27 55.8 33 57.4 L37.6 61 Q42.6 61.6 43 65.6 Z" fill="#4a5a5f" />
        <path d="M21.6 58 Q26.8 56.9 32 58.4 L35 61 H18.6 Z" fill="url(#dowGlass)" />
        <path d={snowLoad(121, 10, 61.4, 33, 1.6)} fill="url(#dowSnowCap)" />
        <circle cx="16.4" cy="65.6" r="2.5" fill="#151f26" />
        <circle cx="36" cy="65.6" r="2.5" fill="#151f26" />
        <path d="M9 63.4 Q6.4 63.6 5.6 65.4" stroke="#d9e8ef" strokeOpacity="0.35" strokeWidth="0.5" fill="none" />
      </g>

      <path d={drift(123, LOC_W, 67.5, LOC_H + 8, 4, 2.3)} fill="url(#dowSnowNear)" />
    </>
  );
}

function Library({ lit }: SceneProps): JSX.Element {
  return (
    <>
      <Sky w={LOC_W} h={LOC_H} horizon={HORIZON} seed={31} />
      <path d={skylineBlocks(43, 0, LOC_W, HORIZON - 3, 3, 9)} fill="#294351" opacity="0.5" />
      {/* bare deciduous trees flanking */}
      <g stroke="#25404c" strokeWidth="0.6" fill="none" opacity="0.8">
        <path d="M12 46 V30 M12 36 L7 30 M12 34 L17.4 28.4 M12 39.4 L8 35 M12 32 L15 28" />
        <path d="M122 46 V32 M122 38 L117 32 M122 36 L127 31 M122 41 L118.4 37.4" />
      </g>
      <Ground w={LOC_W} h={LOC_H} horizon={HORIZON} seed={37} />

      <CastShadow x={22} y={52} w={90} h={12} skew={-0.7} opacity={0.28} />

      <g>
        <Contact x={24} y={54} w={86} />
        {/* podium and steps */}
        <path d="M18 50H116V54H18Z" fill="url(#dowStone)" />
        <path d="M14 54H120L123 58H11Z" fill="url(#dowStone)" />
        <path d={snowLoad(131, 13, 54, 108, 1.7)} fill="url(#dowSnowCap)" />
        <path d="M11 58H123L126 62H8Z" fill="url(#dowStone)" opacity="0.9" />
        <path d={snowLoad(133, 10, 58, 114, 1.8)} fill="url(#dowSnowCap)" opacity="0.95" />

        {/* cella wall behind the colonnade */}
        <path d="M28 24H106V50H28Z" fill="url(#dowStone)" />
        <path d="M28 24H106V50H28Z" fill="#0a141c" opacity="0.34" />
        {/* arched windows in the shadow of the portico */}
        <Window x={35} y={31} w={8} h={15} lit={lit} arch />
        <Window x={50} y={31} w={8} h={15} lit={false} arch />
        <Window x={65} y={31} w={8} h={15} lit={lit} arch />
        <Window x={80} y={31} w={8} h={15} lit={false} arch />
        {lit ? <path d="M30 50 L104 50 L112 63 L22 63 Z" fill="url(#dowSpill)" opacity="0.42" /> : null}

        {/* the doors */}
        <path d="M57 36H77V50H57Z" fill="#0d1720" />
        <path d="M58.4 37.4H75.6V50H58.4Z" fill="url(#dowPlank)" opacity="0.7" />
        <path d="M67 37.4V50" stroke="#0b1218" strokeWidth="0.5" />

        {/* colonnade */}
        {[26, 44, 62, 80, 98].map((cx, i) => (
          <g key={i}>
            <path d={`M${cx} 26 H${cx + 6} V50 H${cx} Z`} fill="url(#dowStone)" />
            <path
              d={`M${cx + 1.2} 26 V50 M${cx + 3} 26 V50 M${cx + 4.8} 26 V50`}
              stroke="#0d181e"
              strokeOpacity="0.28"
              strokeWidth="0.35"
            />
            <path d={`M${cx - 1} 24.6 H${cx + 7} V26.4 H${cx - 1} Z`} fill="url(#dowStone)" />
            <path d={`M${cx - 1} 48.6 H${cx + 7} V50.4 H${cx - 1} Z`} fill="url(#dowStone)" />
          </g>
        ))}

        {/* pediment */}
        <path d="M18 24 L67 12 L116 24 Z" fill="url(#dowStone)" />
        <path d="M22 23.2 L67 12 L112 23.2 L67 20.4 Z" fill="#0a141c" opacity="0.28" />
        <path
          d="M18.5 23.5 L67 12.4 L115.5 23.5"
          stroke="none"
          fill="none"
        />
        <path d={snowLoad(135, 17, 24, 100, 1.6)} fill="url(#dowSnowCap)" />
        <path
          d="M20 23 L67 12 L69 12.6 L24.4 23.4 Z"
          fill="#f0f7fa"
          opacity="0.72"
        />
        <path
          d="M114 23 L67 12 L65 12.6 L109.6 23.4 Z"
          fill="#d3e2ea"
          opacity="0.45"
        />
      </g>

      {/* -- lamp posts flanking the steps ---------------------------- */}
      <g>
        <path d="M20 62 V44" stroke="#33424b" strokeWidth="0.9" />
        <path d="M17.6 44 H22.4 L21.4 40.4 H18.6 Z" fill={lit ? '#ffd291' : '#2b3a43'} />
        {lit ? <ellipse cx="20" cy="42.4" rx="10" ry="9" fill="url(#dowWarmGlow)" opacity="0.7" /> : null}
        <path d="M114 62 V44" stroke="#33424b" strokeWidth="0.9" />
        <path d="M111.6 44 H116.4 L115.4 40.4 H112.6 Z" fill="#2b3a43" />
      </g>

      {/* torn banner between two columns */}
      <path
        d="M44 27 L58 27 L57 42 L52 39.4 L48 43 L44.6 39 Z"
        fill="#7c4a45"
        opacity="0.7"
      />
      <path d="M44 27 L58 27 L57.6 29.4 L44.2 29.4 Z" fill="#e2ebef" opacity="0.2" />

      <path d={drift(141, LOC_W, 65, LOC_H + 8, 4, 2.4)} fill="url(#dowSnowNear)" />
      {/* tracks through the drift up to the steps */}
      <g fill="#7f9db1" opacity="0.42">
        {Array.from({ length: 6 }, (_, i) => (
          <ellipse key={i} cx={62 + i * 2.6 + (i % 2) * 2.2} cy={72 - i * 1.6} rx="1.5" ry="0.7" />
        ))}
      </g>
    </>
  );
}

function Hospital({ lit }: SceneProps): JSX.Element {
  return (
    <>
      <Sky w={LOC_W} h={LOC_H} horizon={HORIZON} seed={47} />
      <path d={skylineBlocks(59, 0, LOC_W, HORIZON - 2, 6, 18)} fill="#2a4353" opacity="0.6" />
      <Ground w={LOC_W} h={LOC_H} horizon={HORIZON} seed={53} />

      <CastShadow x={18} y={51} w={98} h={12} skew={-0.8} opacity={0.28} />

      {/* -- the tall wing, right ------------------------------------ */}
      <g>
        <Contact x={78} y={52.6} w={44} />
        <path d="M78 8H120V52H78Z" fill="url(#dowConcrete)" />
        <path d="M78 8H120V52H78Z" fill="#08121a" opacity="0.14" />
        <path d={snowLoad(151, 77, 8, 44, 2.6)} fill="url(#dowSnowCap)" />
        <WindowGrid
          x={82}
          y={12}
          cols={4}
          rows={6}
          cw={6.4}
          ch={4.2}
          gapX={2.9}
          gapY={2.6}
          litMask={lit ? 0b000010_001000_000100_010000_000010_000100 : 0b000000_001000_000000_010000_000000_000000}
        />
        {/* floor bands */}
        <g stroke="#e8f2f7" strokeOpacity="0.14" strokeWidth="0.4">
          <path d="M78 18.6H120M78 25.4H120M78 32.2H120M78 39H120M78 45.8H120" />
        </g>
      </g>

      {/* -- ambulance bay, left ------------------------------------- */}
      <g>
        <Contact x={14} y={52.6} w={66} />
        <path d="M14 30H80V52H14Z" fill="url(#dowConcrete)" />
        <path d={snowLoad(153, 13, 30, 68, 2.4)} fill="url(#dowSnowCap)" />
        {/* bay opening, recessed and lit */}
        <path d="M22 34H62V52H22Z" fill="#0b141b" />
        <path d="M22 34H62V36H22Z" fill={lit ? '#ffdca8' : '#2c3b45'} opacity="0.85" />
        {lit ? (
          <>
            <rect x="22" y="34" width="40" height="18" fill="url(#dowWarmGlow)" opacity="0.45" />
            <path d="M22 52 L62 52 L72 66 L12 66 Z" fill="url(#dowSpill)" opacity="0.5" />
          </>
        ) : null}
        {/* red cross sign on the pier */}
        <rect x="66" y="33" width="10" height="10" rx="0.8" fill="#f0f6f8" opacity="0.92" />
        <path d="M69.6 34.6H72.4V38H75.8V40.8H72.4V44.2H69.6V40.8H66.2V38H69.6Z" fill="#c03a33" />
        <ellipse cx="71" cy="38.6" rx="11" ry="9" fill="url(#dowRedGlow)" opacity={lit ? 0.45 : 0.2} />
        <path d="M14 46H80" stroke="#e8f2f7" strokeOpacity="0.16" strokeWidth="0.5" />
      </g>

      {/* -- ambulance under the bay --------------------------------- */}
      <g>
        <CastShadow x={26} y={62} w={30} h={4} skew={-0.5} opacity={0.34} />
        <path d="M26 62 V50.4 H44 V62 Z" fill="#dfe9ee" />
        <path d="M44 53 L50.4 53 L54 57 V62 H44 Z" fill="#e6eff3" />
        <path d="M45.2 54.2 H50 L52.4 57 H45.2 Z" fill="url(#dowGlass)" />
        <path d="M26 56.4 H54" stroke="#c0402f" strokeWidth="1.5" opacity="0.85" />
        <path d="M30 51.6 H34.6 V54.6 H30 Z" fill="#c0402f" />
        <path d="M31.4 50.4 H33.2 V51.6 H31.4 Z" fill="#c0402f" />
        <rect x="32.6" y="48.8" width="5" height="1.6" rx="0.5" fill="#8e2f28" />
        <ellipse cx="35" cy="49.6" rx="7" ry="4.4" fill="url(#dowRedGlow)" opacity={lit ? 0.75 : 0.3} />
        <path d={snowLoad(155, 26, 50.4, 18, 1.2)} fill="url(#dowSnowCap)" opacity="0.9" />
        <circle cx="31" cy="62" r="2.2" fill="#151f26" />
        <circle cx="49.4" cy="62" r="2.2" fill="#151f26" />
      </g>

      {/* tipped gurney, foreground */}
      <g stroke="#a9bcc6" strokeWidth="0.55" fill="none" opacity="0.8">
        <path d="M86 68 L91 60 L110 62.4 L106.4 69" />
        <path d="M92.4 63 L108.6 65" strokeWidth="0.35" />
        <path d="M95 63.4 L94 68.4 M105 64.6 L104.4 69" />
      </g>
      <path d={drift(157, LOC_W, 66.5, LOC_H + 8, 4, 2.4)} fill="url(#dowSnowNear)" />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The colony — the panorama the game is about
 * ------------------------------------------------------------------ */

const HUB_HORIZON = 42;

function Colony({ lit }: SceneProps): JSX.Element {
  const lanterns = [40, 108, 172, 288, 352, 416];
  return (
    <>
      <Sky w={HUB_W} h={HUB_H} horizon={HUB_HORIZON} seed={71} />
      {/* moon behind the overcast */}
      <ellipse cx="356" cy="13" rx="22" ry="18" fill="url(#dowMoon)" />
      <circle cx="356" cy="13" r="4.2" fill="#f2f9fc" opacity="0.55" />

      {/* far ridge and treeline right across the panorama */}
      <path
        d={`M-10 ${HUB_HORIZON} Q90 ${HUB_HORIZON - 10} 190 ${HUB_HORIZON - 3} Q300 ${HUB_HORIZON - 12} ${HUB_W + 10} ${HUB_HORIZON - 4} L${HUB_W + 10} ${HUB_HORIZON + 8} L-10 ${HUB_HORIZON + 8} Z`}
        fill="#26404e"
        opacity="0.55"
      />
      <path d={conifers(83, 0, HUB_W, HUB_HORIZON, 5, 13, 8)} fill="#1d333f" opacity="0.82" />
      <Ground w={HUB_W} h={HUB_H} horizon={HUB_HORIZON} seed={89} />

      {/* -- watchtower, left ---------------------------------------- */}
      <g>
        <CastShadow x={22} y={54} w={18} h={7} skew={-0.9} opacity={0.26} />
        <path d="M24 54 L28.4 26 H35.6 L40 54 Z" fill="url(#dowSteel)" opacity="0.9" />
        <path d="M25.4 46 H38.6 M26.6 38 H37.4 M27.6 32 H36.4" stroke="#2a3740" strokeWidth="0.7" />
        <path d="M26 26 H38 V21 H26 Z" fill="url(#dowPlank)" />
        <path d="M24.4 21 L32 16 L39.6 21 Z" fill="url(#dowRoofDark)" />
        <path d={snowLoad(161, 25, 20.6, 14, 1.6)} fill="url(#dowSnowCap)" />
        <circle cx="36" cy="23.6" r="1.6" fill="#ffd79c" />
        <ellipse cx="36" cy="23.6" rx="13" ry="10" fill="url(#dowWarmGlow)" opacity="0.55" />
        <path d="M36 23.6 L88 54 L18 54 Z" fill="#ffd79c" opacity="0.07" />
      </g>

      {/* -- perimeter: corrugated fence, stacked cars, a bus --------- */}
      <g>
        {/* left approach blocked by a school bus lying across */}
        <CastShadow x={54} y={57} w={62} h={5} skew={-0.7} opacity={0.3} />
        <path d="M54 57 V46.6 H108 L114 50 V57 Z" fill="#8a6f2c" />
        <path d="M54 57 V46.6 H108 L114 50 V57 Z" fill="#0d1319" opacity="0.28" />
        <path d="M56 48.4 H104 V52 H56 Z" fill="url(#dowGlass)" />
        <path d="M64 48.4 V52 M72 48.4 V52 M80 48.4 V52 M88 48.4 V52 M96 48.4 V52" stroke="#2a3a44" strokeWidth="0.5" />
        <path d="M54 53.6 H114" stroke="#0b1117" strokeOpacity="0.5" strokeWidth="0.7" />
        <path d={snowLoad(163, 53, 46.6, 56, 1.9)} fill="url(#dowSnowCap)" />
        <circle cx="66" cy="57.4" r="2.6" fill="#141d24" />
        <circle cx="100" cy="57.4" r="2.6" fill="#141d24" />

        {/* corrugated steel fence across the right approach */}
        <path d="M330 56 H446 V40 H330 Z" fill="url(#dowSteel)" />
        <path d="M330 56 H446 V40 H330 Z" fill="url(#dowCorrTex)" opacity="0.75" />
        <path d={snowLoad(165, 329, 40, 118, 1.8)} fill="url(#dowSnowCap)" />
        <path d="M348 40 V56 M372 40 V56 M396 40 V56 M420 40 V56" stroke="#1a252c" strokeOpacity="0.6" strokeWidth="0.8" />
        {/* stacked cars buttressing the fence */}
        <path d="M300 56 Q301 50 306 49.4 L312 45.4 Q319 44.2 326 46 L331 49.6 Q336 50.2 337 56 Z" fill="#4b5b60" />
        <path d="M312.6 46.4 Q318.6 45.3 324.6 46.8 L328 49.6 H309.6 Z" fill="url(#dowGlass)" />
        <path d={snowLoad(167, 300, 49.6, 37, 1.5)} fill="url(#dowSnowCap)" />
      </g>

      {/* -- the safehouse ------------------------------------------- */}
      <g>
        <CastShadow x={150} y={55} w={130} h={10} skew={-0.75} opacity={0.3} />
        <Contact x={152} y={56} w={128} h={2.8} />

        {/* right annex / barn */}
        <path d="M258 30 H302 V56 H258 Z" fill="url(#dowPlank)" />
        <path d="M258 30 H302 V56 H258 Z" fill="url(#dowPlankTex)" opacity="0.55" />
        <path d="M258 30 H302 V56 H258 Z" fill="#0a1218" opacity="0.3" />
        <path d="M256 30 L280 20 L304 30 Z" fill="url(#dowRoofDark)" />
        <path d={snowLoad(171, 256, 29.4, 48, 2.4)} fill="url(#dowSnowCap)" />
        <path
          d="M256.6 29.4 L280 20 L282 20.8 L262 29.6 Z"
          fill="#f2f9fb"
          opacity="0.7"
        />
        <path d="M270 40 H290 V56 H270 Z" fill="#0d161c" />
        <path d="M271.4 41.4 H288.6 V56 H271.4 Z" fill="url(#dowPlank)" opacity="0.55" />
        <path d="M270 44 L290 48 M290 44 L270 48" stroke="#54402a" strokeWidth="1.4" />

        {/* main house */}
        <path d="M162 26 H262 V56 H162 Z" fill="url(#dowBrick)" />
        <path d="M162 26 H262 V56 H162 Z" fill="url(#dowBrickTex)" opacity="0.8" />
        <path d="M158 26 L212 10 L266 26 Z" fill="url(#dowRoofDark)" />
        <path d={snowLoad(173, 158, 25.4, 108, 3) } fill="url(#dowSnowCap)" />
        <path d="M158.6 25.4 L212 10 L215 11 L168 25.6 Z" fill="#f4fafc" opacity="0.75" />
        <path d="M265.4 25.4 L212 10 L209 11 L256 25.6 Z" fill="#cfe0e9" opacity="0.4" />

        {/* chimney and smoke */}
        <path d="M236 20 H244 V13.4 H236 Z" fill="url(#dowBrick)" />
        <path d="M235 13.4 H245 V11.6 H235 Z" fill="url(#dowBrick)" />
        <path d={snowLoad(175, 234.6, 11.6, 10.8, 1.2)} fill="url(#dowSnowCap)" />
        <path
          d="M240 11 Q244 6 249 5 Q255 3.6 257 -1 Q259 -5 266 -6"
          stroke="#cfdce2"
          strokeOpacity="0.3"
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
          filter="url(#dowSmoke)"
        />
        <path
          d="M240 11 Q243 7 247 6 Q252 4.6 254 1"
          stroke="#e6eff3"
          strokeOpacity="0.22"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
          filter="url(#dowSmoke)"
        />

        {/* upper floor — boarded windows leaking warm light */}
        <g>
          {[172, 196, 232, 250].map((x, i) => (
            <g key={i}>
              <path d={`M${x} 30 H${x + 13} V40 H${x} Z`} fill={lit ? '#f0b96e' : '#152530'} />
              {lit ? (
                <ellipse cx={x + 6.5} cy={35} rx="15" ry="11" fill="url(#dowWarmGlow)" opacity="0.5" />
              ) : null}
              <Boarded x={x} y={30} w={13} h={10} seed={181 + i} />
            </g>
          ))}
          {/* one unboarded, lit window — the room they actually live in */}
          <Window x={210} y={30} w={14} h={10} lit={lit} />
        </g>

        {/* ground floor — barricaded double door and sandbags */}
        <path d="M198 40 H228 V56 H198 Z" fill="#0b141a" />
        <path d="M199.6 41.4 H226.4 V56 H199.6 Z" fill={lit ? '#e8a95e' : '#16242e'} />
        <path d="M213 41.4 V56" stroke="#0a1015" strokeWidth="0.7" />
        {lit ? <path d="M198 56 L228 56 L246 72 L180 72 Z" fill="url(#dowSpill)" opacity="0.6" /> : null}
        {/* planks nailed across */}
        {[43.5, 48, 52.5].map((y, i) => (
          <g key={i}>
            <path
              d={`M195 ${y + (i % 2 ? -0.8 : 0.8)} H231 V${y + 2.8 + (i % 2 ? -0.8 : 0.8)} H195 Z`}
              fill="url(#dowPlank)"
            />
            <path
              d={`M195 ${y + (i % 2 ? -0.8 : 0.8)} H231`}
              stroke="#f2dcb4"
              strokeOpacity="0.2"
              strokeWidth="0.4"
            />
          </g>
        ))}
        {/* side windows, boarded */}
        <Boarded x={170} y={43} w={14} h={10} seed={191} />
        <Boarded x={240} y={43} w={14} h={10} seed={193} />
        {/* sandbags */}
        <g fill="#7d7362">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ellipse key={i} cx={186 + (i % 3) * 7} cy={54.4 - Math.floor(i / 3) * 3} rx="4" ry="2.1" />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={`r${i}`} cx={234 + (i % 2) * 7} cy={54.4 - Math.floor(i / 2) * 3} rx="4" ry="2.1" />
          ))}
        </g>
        <path d={snowLoad(195, 180, 50.4, 22, 1.2)} fill="url(#dowSnowCap)" opacity="0.85" />
        <path d={snowLoad(197, 229, 50.4, 17, 1.2)} fill="url(#dowSnowCap)" opacity="0.85" />
      </g>

      {/* -- fire barrel, foreground centre -------------------------- */}
      <g>
        <ellipse cx="150" cy="66" rx="16" ry="7" fill="url(#dowWarmGlow)" opacity="0.55" />
        <path d="M145 66.4 V58 H155 V66.4 Z" fill="#5d4433" />
        <path d="M145 60.4 H155 M145 63.4 H155" stroke="#2c1f16" strokeWidth="0.6" />
        <path d="M146.4 58 Q148 53.6 150 57 Q152 52.4 153.6 58 Z" fill="#ffb356" />
        <path d="M147.6 58 Q149.4 55 150.4 58 Z" fill="#ffe6b0" />
        <ellipse cx="150" cy="56" rx="9" ry="7" fill="url(#dowWarmGlow)" opacity="0.8" />
        <ellipse cx="150" cy="68" rx="9" ry="2.4" fill="#ffce8c" opacity="0.2" />
      </g>

      {/* -- six lanterns along the wire, one per entrance ------------ */}
      <g>
        {lanterns.map((x, i) => (
          <g key={i}>
            <path d={`M${x} 58 V48`} stroke="#39474f" strokeWidth="0.8" />
            <path d={`M${x - 1.8} 48 H${x + 1.8} L${x + 1.1} 45.2 H${x - 1.1} Z`} fill="#ffce8c" />
            <ellipse cx={x} cy="46.6" rx="7" ry="6" fill="url(#dowWarmGlow)" opacity="0.5" />
            <ellipse cx={x} cy="58.6" rx="6" ry="1.8" fill="#ffce8c" opacity="0.14" />
          </g>
        ))}
      </g>

      {/* -- foreground drift and tracks ----------------------------- */}
      <path d={drift(199, HUB_W, 62, HUB_H + 8, 9, 2.6)} fill="url(#dowSnowNear)" />
      <g fill="#7f9db1" opacity="0.4">
        {Array.from({ length: 9 }, (_, i) => (
          <ellipse key={i} cx={196 + i * 5.4 + (i % 2) * 3.4} cy={70 - i * 1.1} rx="2.2" ry="0.9" />
        ))}
      </g>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

const SCENES: Record<string, (p: SceneProps) => JSX.Element> = {
  'police-station': PoliceStation,
  'grocery-store': GroceryStore,
  school: School,
  'gas-station': GasStation,
  library: Library,
  hospital: Hospital,
};

export interface LocationSceneProps {
  location: LocationId;
  /** Somebody is here: the building gets its lamps and windows lit. */
  lit: boolean;
  isColony: boolean;
}

export function LocationScene({ location, lit, isColony }: LocationSceneProps): JSX.Element {
  const w = isColony ? HUB_W : LOC_W;
  const height = isColony ? HUB_H : LOC_H;
  const Scene = isColony ? Colony : (SCENES[location] ?? PoliceStation);
  return (
    <svg
      className="dow-scene__svg"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <g filter="url(#dowPaint)">
        <Scene lit={lit} />
      </g>
      <Snowfall w={w} h={height} seed={isColony ? 211 : 223} density={isColony ? 54 : 24} />
      <Finish w={w} h={height} />
    </svg>
  );
}
