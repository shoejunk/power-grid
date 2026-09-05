/**
 * Illustrated card faces for Dead of Winter.
 *
 * The quality bar (docs/QUALITY-BAR-DOW.md §0, V2, V8) names Wingspan as the
 * benchmark and says the reason Wingspan wins is that *painted card art is the
 * hero element*. A card that is a dark rectangle with a pictogram on it fails
 * V2 no matter how well the rest of the screen is laid out.
 *
 * We cannot ship raster paintings, so every card carries an authored vector
 * illustration instead: a staged little object study with a back wall, a floor
 * plane, a single cold light source from the upper left, a cast shadow, rim
 * light, surface texture and an atmospheric vignette. Drawn that way a vector
 * scene reads as illustration rather than as an icon, and being `viewBox`-based
 * it stays sharp at 4K (V13).
 *
 * Three rules shape the implementation:
 *
 *  1. **One shared `<defs>`.** Gradients, patterns and the shadow ramp live in
 *     a single hidden SVG mounted once per document and referenced by every
 *     card, so a ten-card hand is ten cheap shape trees, not ten filter chains
 *     (there are no SVG filters here at all — the grain is one cached CSS
 *     background image shared by every element that wants it).
 *  2. **Deterministic variation.** The scene is chosen from the card's own id,
 *     so the Splitting Axe always looks like the Splitting Axe, two cards with
 *     the same symbol rarely look identical, and nothing flickers on re-render.
 *  3. **No hidden information.** `CardBack` takes no card, because §3 says a
 *     face-down card must render from no definition at all.
 */

import type { ItemSymbol } from '@game/dead-of-winter';
import { useEffect, type ReactNode } from 'react';

import { DowIcon } from './iconography';
import './card-art.scss';

/* ------------------------------------------------------------------ *
 * Shared <defs>
 * ------------------------------------------------------------------ */

const DEFS_ID = 'dow-card-art-defs';

/**
 * Every gradient and pattern the illustrations paint with.
 *
 * Authored as markup rather than JSX because it is mounted once, imperatively,
 * outside the React tree: the defs must outlive any individual card, and a
 * portal owned by "whichever card happened to mount first" does not.
 */
const CARD_ART_DEFS = `
<defs>
  <!-- Cold overcast light falling into a dark interior. -->
  <linearGradient id="dowSky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#050a0f"/>
    <stop offset="0.38" stop-color="#0c1723"/>
    <stop offset="0.60" stop-color="#22394d"/>
    <stop offset="0.66" stop-color="#152331"/>
    <stop offset="1" stop-color="#080e15"/>
  </linearGradient>
  <linearGradient id="dowFloor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1c2a37"/>
    <stop offset="0.35" stop-color="#0f1922"/>
    <stop offset="1" stop-color="#04080c"/>
  </linearGradient>
  <radialGradient id="dowPool" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#d3e8f8" stop-opacity="0.22"/>
    <stop offset="0.55" stop-color="#a9c8de" stop-opacity="0.09"/>
    <stop offset="1" stop-color="#a9c8de" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="dowCast" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#000000" stop-opacity="0.82"/>
    <stop offset="0.55" stop-color="#000000" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="dowVig" cx="0.4" cy="0.36" r="0.82">
    <stop offset="0.4" stop-color="#01050a" stop-opacity="0"/>
    <stop offset="0.78" stop-color="#01050a" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#01050a" stop-opacity="0.82"/>
  </radialGradient>
  <radialGradient id="dowGlow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffe0b0" stop-opacity="0.85"/>
    <stop offset="0.35" stop-color="#f0973c" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#c9631a" stop-opacity="0"/>
  </radialGradient>

  <!-- Materials. Each is lit from the upper left and rolls to a core shadow. -->
  <linearGradient id="dowSteel" x1="0" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="#f0f7fb"/>
    <stop offset="0.22" stop-color="#b9c9d6"/>
    <stop offset="0.52" stop-color="#738799"/>
    <stop offset="0.78" stop-color="#3d4c5c"/>
    <stop offset="1" stop-color="#1b242e"/>
  </linearGradient>
  <linearGradient id="dowSteelCyl" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#26313c"/>
    <stop offset="0.18" stop-color="#9fb2c1"/>
    <stop offset="0.32" stop-color="#e8f1f7"/>
    <stop offset="0.58" stop-color="#8395a4"/>
    <stop offset="0.85" stop-color="#333f4b"/>
    <stop offset="1" stop-color="#5b6b78"/>
  </linearGradient>
  <linearGradient id="dowWood" x1="0" y1="0" x2="1" y2="0.4">
    <stop offset="0" stop-color="#c19a68"/>
    <stop offset="0.3" stop-color="#8e6c44"/>
    <stop offset="0.72" stop-color="#5a422a"/>
    <stop offset="1" stop-color="#2f2216"/>
  </linearGradient>
  <linearGradient id="dowTin" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#2a3541"/>
    <stop offset="0.16" stop-color="#a8bac8"/>
    <stop offset="0.3" stop-color="#e3ecf3"/>
    <stop offset="0.55" stop-color="#93a4b3"/>
    <stop offset="0.84" stop-color="#37444f"/>
    <stop offset="1" stop-color="#63737f"/>
  </linearGradient>
  <linearGradient id="dowLabel" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#6d3a2c"/>
    <stop offset="0.2" stop-color="#b5533b"/>
    <stop offset="0.42" stop-color="#c96a4c"/>
    <stop offset="0.75" stop-color="#77392a"/>
    <stop offset="1" stop-color="#3d1f18"/>
  </linearGradient>
  <linearGradient id="dowOlive" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3a422f"/>
    <stop offset="0.16" stop-color="#8c977a"/>
    <stop offset="0.34" stop-color="#a7b294"/>
    <stop offset="0.66" stop-color="#5d6a4c"/>
    <stop offset="1" stop-color="#242a1c"/>
  </linearGradient>
  <linearGradient id="dowPaper" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#e6dfcb"/>
    <stop offset="0.45" stop-color="#c3baa1"/>
    <stop offset="1" stop-color="#77705e"/>
  </linearGradient>
  <linearGradient id="dowCloth" x1="0" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="#8496a5"/>
    <stop offset="0.35" stop-color="#4c5b6a"/>
    <stop offset="1" stop-color="#131a22"/>
  </linearGradient>
  <linearGradient id="dowAmber" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#8c4d16"/>
    <stop offset="0.22" stop-color="#eab473"/>
    <stop offset="0.42" stop-color="#f7d3a0"/>
    <stop offset="0.72" stop-color="#c07a2c"/>
    <stop offset="1" stop-color="#5e3210"/>
  </linearGradient>
  <linearGradient id="dowFoil" x1="0" y1="0" x2="1" y2="0.6">
    <stop offset="0" stop-color="#eef4f8"/>
    <stop offset="0.3" stop-color="#b9c6d1"/>
    <stop offset="0.62" stop-color="#7e8e9c"/>
    <stop offset="1" stop-color="#48555f"/>
  </linearGradient>
  <linearGradient id="dowGauze" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#5d6672"/>
    <stop offset="0.2" stop-color="#d7dee4"/>
    <stop offset="0.42" stop-color="#f2f6f9"/>
    <stop offset="0.74" stop-color="#a9b4be"/>
    <stop offset="1" stop-color="#4d5661"/>
  </linearGradient>
  <linearGradient id="dowSheen" x1="0" y1="0" x2="0.7" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
    <stop offset="0.42" stop-color="#ffffff" stop-opacity="0.03"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="dowInk" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1b2836"/>
    <stop offset="0.5" stop-color="#101a25"/>
    <stop offset="1" stop-color="#070d14"/>
  </linearGradient>
  <radialGradient id="dowBurnish" cx="0.5" cy="0.42" r="0.62">
    <stop offset="0" stop-color="#4c6a83" stop-opacity="0.5"/>
    <stop offset="0.6" stop-color="#22394d" stop-opacity="0.2"/>
    <stop offset="1" stop-color="#050a10" stop-opacity="0.6"/>
  </radialGradient>

  <!-- Backdrops. Patterns keep the scene layers cheap. -->
  <pattern id="dowPlanks" width="17" height="100" patternUnits="userSpaceOnUse">
    <rect width="17" height="100" fill="#131c25"/>
    <rect width="8" height="100" fill="#182430" opacity="0.75"/>
    <rect x="15.6" width="1.4" height="100" fill="#05090d"/>
    <rect x="15" width="0.7" height="100" fill="#2b3a49" opacity="0.55"/>
  </pattern>
  <pattern id="dowTiles" width="20" height="16" patternUnits="userSpaceOnUse">
    <rect width="20" height="16" fill="#16222c"/>
    <rect width="19" height="15" fill="#1c2c38"/>
    <rect y="15" width="20" height="1" fill="#0a1117"/>
    <rect x="19" width="1" height="16" fill="#0a1117"/>
  </pattern>
  <pattern id="dowChain" width="13" height="13" patternUnits="userSpaceOnUse">
    <path d="M0 0 13 13M13 0 0 13" stroke="#8ea6ba" stroke-opacity="0.36" stroke-width="1.1" fill="none"/>
    <path d="M0.9 0 13.9 13M12.1 0 -0.9 13" stroke="#04090e" stroke-opacity="0.5" stroke-width="1.1" fill="none"/>
  </pattern>
  <pattern id="dowPeg" width="10" height="10" patternUnits="userSpaceOnUse">
    <rect width="10" height="10" fill="#16202a"/>
    <circle cx="5" cy="5" r="1.5" fill="#070c11"/>
    <circle cx="5" cy="4.3" r="1.5" fill="#2b3a48" opacity="0.5"/>
  </pattern>
  <pattern id="dowSlats" width="10" height="21" patternUnits="userSpaceOnUse">
    <rect width="10" height="21" fill="#111b24"/>
    <rect y="18" width="10" height="3" fill="#28353f"/>
    <rect y="20.4" width="10" height="1.4" fill="#050a0e"/>
  </pattern>
  <pattern id="dowHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
    <rect width="6" height="6" fill="none"/>
    <rect width="1" height="6" fill="#ffffff" fill-opacity="0.06"/>
  </pattern>

  <!-- The card back's printed rosette, drawn once and stamped four times. -->
  <linearGradient id="dowBackInk" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="#1d2c3b"/>
    <stop offset="0.5" stop-color="#132030"/>
    <stop offset="1" stop-color="#0a121b"/>
  </linearGradient>
</defs>`;

/** Mounts the shared defs into the document exactly once. */
function ensureCardArtDefs(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DEFS_ID)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', DEFS_ID);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;visibility:hidden';
  svg.innerHTML = CARD_ART_DEFS;
  document.body.appendChild(svg);
}

/* ------------------------------------------------------------------ *
 * Deterministic variation
 * ------------------------------------------------------------------ */

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A tiny deterministic PRNG so speckles and snow never move between renders. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Scene furniture
 * ------------------------------------------------------------------ */

const W = 160;
const H = 100;

type Backdrop = 'planks' | 'tiles' | 'chain' | 'peg' | 'slats' | 'open';

/**
 * The stage every object study is placed on: back wall, horizon, floor plane
 * and the pool of cold light the object sits in. Depth comes from three
 * separated planes plus haze, which is what keeps these from reading flat.
 */
function Stage({ backdrop, horizon = 63, lightX = 54 }: {
  backdrop: Backdrop;
  horizon?: number;
  lightX?: number;
}): JSX.Element {
  return (
    <g>
      <rect width={W} height={H} fill="url(#dowSky)" />
      {backdrop !== 'open' ? (
        <rect
          width={W}
          height={horizon + 1}
          fill={`url(#dow${backdrop === 'planks' ? 'Planks' : backdrop === 'tiles' ? 'Tiles' : backdrop === 'peg' ? 'Peg' : backdrop === 'chain' ? 'Chain' : 'Slats'})`}
          opacity={backdrop === 'chain' ? 0.85 : 1}
        />
      ) : null}
      {/* Haze: the far plane loses contrast, the near plane keeps it. */}
      <rect y={horizon - 26} width={W} height={30} fill="url(#dowPool)" opacity="0.65" />
      <rect y={horizon} width={W} height={H - horizon} fill="url(#dowFloor)" />
      <rect y={horizon - 0.9} width={W} height="0.9" fill="#7d99ae" opacity="0.32" />
      <ellipse cx={lightX} cy={horizon + 4} rx="84" ry="26" fill="url(#dowPool)" />
    </g>
  );
}

/** Grounding shadow. Objects that do not cast one look pasted on. */
function Cast({ x, y, rx, ry = 6, o = 0.85 }: {
  x: number;
  y: number;
  rx: number;
  ry?: number;
  o?: number;
}): JSX.Element {
  return <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="url(#dowCast)" opacity={o} />;
}

/** Airborne snow, thicker toward the camera. Sells "outside, and cold". */
function Snow({ seed, count = 16 }: { seed: number; count?: number }): JSX.Element {
  const rand = rng(seed);
  const flakes: JSX.Element[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 0.4 + rand() * 1.15;
    flakes.push(
      <circle key={i} cx={x} cy={y} r={r} fill="#eaf4fb" opacity={0.14 + r * 0.24} />,
    );
  }
  return <g>{flakes}</g>;
}

/** Dust, grit and pitting — the difference between "drawn" and "worn". */
function Grit({ seed, y0, y1, count = 18 }: {
  seed: number;
  y0: number;
  y1: number;
  count?: number;
}): JSX.Element {
  const rand = rng(seed);
  const bits: JSX.Element[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = rand() * W;
    const y = y0 + rand() * (y1 - y0);
    const r = 0.3 + rand() * 0.7;
    bits.push(<circle key={i} cx={x} cy={y} r={r} fill={rand() > 0.5 ? '#c8dcea' : '#000000'} opacity={0.2 + rand() * 0.25} />);
  }
  return <g>{bits}</g>;
}

/* ------------------------------------------------------------------ *
 * The seven object studies
 * ------------------------------------------------------------------ */

function WeaponScene({ seed, variant }: { seed: number; variant: number }): JSX.Element {
  return (
    <g>
      <Stage backdrop="planks" horizon={64} lightX={46} />
      {/* Something heavy hanging in the dark behind — depth cue. */}
      <path d="M118 0v22M118 22a5 5 0 0 0 10 0" stroke="#0a1119" strokeWidth="2.4" fill="none" opacity="0.9" />
      <Cast x={variant === 2 ? 84 : 70} y={variant === 2 ? 88 : 90} rx={variant === 2 ? 46 : 34} ry={7} />
      {variant === 0 ? (
        /* Fire axe leaning against the wall. */
        <g transform="translate(60 92) rotate(13)">
          <path d="M-3.4 0 3.4 0 2.3-64-2.3-64Z" fill="url(#dowWood)" />
          <path d="M-2.5-2-1.6-62" stroke="#e5c799" strokeWidth="1.1" opacity="0.34" fill="none" />
          <path d="M2.6-14 1.9-46" stroke="#1c1208" strokeWidth="1.2" opacity="0.5" fill="none" />
          <path d="M-5-72 4-74 4-46-5-48Z" fill="url(#dowSteel)" />
          <path d="M2-73 14-77c10 1 17 8 17 15s-7 14-17 15L2-49Z" fill="url(#dowSteel)" />
          <path d="M14.5-76.4C24-75.6 30.4-69 30.4-62s-6.4 13.6-15.9 14.5" stroke="#f4fbff" strokeWidth="1.5" fill="none" opacity="0.85" />
          <path d="M6-70 24-66" stroke="#0d141b" strokeWidth="1" opacity="0.45" fill="none" />
          <path d="M9-58c5-1 9 0 12 2" stroke="#8a4527" strokeWidth="2.4" opacity="0.5" fill="none" strokeLinecap="round" />
          <path d="M-4-70 4-72" stroke="#eef6fb" strokeWidth="0.9" opacity="0.5" fill="none" />
          <ellipse cx="0" cy="0" rx="4.2" ry="1.6" fill="#0a1017" opacity="0.8" />
        </g>
      ) : variant === 1 ? (
        /* Nailed bat, knob down. */
        <g transform="translate(64 92) rotate(-11)">
          <path d="M-3.6 0C-5.6 0-6.4-1.6-5.6-3.2L-4.6-6-4.4-40C-4.6-52-6.4-58-7-64l14 0c-.6 6-2.4 12-2.6 24l.2 34 1 2.8C6.4-1.6 5.6 0 3.6 0Z" fill="url(#dowWood)" />
          <path d="M-3.4-8-3-40c-.2-10-1.6-16-2.2-22" stroke="#e8cea4" strokeWidth="1.3" opacity="0.32" fill="none" />
          <path d="M4.2-10 3.6-42c.2-8 1.4-14 2-20" stroke="#170f07" strokeWidth="1.5" opacity="0.5" fill="none" />
          <g fill="#12181f" opacity="0.85">
            <path d="M-5.2-9 5.6-11.4 5.9-8.4-4.9-6Z" />
            <path d="M-5.4-15 5.4-17.4 5.7-14.4-5.1-12Z" />
          </g>
          <ellipse cx="0" cy="-1.5" rx="5.6" ry="2.4" fill="#4c3823" />
          <path d="M-5.6-64 6.6-64" stroke="#2a1d10" strokeWidth="1.6" fill="none" />
          <g transform="translate(3 -54) rotate(24)">
            <rect x="0" y="-0.9" width="15" height="1.8" fill="url(#dowSteel)" />
            <circle cx="0" cy="0" r="2" fill="#b9c9d6" />
            <path d="M15-0.9 17.4 0 15 0.9Z" fill="#eaf3f9" />
          </g>
        </g>
      ) : (
        /* Cleaver on the bench, seen from above-ish. */
        <g transform="translate(48 82)">
          <path d="M0-3 46-9 52-26 8-21Z" fill="url(#dowSteel)" />
          <path d="M8-21 52-26 51.4-28.6 7.6-23.6Z" fill="#f2f9fd" opacity="0.75" />
          <path d="M12-14 44-18" stroke="#ffffff" strokeWidth="1.2" opacity="0.28" fill="none" />
          <path d="M22-11c6-1 12-2 16-1" stroke="#8a4527" strokeWidth="2.2" opacity="0.42" fill="none" strokeLinecap="round" />
          <path d="M-22 1 2-2.4 2.6-9-21-5.6Z" fill="url(#dowWood)" />
          <circle cx="-14" cy="-3.4" r="1.5" fill="#cfdae4" opacity="0.7" />
          <circle cx="-6" cy="-4.4" r="1.5" fill="#cfdae4" opacity="0.7" />
          <path d="M-21.4-1.2 1.6-4.5" stroke="#e5c799" strokeWidth="1" opacity="0.3" fill="none" />
          <path d="M0-3 46-9" stroke="#0b1219" strokeWidth="1.1" opacity="0.6" fill="none" />
        </g>
      )}
      <Grit seed={seed + 7} y0={66} y1={99} />
      <rect width={W} height={H} fill="url(#dowVig)" />
    </g>
  );
}

function FuelScene({ seed, variant }: { seed: number; variant: number }): JSX.Element {
  return (
    <g>
      <Stage backdrop="planks" horizon={62} lightX={58} />
      {/* Spill: the reason a fuel scene reads wet rather than dusty. */}
      <ellipse cx="96" cy="86" rx="46" ry="11" fill="#0b1a1f" opacity="0.75" />
      <ellipse cx="96" cy="86" rx="46" ry="11" fill="url(#dowAmber)" opacity="0.16" />
      <ellipse cx="82" cy="83" rx="16" ry="3.2" fill="#cfe4f2" opacity="0.2" />
      <Cast x={58} y={87} rx={34} ry={7} />
      <g transform="translate(56 87)">
        {/* Jerrycan: front face, chamfered right face, embossed X brace. */}
        <path d="M-21 0h34c2 0 3-1 3-3v-44c0-3-2-5-5-5h-30c-3 0-5 2-5 5v44c0 2 1 3 3 3Z" fill="url(#dowOlive)" />
        <path d="M13 0c2 0 3-1 3-3v-44c0-3-2-5-5-5l9-3c3 0 5 2 5 5v45c0 2-1 4-3 4Z" fill="#1d2317" />
        <path d="M-15-6-2-42" stroke="#161a10" strokeWidth="2.6" fill="none" opacity="0.75" />
        <path d="M-1-6-14-42" stroke="#161a10" strokeWidth="2.6" fill="none" opacity="0.75" />
        <path d="M-16.2-6.6-3.2-42.6M-2.2-6.6-15.2-42.6" stroke="#c3ceae" strokeWidth="1" fill="none" opacity="0.32" />
        <path d="M-19-48h26" stroke="#0f1309" strokeWidth="1.6" fill="none" />
        <path d="M-13-52h12v4h-12z" fill="#39412c" />
        <path d="M-13-52h12v1.4h-12z" fill="#aab694" opacity="0.6" />
        <circle cx="9" cy="-50" r="4" fill="#2a3020" />
        <circle cx="9" cy="-50.8" r="4" fill="url(#dowSteel)" />
        <circle cx="9" cy="-50.8" r="1.6" fill="#0d1218" opacity="0.5" />
        <rect x="-18" y="-26" width="17" height="7" rx="1" fill="#7c3f1a" opacity="0.85" />
        <rect x="-18" y="-26" width="17" height="1.2" fill="#f0b36a" opacity="0.5" />
        <path d="M-20-46v42" stroke="#e6efd6" strokeWidth="2" opacity="0.2" fill="none" />
        <ellipse cx="-3" cy="0" rx="20" ry="2.4" fill="#050a0e" opacity="0.7" />
      </g>
      {variant === 1 ? (
        /* Funnel propped against the can. */
        <g transform="translate(104 87)">
          <path d="M-13-24 13-24 4-8 2 0H-2l-2-8Z" fill="url(#dowFoil)" opacity="0.92" />
          <path d="M-13-24 13-24 11.6-21.4-11.6-21.4Z" fill="#f4fafd" opacity="0.6" />
          <path d="M-8-22-2-9" stroke="#ffffff" strokeWidth="1" opacity="0.25" fill="none" />
          <Cast x={0} y={1} rx={14} ry={3.4} />
        </g>
      ) : variant === 2 ? (
        /* A lit road flare: the one warm light in a cold game. */
        <g transform="translate(112 80)">
          <circle cx="0" cy="-24" r="26" fill="url(#dowGlow)" />
          <rect x="-2.6" y="-22" width="5.2" height="24" rx="1" fill="#8d2f24" />
          <rect x="-2.6" y="-22" width="1.8" height="24" fill="#d4705a" opacity="0.6" />
          <ellipse cx="0" cy="-24" rx="4" ry="6" fill="#ffe7c0" />
          <path d="M0-34c3 4 4 7 3 10-2 4-8 4-9 0-1-3 2-6 6-10Z" fill="#ffd08a" opacity="0.85" />
        </g>
      ) : (
        /* A drained can lying on its side behind. */
        <g transform="translate(118 78) rotate(-8)">
          <rect x="-16" y="-11" width="32" height="12" rx="2.5" fill="#2b3324" />
          <rect x="-16" y="-11" width="32" height="4" rx="2" fill="#5a6749" opacity="0.8" />
          <circle cx="14" cy="-8" r="2.4" fill="#151a10" />
          <Cast x={0} y={2} rx={20} ry={3.6} />
        </g>
      )}
      <Grit seed={seed + 3} y0={64} y1={99} count={14} />
      <rect width={W} height={H} fill="url(#dowVig)" />
    </g>
  );
}

function EducationScene({ seed, variant }: { seed: number; variant: number }): JSX.Element {
  const covers = ['#4b3550', '#33465c', '#5a3a2c'];
  return (
    <g>
      <Stage backdrop="slats" horizon={62} lightX={44} />
      {/* Lamp glow spilling from off-frame left. */}
      <ellipse cx="16" cy="44" rx="62" ry="46" fill="url(#dowGlow)" opacity="0.28" />
      <Cast x={72} y={88} rx={54} ry={8} />
      <g transform="translate(70 86)">
        {[0, 1, 2].map((i) => {
          const y = -i * 9;
          const a = (i % 2 === 0 ? -1 : 1) * (1.4 + i * 0.7);
          const w = 42 - i * 3;
          return (
            <g key={i} transform={`translate(${i * 2 - 2} ${y}) rotate(${a})`}>
              <rect x={-w} y={-3} width={w * 2} height="3" fill="url(#dowPaper)" />
              <path d={`M${-w} -3h${w * 2}v0.7h${-w * 2}z`} fill="#ffffff" opacity="0.28" />
              <path d={`M${-w + 2} -1.6h${w * 2 - 4}M${-w + 2} -0.6h${w * 2 - 4}`} stroke="#6d6552" strokeWidth="0.4" opacity="0.7" fill="none" />
              <rect x={-w - 2} y={-6.4} width={(w + 2) * 2} height="3.6" rx="0.8" fill={covers[(i + variant) % 3]} />
              <rect x={-w - 2} y={-6.4} width={(w + 2) * 2} height="1" rx="0.5" fill="#ffffff" opacity="0.16" />
              <rect x={-w - 2} y={0} width={(w + 2) * 2} height="2.6" rx="0.8" fill="#1a1420" />
              <rect x={-w - 2} y={-6.4} width="2.4" height="9" rx="1" fill="#0d0a12" opacity="0.6" />
            </g>
          );
        })}
        {/* An open volume propped on the stack, pages fanned. */}
        <g transform="translate(6 -30) rotate(-7)">
          <path d="M-30 6 0 2 30 6 30 8 0 4-30 8Z" fill="#2b3444" />
          <path d="M-30 6C-22-2-10-6 0 2-10-2-22 0-30 8Z" fill="url(#dowPaper)" />
          <path d="M30 6C22-2 10-6 0 2 10-2 22 0 30 8Z" fill="url(#dowPaper)" opacity="0.86" />
          <path d="M-26 5.4C-19-1-10-4-1.6 1.4M-22 5C-16 0-9-2.4-2.4 1" stroke="#8b8371" strokeWidth="0.4" opacity="0.8" fill="none" />
          <path d="M26 5.4C19-1 10-4 1.6 1.4M22 5C16 0 9-2.4 2.4 1" stroke="#8b8371" strokeWidth="0.4" opacity="0.6" fill="none" />
          <path d="M0 2v2.6" stroke="#151b24" strokeWidth="1" fill="none" />
        </g>
        {/* Reading glasses folded on the top board. */}
        {variant !== 2 ? (
          <g transform="translate(-30 -19) rotate(-9)" opacity="0.95">
            <circle cx="-7" cy="0" r="5" fill="none" stroke="#c8d6e0" strokeWidth="1.2" />
            <circle cx="7" cy="0" r="5" fill="none" stroke="#c8d6e0" strokeWidth="1.2" />
            <path d="M-2 0h4M12 0l8-3" stroke="#c8d6e0" strokeWidth="1.2" fill="none" />
            <circle cx="-7" cy="0" r="4.2" fill="#cfe4f2" opacity="0.12" />
            <circle cx="7" cy="0" r="4.2" fill="#cfe4f2" opacity="0.12" />
          </g>
        ) : null}
      </g>
      <Grit seed={seed + 11} y0={64} y1={99} count={12} />
      <rect width={W} height={H} fill="url(#dowVig)" />
    </g>
  );
}

function FoodScene({ seed, variant }: { seed: number; variant: number }): JSX.Element {
  const rand = rng(seed);
  const openTin = variant === 1;
  return (
    <g>
      <Stage backdrop="slats" horizon={66} lightX={62} />
      {/* Empty shelf behind, receding — the pantry is nearly bare. */}
      <rect y="26" width={W} height="3" fill="#22303c" opacity="0.7" />
      <rect y="29" width={W} height="2" fill="#050a0e" opacity="0.8" />
      <g opacity="0.4">
        <rect x="14" y="12" width="12" height="14" rx="1" fill="#0d151d" />
        <rect x="30" y="15" width="9" height="11" rx="1" fill="#0d151d" />
        <rect x="126" y="13" width="14" height="13" rx="1" fill="#0d151d" />
      </g>
      <Cast x={78} y={88} rx={56} ry={8} />
      {/* Back tin: smaller, hazier, lower contrast. */}
      <g transform="translate(112 78)" opacity="0.72">
        <rect x="-11" y="-26" width="22" height="26" fill="url(#dowTin)" />
        <ellipse cx="0" cy="-26" rx="11" ry="3.4" fill="#93a4b3" />
        <ellipse cx="0" cy="-26" rx="8" ry="2.2" fill="#5c6b78" />
        <rect x="-11" y="-19" width="22" height="12" fill="url(#dowLabel)" opacity="0.85" />
        <ellipse cx="0" cy="0" rx="11" ry="3.2" fill="#04080c" opacity="0.7" />
      </g>
      {/* Hero tin. */}
      <g transform="translate(64 88)">
        <rect x="-16" y="-38" width="32" height="38" fill="url(#dowTin)" />
        <ellipse cx="0" cy="0" rx="16" ry="4.6" fill="#2b3742" />
        <ellipse cx="0" cy="-38" rx="16" ry="4.6" fill="#a8b9c6" />
        <ellipse cx="0" cy="-38" rx="16" ry="4.6" fill="url(#dowSheen)" />
        <ellipse cx="0" cy="-37.6" rx="12.4" ry="3.4" fill="#63737f" />
        <ellipse cx="0" cy="-38.4" rx="12.4" ry="3.4" fill="#8fa0ad" />
        {openTin ? (
          <>
            <ellipse cx="0" cy="-37.6" rx="12.4" ry="3.4" fill="#1a2028" />
            <ellipse cx="0" cy="-36.6" rx="11" ry="2.8" fill="#6d5330" />
            <ellipse cx="-2" cy="-37" rx="6" ry="1.6" fill="#a07a45" opacity="0.7" />
            <path d="M8-38c8-2 13-6 13-10 0-2-2-3-3-2 1 3-3 8-11 9Z" fill="url(#dowFoil)" />
            <path d="M8-38c8-2 13-6 13-10" stroke="#f2f9fd" strokeWidth="0.9" fill="none" opacity="0.7" />
          </>
        ) : null}
        <rect x="-16" y="-28" width="32" height="17" fill="url(#dowLabel)" />
        <rect x="-16" y="-28" width="32" height="1.2" fill="#f0c0a0" opacity="0.35" />
        <rect x="-16" y="-12.2" width="32" height="1.2" fill="#20100c" opacity="0.6" />
        <g opacity="0.55">
          <rect x="-10" y="-24" width="20" height="1.5" rx="0.7" fill="#f6e6d6" />
          <rect x="-10" y="-20.5" width="13" height="1.1" rx="0.5" fill="#f6e6d6" />
          <rect x="-10" y="-17.5" width="16" height="1.1" rx="0.5" fill="#f6e6d6" />
        </g>
        {/* Torn corner and rust: the tin has been in a cold room a long time. */}
        <path d="M10-28l6 3v-3Z" fill="#93a4b3" opacity="0.8" />
        <path d="M-16-8c4 2 9 2 13 0" stroke="#7d4a2c" strokeWidth="1.6" fill="none" opacity="0.5" />
        <rect x="-15" y="-36" width="2.4" height="34" fill="#eef6fb" opacity="0.16" />
      </g>
      {/* Foreground tin, slightly cropped: pushes the hero back into the frame. */}
      <g transform="translate(30 94)">
        <rect x="-13" y="-30" width="26" height="30" fill="url(#dowTin)" />
        <ellipse cx="0" cy="-30" rx="13" ry="3.8" fill="#b3c3cf" />
        <ellipse cx="0" cy="-30" rx="9.6" ry="2.6" fill="#63737f" />
        <rect x="-13" y="-22" width="26" height="13" fill="#2f3f4c" />
        <rect x="-13" y="-22" width="26" height="1.1" fill="#8fa8ba" opacity="0.5" />
        <rect x="-12.2" y="-28" width="2" height="26" fill="#eef6fb" opacity="0.14" />
      </g>
      {Array.from({ length: 5 }, (_, i) => (
        <circle key={i} cx={20 + rand() * 128} cy={82 + rand() * 14} r={0.6 + rand() * 0.9} fill="#dbe9f4" opacity={0.22} />
      ))}
      <rect width={W} height={H} fill="url(#dowVig)" />
    </g>
  );
}

function MedicineScene({ seed, variant }: { seed: number; variant: number }): JSX.Element {
  return (
    <g>
      <Stage backdrop="tiles" horizon={60} lightX={70} />
      <rect y="8" width={W} height="1.4" fill="#7fa3bd" opacity="0.18" />
      <Cast x={80} y={86} rx={56} ry={8} />
      {/* Blister pack, foil side up, two domes popped. */}
      <g transform="translate(44 82) rotate(-6)">
        <rect x="-24" y="-17" width="48" height="19" rx="2.4" fill="url(#dowFoil)" />
        <rect x="-24" y="-17" width="48" height="2" rx="1" fill="#ffffff" opacity="0.4" />
        <rect x="-24" y="0" width="48" height="2" rx="1" fill="#0d141b" opacity="0.5" />
        {[0, 1, 2].map((c) =>
          [0, 1].map((r) => {
            const popped = (c + r) % 3 === variant % 3;
            const cx = -15 + c * 15;
            const cy = -12 + r * 8;
            return popped ? (
              <g key={`${c}-${r}`}>
                <ellipse cx={cx} cy={cy} rx="5.4" ry="3.2" fill="#2b3742" />
                <ellipse cx={cx} cy={cy - 0.4} rx="4.6" ry="2.4" fill="#0d141b" />
              </g>
            ) : (
              <g key={`${c}-${r}`}>
                <ellipse cx={cx} cy={cy} rx="5.6" ry="3.4" fill="#c8d6e0" />
                <ellipse cx={cx} cy={cy - 0.5} rx="5" ry="2.8" fill="#f2f8fc" />
                <ellipse cx={cx - 1.6} cy={cy - 1.2} rx="1.8" ry="0.9" fill="#ffffff" opacity="0.9" />
              </g>
            );
          }),
        )}
        <Cast x={0} y={4} rx={28} ry={4} o={0.7} />
      </g>
      {/* Amber vial with a crimp cap and a meniscus. */}
      <g transform="translate(100 86)">
        <Cast x={2} y={1} rx={16} ry={4} o={0.8} />
        <rect x="-9" y="-34" width="18" height="34" rx="2.5" fill="#20303a" />
        <rect x="-9" y="-34" width="18" height="34" rx="2.5" fill="url(#dowAmber)" opacity="0.9" />
        <rect x="-9" y="-34" width="18" height="10" rx="2.5" fill="#0e1a22" opacity="0.5" />
        <ellipse cx="0" cy="-24" rx="9" ry="2.4" fill="#f7d3a0" opacity="0.55" />
        <rect x="-6.6" y="-32" width="3" height="30" rx="1.5" fill="#ffffff" opacity="0.34" />
        <rect x="4" y="-32" width="1.8" height="30" rx="0.9" fill="#3a1c06" opacity="0.5" />
        <rect x="-10" y="-42" width="20" height="9" rx="1.6" fill="url(#dowFoil)" />
        <rect x="-10" y="-42" width="20" height="2.4" rx="1.2" fill="#ffffff" opacity="0.5" />
        <rect x="-5" y="-45" width="10" height="4" rx="1.4" fill="#8fa0ad" />
        <rect x="-8" y="-22" width="16" height="9" rx="1" fill="#e8eef3" opacity="0.92" />
        <path d="M-5-19h10M-5-16.4h7" stroke="#41505d" strokeWidth="1" fill="none" />
      </g>
      {/* Gauze roll on its side. */}
      {variant !== 2 ? (
        <g transform="translate(132 88)">
          <Cast x={0} y={1} rx={14} ry={3.4} o={0.7} />
          <rect x="-11" y="-14" width="22" height="14" fill="url(#dowGauze)" />
          <ellipse cx="-11" cy="-7" rx="3" ry="7" fill="#c3ccd4" />
          <ellipse cx="11" cy="-7" rx="3" ry="7" fill="#f0f5f9" />
          <ellipse cx="11" cy="-7" rx="1.2" ry="2.8" fill="#5d6672" />
          <path d="M-6-14v14M0-14v14M6-14v14" stroke="#8f9aa6" strokeWidth="0.5" opacity="0.5" fill="none" />
        </g>
      ) : null}
      <Grit seed={seed + 5} y0={62} y1={99} count={10} />
      <rect width={W} height={H} fill="url(#dowVig)" />
    </g>
  );
}

function ToolScene({ seed, variant }: { seed: number; variant: number }): JSX.Element {
  return (
    <g>
      <Stage backdrop="peg" horizon={64} lightX={52} />
      {/* Tools still hanging on the board — background plane. */}
      <g opacity="0.55" fill="#080d13">
        <path d="M22 4v20a4 4 0 0 0 8 0V4Z" />
        <path d="M46 4l-4 22h8l-4-22Z" />
        <path d="M132 6h4v22h-4z" />
        <path d="M126 6h16v4h-16z" />
      </g>
      <Cast x={78} y={88} rx={54} ry={8} />
      {/* Combination wrench across the bench. */}
      <g transform="translate(76 82) rotate(-9)">
        <rect x="-40" y="-3.4" width="80" height="6.8" rx="3" fill="url(#dowSteel)" />
        <rect x="-40" y="-3.4" width="80" height="2" rx="1" fill="#f2f9fd" opacity="0.45" />
        <rect x="-24" y="-1.4" width="48" height="2" rx="1" fill="#1c242e" opacity="0.5" />
        <circle cx="-44" cy="0" r="11" fill="url(#dowSteel)" />
        <circle cx="-44" cy="0" r="5.6" fill="#0a1016" />
        <circle cx="-44" cy="-0.6" r="5.6" fill="#38454f" />
        <circle cx="-44" cy="0" r="10.4" fill="none" stroke="#eef6fb" strokeOpacity="0.4" strokeWidth="1" />
        <path d="M40-10c8 0 12 3 12 6l-6 2 6 2c0 3-4 6-12 6Z" fill="url(#dowSteel)" />
        <path d="M40-10c8 0 12 3 12 6" stroke="#f2f9fd" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M-20 3.2 20 3.2" stroke="#05090d" strokeWidth="1.2" fill="none" opacity="0.6" />
      </g>
      {/* Roll of tape: a torus with a real inner shadow. */}
      <g transform="translate(34 80)">
        <Cast x={2} y={9} rx={20} ry={4.4} o={0.8} />
        <ellipse cx="0" cy="0" rx="19" ry="14" fill="#1a222b" />
        <ellipse cx="0" cy="-1.6" rx="19" ry="14" fill="url(#dowSteelCyl)" opacity="0.5" />
        <ellipse cx="0" cy="-1.6" rx="19" ry="14" fill="#232c36" opacity="0.55" />
        <ellipse cx="0" cy="-1.6" rx="7.4" ry="5.4" fill="#05090d" />
        <ellipse cx="0" cy="-2.6" rx="7.4" ry="5.4" fill="#2f3b45" />
        <path d="M-19-1.6a19 14 0 0 1 12-13" stroke="#c3d2de" strokeWidth="1.6" fill="none" opacity="0.4" />
        <path d="M13 6c6 3 10 4 14 3" stroke="#39434d" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M13 5c6 3 10 4 14 3" stroke="#8593a0" strokeWidth="1" fill="none" opacity="0.6" />
      </g>
      {/* Loose fixings scattered in the light pool. */}
      {variant !== 0 ? (
        <g transform="translate(122 88)">
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${i * 9 - 8} ${(i % 2) * 4}) rotate(${i * 37})`}>
              <rect x="-1.4" y="-5" width="2.8" height="10" rx="0.6" fill="url(#dowSteel)" />
              <circle cx="0" cy="-5" r="2.6" fill="#9fb2c1" />
              <circle cx="0" cy="-5.6" r="2.6" fill="#d8e3ec" />
            </g>
          ))}
        </g>
      ) : null}
      <Grit seed={seed + 2} y0={66} y1={99} count={16} />
      <rect width={W} height={H} fill="url(#dowVig)" />
    </g>
  );
}

function SurvivorScene({ seed, variant }: { seed: number; variant: number }): JSX.Element {
  return (
    <g>
      <Stage backdrop="open" horizon={70} lightX={92} />
      {/* Far treeline, then fence, then figure: three depth planes. */}
      <g opacity="0.55" fill="#0a141d">
        <path d="M0 70 10 46 18 70ZM22 70 34 42 46 70ZM52 70 60 52 68 70ZM104 70 116 44 128 70ZM132 70 142 50 152 70Z" />
      </g>
      <rect y="18" width={W} height="52" fill="url(#dowChain)" opacity="0.5" />
      <g stroke="#141f29" strokeWidth="3" fill="none" opacity="0.9">
        <path d="M26 14v58M118 12v60" />
        <path d="M0 18h160" />
      </g>
      {/* Snow drift catching the last of the light. */}
      <path d="M0 76c26-8 52-4 78-9s54-9 82-3v36H0Z" fill="#1c2c3a" />
      <path d="M0 76c26-8 52-4 78-9s54-9 82-3" stroke="#c7dbea" strokeWidth="1.6" fill="none" opacity="0.5" />
      <Cast x={70} y={92} rx={40} ry={6} />
      {variant === 2 ? (
        <g transform="translate(112 82)" opacity="0.42">
          <path d="M-8 0c-1-10 0-17 3-21-3-3-3-8 0-10 3-2 7-1 8 2 1 3 0 6-2 7 4 4 6 12 5 22Z" fill="#0d151d" />
        </g>
      ) : null}
      {/* The survivor: read as silhouette first, rim light second. */}
      <g transform={`translate(${64 + (seed % 5) - 2} 88)`}>
        <path d="M-15 0c-2-16 0-27 4-33-1-2-2-5-2-8 0-8 5-13 12-13s12 5 12 13c0 3-1 6-2 8 5 6 7 17 5 33Z" fill="url(#dowCloth)" />
        <path d="M-15 0c-2-16 0-27 4-33-1-2-2-5-2-8 0-8 5-13 12-13" stroke="#cfe4f6" strokeWidth="1.4" fill="none" opacity="0.6" />
        <path d="M-3-46c6-1 11 2 12 8 1 5-2 9-6 10-5 1-9-2-10-7-1-5 0-9 4-11Z" fill="#0a1119" />
        <path d="M-2-42c4 0 7 3 7 7" stroke="#8fa8bd" strokeWidth="1.1" fill="none" opacity="0.55" />
        <ellipse cx="1" cy="-38" rx="3.4" ry="2" fill="#c9dced" opacity="0.16" />
        <path d="M-11-18h22" stroke="#0a0f15" strokeWidth="2.6" fill="none" opacity="0.55" />
        <path d="M11-26c5 3 7 8 6 14" stroke="#243140" strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
      {/* Breath, and the cold that makes it visible. */}
      <ellipse cx="80" cy="50" rx="12" ry="6" fill="#dcecf8" opacity="0.13" />
      <ellipse cx="88" cy="47" rx="7" ry="4" fill="#dcecf8" opacity="0.09" />
      {variant === 1 ? (
        <g transform="translate(122 84)">
          <circle cx="0" cy="-6" r="14" fill="url(#dowGlow)" opacity="0.5" />
          <rect x="-4" y="-12" width="8" height="11" rx="1.4" fill="#2b3742" />
          <rect x="-3" y="-11" width="6" height="9" rx="1" fill="#f5c67c" opacity="0.85" />
          <path d="M-4-12h8M0-16v4" stroke="#8fa0ad" strokeWidth="1.2" fill="none" />
        </g>
      ) : null}
      <Snow seed={seed} count={22} />
      <rect width={W} height={H} fill="url(#dowVig)" />
    </g>
  );
}

const SCENES: Record<ItemSymbol, (p: { seed: number; variant: number }) => JSX.Element> = {
  weapon: WeaponScene,
  fuel: FuelScene,
  education: EducationScene,
  food: FoodScene,
  medicine: MedicineScene,
  tool: ToolScene,
  survivor: SurvivorScene,
};

/* ------------------------------------------------------------------ *
 * Public art components
 * ------------------------------------------------------------------ */

export interface CardVignetteProps {
  /** Drives which object study is staged. */
  symbol?: ItemSymbol;
  /** Card identity — the same card always gets the same scene. */
  seedKey: string;
}

/**
 * The painted window at the top of a card.
 *
 * `preserveAspectRatio="xMidYMid slice"` so the scene fills whatever shape the
 * card ends up with instead of letterboxing inside it.
 */
export function CardVignette({ symbol, seedKey }: CardVignetteProps): JSX.Element {
  const h = hash32(seedKey);
  const Scene = symbol ? SCENES[symbol] : ToolScene;
  const variant = h % 3;
  return (
    <svg
      className="dow-cardart__svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <Scene seed={h} variant={variant} />
    </svg>
  );
}

/**
 * The printed back of a Dead of Winter card.
 *
 * Takes no card and no seed: §3 requires that a face-down card be renderable
 * from nothing at all, so there is nothing here that could leak.
 */
export function CardBack(): JSX.Element {
  return (
    <svg
      className="dow-cardart__svg"
      viewBox="0 0 120 168"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="120" height="168" fill="url(#dowBackInk)" />
      <rect width="120" height="168" fill="url(#dowBurnish)" />
      {/* Printed rule frame — two weights, like a real card back. */}
      <rect x="6" y="6" width="108" height="156" rx="3" fill="none" stroke="#4a6c88" strokeWidth="1.4" opacity="0.62" />
      <rect x="9.5" y="9.5" width="101" height="149" rx="2" fill="none" stroke="#4a6c88" strokeWidth="0.6" opacity="0.4" />
      {/* Frost rosette. Six arms, each with barbs, drawn once and rotated. */}
      <g transform="translate(60 84)" stroke="#7fa8c8" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5">
        {[0, 30, 60, 90, 120, 150].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <path d="M0-34V34" />
            <path d="M-4-26 0-30 4-26M-4 26 0 30 4 26M-3.4-15 0-18.4 3.4-15M-3.4 15 0 18.4 3.4 15" />
          </g>
        ))}
      </g>
      <circle cx="60" cy="84" r="10" fill="#0d1721" stroke="#7fa8c8" strokeWidth="1.2" opacity="0.75" />
      <circle cx="60" cy="84" r="4.4" fill="#7fa8c8" opacity="0.4" />
      {/* Corner marks, faint, so the back has a top and a bottom. */}
      <g fill="#5c82a1" opacity="0.35">
        <path d="M18 18h10v2h-8v8h-2zM102 18h-10v2h8v8h2zM18 150h10v-2h-8v-8h-2zM102 150h-10v-2h8v-8h2z" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * The card face
 * ------------------------------------------------------------------ */

export type CardClass = 'item' | 'crisis' | 'crossroads' | 'objective' | 'facedown';

export interface CardFaceProps {
  /** Which printed stock and plate treatment to use. */
  kind: CardClass;
  name: string;
  text?: string;
  symbols?: readonly ItemSymbol[];
  /** Accessible description of the symbol row; omitted for a decorative row. */
  symbolsLabel?: string;
  /** The small stamped tag along the bottom rule — "Equip", "Crisis", … */
  tag?: string;
  /** Card identity used to pick the illustration. Never a hidden id. */
  seedKey?: string;
  /** The symbol the illustration is staged around. */
  artSymbol?: ItemSymbol;
  /** Anything extra to stamp into the plate, e.g. a contribution count. */
  meta?: ReactNode;
}

/**
 * One printed card face: art window, nameplate, body, footer rule.
 *
 * The class names `dow-card__name` / `__symbols` / `__text` / `__kind` are kept
 * exactly where they were before the art existed, because other stylesheets and
 * tests key off them. Everything new is namespaced `dow-cardart__`.
 */
export function CardFace({
  kind,
  name,
  text,
  symbols,
  symbolsLabel,
  tag,
  seedKey,
  artSymbol,
  meta,
}: CardFaceProps): JSX.Element {
  useEffect(ensureCardArtDefs, []);
  const facedown = kind === 'facedown';

  return (
    <>
      <span className="dow-cardart__art">
        {facedown ? <CardBack /> : <CardVignette symbol={artSymbol} seedKey={seedKey ?? name} />}
        <span className="dow-cardart__grain" aria-hidden="true" />
        <span className="dow-cardart__glaze" aria-hidden="true" />
        {!facedown && symbols && symbols.length > 0 ? (
          <span className="dow-cardart__pipsback" aria-hidden="true" />
        ) : null}
        {!facedown && symbols ? (
          <span
            className="dow-card__symbols dow-cardart__pips"
            role={symbols.length ? 'img' : undefined}
            aria-label={symbols.length ? symbolsLabel : undefined}
          >
            {symbols.map((symbol, i) => (
              <span className="dow-cardart__pip" key={`${symbol}-${i}`}>
                <DowIcon name={symbol} size={13} decorative />
              </span>
            ))}
          </span>
        ) : null}
      </span>

      <span className="dow-cardart__plate">
        <span className="dow-card__name">{name}</span>
        {meta ? <span className="dow-cardart__meta">{meta}</span> : null}
      </span>

      <span className="dow-cardart__body">
        {text ? <span className="dow-card__text">{text}</span> : null}
        {tag ? (
          <span className="dow-card__kind dow-cardart__tag">
            <span className="dow-cardart__rule" aria-hidden="true" />
            {tag}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** The class list a card element needs to pick up the printed treatment. */
export function cardArtClasses(kind: CardClass): string {
  return `dow-cardart dow-cardart--${kind}`;
}
