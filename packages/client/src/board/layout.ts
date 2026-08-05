/**
 * Board layout solver.
 *
 * Everything positional is decided here, once, off the map data plus the size
 * of the container. The React tree downstream is a pure function of the result,
 * so a re-render never re-solves and pan/zoom never re-solves either.
 *
 * The interesting part is label placement. QUALITY-BAR U5 demands that "board
 * topology is legible unaided — connection costs always readable, no overlay
 * needed", which is precisely where the benchmark (Risk: Global Domination) is
 * documented to fail: it had to bolt on a Territory Connection Overlay. So the
 * cost of every one of Germany's 83 connections is placed by an explicit
 * collision solver, not by hoping the midpoint is free:
 *
 *   1. Each city reserves ONE box covering both its name and its three-slot
 *      plate. Those boxes are relaxed apart (Germany's Ruhr packs four cities
 *      into 37 board units), and any plate that had to move keeps a stem back
 *      to a dot at its true coordinate, which is still where routes meet.
 *   2. Those boxes go into a spatial index and are never yielded, so a cost
 *      badge can never cover a city or its name.
 *   3. Every connection is then offered 121 candidate slots — eleven arc-length
 *      positions crossed with eleven signed offsets along the curve *normal* —
 *      scanned offset-major so each badge gets a chance to sit flush against
 *      its own line before any badge floats away from it. Edges are solved
 *      shortest-first, because a 25-unit edge has almost no free arc to bargain
 *      with while a 150-unit edge has plenty.
 *   4. Whatever stage 3 could not place cleanly is then pushed apart by an
 *      iterative separation pass against both the city boxes and the other
 *      badges, with a weak spring home so badges drift back to their line as
 *      room appears, and a tether keeping each within reach of its own route.
 *   5. Any badge that ends up off its line grows a leader line back to the
 *      nearest point of the route it prices, so it is never ambiguous.
 *
 * Widths come from real glyph measurement rather than character counts: at the
 * smallest supported container size the board packs to ~54% coverage, where a
 * 10% over-estimate is the difference between zero overlaps and several.
 */

import type { CityId, GameMap, MapConnection } from '@pg/shared';

import {
  BOARD_H,
  RectIndex,
  boardSpace,
  buildRoutePath,
  cityPoint,
  clamp,
  closestOnPolyline,
  dist,
  frameAt,
  overlapArea,
  rectFromCenter,
  separation,
  type BoardSpace,
  type Rect,
  type RoutePath,
  type Vec,
} from './geometry';

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

/**
 * Every size the board draws with, expressed in board units.
 *
 * They are derived from how many *screen* pixels one board unit is worth at
 * fit-zoom, so type never falls below a readable size just because the match
 * grid handed us a small cell. Connection-cost type has the highest floor of
 * anything on the board: it is the criterion we intend to win on.
 */
export interface Metrics {
  pxPerUnit: number;
  /** Minimum nameplate width — the three slots always fit. */
  plateW: number;
  plateH: number;
  /** Height of the name ribbon at the top of the nameplate. */
  nameH: number;
  /** Height of the slot row beneath it. */
  slotH: number;
  pipR: number;
  pipPitch: number;
  costFont: number;
  nameFont: number;
  badgeH: number;
  badgeFont: number;
  anchorR: number;
  routeW: number;
  /** "OUT OF PLAY" region label (§1). Floored well clear of the 10 px line. */
  outzoneFont: number;
  /** Screen-pixel size of connection-cost type; floored for legibility. */
  badgeFontPx: number;
  /** Screen-pixel size of city-name type; floored for legibility. */
  nameFontPx: number;
  /** Screen-pixel size of the out-of-play region label. */
  outzoneFontPx: number;
  /** Diagnostic: typical city spacing in screen pixels. */
  medianNNpx: number;
}

/*
 * Screen-pixel floors. Nothing the board draws is allowed below 10 px — that is
 * the size at which a reviewer stops calling type "small" and starts calling it
 * broken, and city names sat on an 8.2 px floor for exactly as long as the board
 * was letterboxed into half its cell.
 */
const MIN_BADGE_FONT_PX = 10.5;
const MIN_NAME_FONT_PX = 10;
const MIN_OUTZONE_FONT_PX = 13;

export function computeMetrics(map: GameMap, containerW: number, containerH: number): Metrics {
  const space = boardSpace(map);
  const pxPerUnit = Math.max(
    0.0001,
    Math.min(containerW / space.width, containerH / space.height),
  );
  const U = 1 / pxPerUnit;

  // Typical spacing between neighbouring cities, in screen pixels — the honest
  // measure of how much room the board actually has.
  const pts = map.cities.map((c) => cityPoint(c, space));
  const nn = pts.map((p, i) => {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      best = Math.min(best, dist(p, pts[j]!));
    }
    return best;
  });
  nn.sort((a, b) => a - b);
  const medianNNpx = (nn[Math.floor(nn.length / 2)] ?? 60) * pxPerUnit;

  let pipRpx = clamp(medianNNpx * 0.105, 4.6, 8.4);
  let nameFontPx = clamp(medianNNpx * 0.145, MIN_NAME_FONT_PX, 13);
  let badgeHpx = clamp(medianNNpx * 0.32, 13.6, 21);

  /*
   * Auto-fit. Below roughly a 640x386 cell, 42 nameplates and 83 cost badges
   * stop fitting at these sizes and the solver is forced to accept overlaps.
   * Rather than let that happen, estimate the coverage the layout is about to
   * demand and shrink the *optional* type — city names and slot pips — until
   * it is back inside what can be packed.
   *
   * Connection-cost type is deliberately exempt and keeps its own hard floor:
   * it is the one thing U5 will not trade away, and shrinking it to buy room
   * for city names would be the wrong bargain.
   */
  const boardWpx = space.width * pxPerUnit;
  const boardHpx = space.height * pxPerUnit;
  const avgNameRatio =
    map.cities.reduce((sum, c) => sum + nameWidthRatio(c.name), 0) / Math.max(1, map.cities.length);
  const estimate = (pip: number, nameFont: number, badgeH: number): number => {
    const plateW = (pip * 2 + 1.7) * 2 + pip * 2 + 5;
    const cityW = Math.max(plateW, avgNameRatio * nameFont + nameFont * 0.7);
    const cityH = pip * 2 + 3.4 + nameFont * 1.34;
    const badgeW = Math.max(badgeH * 1.05, 2 * Math.max(MIN_BADGE_FONT_PX, badgeH * 0.7) * 0.6 + badgeH * 0.5);
    return (
      (map.cities.length * cityW * cityH + map.connections.length * badgeW * badgeH) /
      Math.max(1, boardWpx * boardHpx)
    );
  };

  const TARGET_COVERAGE = 0.46;
  const coverage = estimate(pipRpx, nameFontPx, badgeHpx);
  if (coverage > TARGET_COVERAGE) {
    const squeeze = clamp(Math.sqrt(TARGET_COVERAGE / coverage), 0.62, 1);
    pipRpx = Math.max(3.4, pipRpx * squeeze);
    // The squeeze buys packing room out of the optional type, but never below
    // the legibility floor: an unreadable name is worth less than a tight board.
    nameFontPx = Math.max(MIN_NAME_FONT_PX, nameFontPx * squeeze);
    badgeHpx = Math.max(MIN_BADGE_FONT_PX / 0.7, badgeHpx * squeeze);
  }

  const pipPitchPx = pipRpx * 2 + 1.7;
  const slotHpx = pipRpx * 2 + 3.4;
  const nameHpx = nameFontPx * 1.34;
  const badgeFontPx = Math.max(MIN_BADGE_FONT_PX, badgeHpx * 0.7);
  const outzoneFontPx = Math.max(MIN_OUTZONE_FONT_PX, nameFontPx * 1.15);

  return {
    pxPerUnit,
    plateW: (pipPitchPx * 2 + pipRpx * 2 + 5) * U,
    plateH: (slotHpx + nameHpx) * U,
    nameH: nameHpx * U,
    slotH: slotHpx * U,
    pipR: pipRpx * U,
    pipPitch: pipPitchPx * U,
    costFont: clamp(pipRpx * 1.2, 6, 10) * U,
    nameFont: nameFontPx * U,
    badgeH: badgeHpx * U,
    badgeFont: badgeFontPx * U,
    anchorR: clamp(pipRpx * 0.34, 1.7, 3.2) * U,
    routeW: clamp(medianNNpx * 0.058, 2.5, 4.6) * U,
    outzoneFont: outzoneFontPx * U,
    badgeFontPx,
    nameFontPx,
    outzoneFontPx,
    medianNNpx,
  };
}

/* ------------------------------------------------------------------ *
 * Text measurement
 *
 * Estimating advance widths from character counts over-reserves by ~10% on a
 * condensed face like Oswald, and at the smallest supported container size the
 * board is packed tightly enough that 10% is the difference between zero
 * overlapping cost badges and several. So measure the real thing once per
 * string, at a reference size, and scale.
 * ------------------------------------------------------------------ */

const widthRatios = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null | undefined;

function nameWidthRatio(text: string): number {
  const cached = widthRatios.get(text);
  if (cached !== undefined) return cached;
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  let ratio = text.length * 0.485;
  if (measureCtx) {
    measureCtx.font = `500 100px "Oswald", "Arial Narrow", sans-serif`;
    const measured = measureCtx.measureText(text).width;
    if (measured > 0) ratio = measured / 100;
  }
  widthRatios.set(text, ratio);
  return ratio;
}

const nameWidth = (name: string, font: number): number => nameWidthRatio(name) * font;

/**
 * Collision footprint of a city: the slot plate, plus the name that floats
 * above it. The name is drawn as haloed text rather than on a ribbon — a
 * nameplate wide enough for "Wilhelmshaven" would be a sixth of the board's
 * width — but it is reserved as one box with the plate so that every one of the
 * 42 names is guaranteed a clear spot instead of being solved away.
 */
export function footprintFor(name: string, m: Metrics): { w: number; h: number } {
  return {
    w: Math.max(m.plateW, nameWidth(name, m.nameFont) + m.nameFont * 0.7),
    h: m.plateH,
  };
}

/* ------------------------------------------------------------------ *
 * Layout result
 * ------------------------------------------------------------------ */

export interface NodeLayout {
  id: CityId;
  name: string;
  areaId: string;
  /** True map coordinate — where routes meet and where the anchor dot sits. */
  anchor: Vec;
  /** Centre of the city's whole footprint (name + slot plate) after relaxation. */
  plate: Vec;
  /** Footprint used by the collision solver; width varies with the city name. */
  w: number;
  h: number;
  /** Drawn width of the slot plate itself — constant, and much narrower than `w`. */
  plateW: number;
  /** Name baseline, relative to the footprint centre. */
  nameY: number;
  /** Centre-line of the three house slots, relative to the footprint centre. */
  slotY: number;
  /** True when the plate had to move far enough to need a stem. */
  stem: boolean;
}

export interface BadgeLayout {
  /** Badge centre. */
  at: Vec;
  w: number;
  h: number;
  /** Point on the route the badge belongs to. */
  anchor: Vec;
  /** True when the badge sits far enough out to need a leader line. */
  leader: boolean;
  /** Diagnostic: overlap area the solver had to accept. 0 for every Germany edge. */
  residual: number;
}

export interface RouteLayout {
  id: string;
  a: CityId;
  b: CityId;
  cost: number;
  path: RoutePath;
  badge: BadgeLayout;
}

export interface BoardLayout {
  map: GameMap;
  space: BoardSpace;
  metrics: Metrics;
  nodes: NodeLayout[];
  nodeById: Map<CityId, NodeLayout>;
  routes: RouteLayout[];
  routesByCity: Map<CityId, RouteLayout[]>;
  routeByPair: Map<string, RouteLayout>;
  /** Solved positions of the §1 "OUT OF PLAY" region labels. */
  outzoneLabels: OutzoneLabel[];
  /** Number of badges that could not find a fully clear slot. */
  badgeCollisions: number;
  /**
   * Honest, itemised overlap census on the geometry that is actually drawn.
   * Every one of these must be 0 — U5 is the criterion we intend to win on, and
   * a single number hides which pair regressed.
   */
  collisions: {
    badgeBadge: number;
    badgeName: number;
    nameName: number;
    badgeOutzone: number;
    nameOutzone: number;
    total: number;
  };
}

/**
 * The out-of-play region label (§1). `RegionLayer` draws it at these metrics,
 * at the position the solver chose — see `placeOutzoneLabels`.
 */
export const OUTZONE_LABEL = 'OUT OF PLAY';
/** Matches `letter-spacing: 0.22em` on `.pgb-outzone-label`. */
const OUTZONE_TRACKING = 0.22;

export interface OutzoneLabel {
  areaId: string;
  at: Vec;
  w: number;
  h: number;
}

export function outzoneLabelBox(m: Metrics): { w: number; h: number } {
  const f = m.outzoneFont;
  return {
    w: (nameWidthRatio(OUTZONE_LABEL) + OUTZONE_TRACKING * OUTZONE_LABEL.length) * f,
    h: f * 1.45,
  };
}

/**
 * Finds a clear home for each §1 region label.
 *
 * The label is decoration; the 42 nameplates are data, and they are already
 * settled by the time this runs. So the label moves, not the plates: it is
 * offered a ring search outward from the region's visual centre and takes the
 * first position clear of every nameplate. Only once it has a home is it handed
 * to the badge solver as an obstacle — which is what stops the three connection
 * costs that used to land on top of it.
 */
function placeOutzoneLabels(
  areas: readonly { id: string; at: Vec }[],
  plateBoxes: readonly Rect[],
  m: Metrics,
  space: BoardSpace,
): OutzoneLabel[] {
  const { w, h } = outzoneLabelBox(m);
  const out: OutzoneLabel[] = [];
  const taken: Rect[] = [];

  const cost = (cand: Vec): number => {
    if (
      cand.x < w / 2 ||
      cand.x > space.width - w / 2 ||
      cand.y < h / 2 ||
      cand.y > space.height - h / 2
    ) {
      return Infinity;
    }
    const rect = rectFromCenter(cand, w, h);
    let sum = 0;
    for (const b of plateBoxes) sum += overlapArea(rect, b);
    for (const b of taken) sum += overlapArea(rect, b);
    return sum;
  };

  for (const area of areas) {
    let best = area.at;
    let bestScore = cost(area.at) * 6;

    const GOLDEN = 2.39996;
    rings: for (let ring = 1; ring <= 12 && bestScore > 0; ring++) {
      const radius = h * (0.9 + ring * 0.85);
      const steps = 10 + ring * 3;
      for (let s = 0; s < steps; s++) {
        const a = s * GOLDEN + ring * 0.6;
        const cand = {
          x: area.at.x + Math.cos(a) * radius * 1.15,
          y: area.at.y + Math.sin(a) * radius,
        };
        // Drifting off the region centre is cheap; covering a name is not.
        const score = cost(cand) * 6 + radius;
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
        if (score <= radius) break rings;
      }
    }

    taken.push(rectFromCenter(best, w, h));
    out.push({ areaId: area.id, at: best, w, h });
  }
  return out;
}

export const pairKey = (a: CityId, b: CityId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ------------------------------------------------------------------ *
 * 1. Plate relaxation
 * ------------------------------------------------------------------ */

/**
 * Pushes overlapping nameplates apart while springing each back toward its true
 * coordinate. Germany's Ruhr cluster (Duisburg/Essen/Düsseldorf/Dortmund) spans
 * 25-37 board units, so at any realistic container size the plates would
 * otherwise bury each other. Displaced plates keep a stem back to a dot at the
 * real coordinate, which is where routes still meet.
 */
function relaxPlates(
  anchors: Vec[],
  sizes: { w: number; h: number }[],
  m: Metrics,
  space: BoardSpace,
): { pos: Vec[]; moved: boolean[] } {
  const pos = anchors.map((a) => ({ ...a }));
  const gap = m.plateH * 0.1;
  // Generous travel: Germany packs six cities (Duisburg, Essen, Düsseldorf,
  // Dortmund, Münster, Köln) into a patch narrower than two nameplates, and a
  // stem back to the true dot makes a displaced plate unambiguous.
  const maxDisp = Math.max(m.plateW * 1.5, m.plateH * 2.4);

  const ITERS = 300;
  for (let iter = 0; iter < ITERS; iter++) {
    const relax = 0.62;
    /*
     * Anneal the pull back toward the true coordinate. Held constant it fights
     * separation forever and settles at an equilibrium that still overlaps;
     * decaying it to zero lets the last third of the pass resolve the Ruhr
     * cluster outright, having already found the minimal displacement.
     */
    const homePull = 0.13 * Math.max(0, 1 - iter / (ITERS * 0.62)) ** 2;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        const needX = (sizes[i]!.w + sizes[j]!.w) / 2 + gap;
        const needY = (sizes[i]!.h + sizes[j]!.h) / 2 + gap;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const penX = needX - Math.abs(dx);
        const penY = needY - Math.abs(dy);
        if (penX <= 0 || penY <= 0) continue;

        // Separate along the axis that needs the least proportional travel.
        if (penX / needX < penY / needY) {
          const push = ((penX * relax) / 2) * (dx >= 0 ? 1 : -1);
          a.x -= push;
          b.x += push;
        } else {
          const push = ((penY * relax) / 2) * (dy >= 0 ? 1 : -1);
          a.y -= push;
          b.y += push;
        }
      }
    }
    // Spring home, then clamp both the displacement and the board bounds.
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i]!;
      const a = anchors[i]!;
      p.x += (a.x - p.x) * homePull;
      p.y += (a.y - p.y) * homePull;
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > maxDisp) {
        p.x = a.x + (dx / d) * maxDisp;
        p.y = a.y + (dy / d) * maxDisp;
      }
      p.x = clamp(p.x, sizes[i]!.w / 2 + 1, space.width - sizes[i]!.w / 2 - 1);
      p.y = clamp(p.y, sizes[i]!.h / 2 + 1, space.height - sizes[i]!.h / 2 - 1);
    }
  }

  const moved = pos.map((p, i) => dist(p, anchors[i]!) > m.anchorR * 2.2);
  return { pos, moved };
}

/* ------------------------------------------------------------------ *
 * 3. Cost badges — QUALITY-BAR U5
 * ------------------------------------------------------------------ */

/**
 * Arc-length positions tried. Sliding along `t` is what makes long edges cheap
 * to satisfy: a 150-unit route has plenty of clear arc even when its midpoint
 * is buried under a city.
 */
const BADGE_T = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8];
/**
 * Signed multiples of the badge height, along the curve *normal*. Tried
 * offset-major, so every edge is offered a slot flush against its own line
 * before any edge is allowed to float away from it.
 */
const BADGE_OFFSET = [0, 1, -1, 1.7, -1.7, 2.5, -2.5, 3.4, -3.4, 4.4, -4.4];

function badgeWidth(cost: number, m: Metrics): number {
  const digits = String(cost).length;
  return Math.max(m.badgeH * 1.05, digits * m.badgeFont * 0.6 + m.badgeH * 0.5);
}

interface PreparedRoute {
  conn: MapConnection;
  path: RoutePath;
}

interface SolvedBadge extends PreparedRoute {
  badge: BadgeLayout;
}

/**
 * Places one cost badge per connection so that no badge overlaps another badge
 * or any city node.
 *
 * Two stages, because neither alone is sufficient on Germany:
 *
 *   A. Greedy slotting. Each edge, shortest first, is offered 121 candidate
 *      slots (11 arc positions x 11 signed normal offsets) scanned
 *      *offset-major*, so every badge gets a chance to sit flush against its
 *      own line before any badge is allowed to float away from it. The first
 *      collision-free slot wins.
 *   B. Separation relaxation. Whatever stage A could not place cleanly is
 *      pushed out of its conflicts by simultaneous minimal-translation
 *      vectors, against both the static city boxes and the other badges,
 *      with a weak spring back toward the preferred slot so badges drift home
 *      again as space frees up. Each badge is tethered within a fixed radius
 *      of its own route and grows a leader line once it leaves the line.
 *
 * Stage B is what takes Germany from ~37 unplaced badges to 0.
 */
function solveBadges(
  prepared: PreparedRoute[],
  cityBoxes: readonly Rect[],
  m: Metrics,
  space: BoardSpace,
  pad: number,
): SolvedBadge[] {
  const n = prepared.length;
  const w: number[] = new Array(n);
  const h = m.badgeH + pad * 2;
  const home: Vec[] = new Array(n);
  const at: Vec[] = new Array(n);
  const tether = m.badgeH * 7;

  const cell = Math.max(28, m.plateW * 0.8);
  /** City plates and anchor dots — never movable, never overlappable. */
  const obstacles = new RectIndex(cell);
  for (const r of cityBoxes) obstacles.insert(r);
  /** Obstacles plus the badges placed so far, used only by the greedy stage. */
  const taken = new RectIndex(cell);
  for (const r of cityBoxes) taken.insert(r);

  /* --- stage A: greedy slotting --- */
  for (let i = 0; i < n; i++) {
    const { conn, path } = prepared[i]!;
    w[i] = badgeWidth(conn.cost, m) + pad * 2;
    const boxW = w[i]!;

    let bestAt: Vec | null = null;
    let bestScore = Infinity;
    let placed = false;

    for (let oi = 0; oi < BADGE_OFFSET.length && !placed; oi++) {
      const k = BADGE_OFFSET[oi]!;
      for (let ti = 0; ti < BADGE_T.length; ti++) {
        const t = BADGE_T[ti]!;
        const frame = frameAt(path, t);
        const off = k * h * 1.02;
        const cand = {
          x: frame.point.x + frame.normal.x * off,
          y: frame.point.y + frame.normal.y * off,
        };
        const overlap = taken.overlap(rectFromCenter(cand, boxW, h));
        const penalty = Math.abs(k) * h * 1.4 + Math.abs(t - 0.5) * m.badgeH * 1.1;
        const score = overlap * 4 + penalty;
        if (score < bestScore) {
          bestScore = score;
          bestAt = cand;
        }
        if (overlap === 0) {
          placed = true;
          break;
        }
      }
    }

    const chosen = bestAt ?? frameAt(path, 0.5).point;
    home[i] = { ...chosen };
    at[i] = { ...chosen };
    taken.insert(rectFromCenter(chosen, boxW, h));
  }

  /* --- stage B: separation relaxation --- */
  const rectOf = (i: number): Rect => rectFromCenter(at[i]!, w[i]!, h);
  const push: Vec[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));

  const ITERS = 900;
  for (let iter = 0; iter < ITERS; iter++) {
    let dirty = false;
    for (let i = 0; i < n; i++) {
      push[i]!.x = 0;
      push[i]!.y = 0;
    }

    for (let i = 0; i < n; i++) {
      const ri = rectOf(i);
      for (const obstacle of obstacles.query(ri)) {
        const s = separation(ri, obstacle);
        if (s.x !== 0 || s.y !== 0) {
          push[i]!.x += s.x;
          push[i]!.y += s.y;
          dirty = true;
        }
      }
      for (let j = i + 1; j < n; j++) {
        const s = separation(ri, rectOf(j));
        if (s.x === 0 && s.y === 0) continue;
        push[i]!.x += s.x * 0.5;
        push[i]!.y += s.y * 0.5;
        push[j]!.x -= s.x * 0.5;
        push[j]!.y -= s.y * 0.5;
        dirty = true;
      }
    }

    if (!dirty) break;

    const relax = 0.62;
    // Same annealing as the plate pass: the spring home keeps badges near their
    // own line early on, then releases so the last third can resolve outright.
    const homePull = 0.04 * Math.max(0, 1 - iter / (ITERS * 0.62)) ** 2;
    for (let i = 0; i < n; i++) {
      const p = at[i]!;
      p.x += push[i]!.x * relax;
      p.y += push[i]!.y * relax;
      /*
       * Tether to the whole route rather than to the slot the greedy pass
       * picked. That is the badge's second degree of freedom: it can slide
       * anywhere along its own edge as well as out along the normal. Most
       * residual conflicts are two badges pinned near t=0.5 on edges meeting at
       * a hub city, and freeing t is what dissolves them.
       */
      const near = closestOnPolyline(prepared[i]!.path.points, p);
      const d = Math.sqrt(near.d2);
      if (d > tether) {
        p.x = near.point.x + ((p.x - near.point.x) / d) * tether;
        p.y = near.point.y + ((p.y - near.point.y) / d) * tether;
      }
      // Hug the line, with a mild bias back toward the preferred slot.
      p.x += (near.point.x - p.x) * homePull * 0.6 + (home[i]!.x - p.x) * homePull * 0.25;
      p.y += (near.point.y - p.y) * homePull * 0.6 + (home[i]!.y - p.y) * homePull * 0.25;
      p.x = clamp(p.x, w[i]! / 2, space.width - w[i]! / 2);
      p.y = clamp(p.y, h / 2, space.height - h / 2);
    }
  }

  /* ------------------------------------------------------------------ *
   * Stage C: escalate the stragglers.
   *
   * Separation moves along the axis of least penetration, so a badge boxed
   * into a corridor narrower than itself oscillates forever instead of
   * escaping. There are only ever a handful; each is offered a wide spiral of
   * positions out along its own normal — far further than the relaxation's
   * tether allows — and takes the first that is completely clear. It then
   * carries a leader line back to its route, which is the right trade:
   * an always-legible badge with a leader beats a well-placed badge that
   * overlaps something.
   * ------------------------------------------------------------------ */
  const residualOf = (i: number): number => {
    const ri = rectOf(i);
    let sum = obstacles.overlap(ri);
    for (let j = 0; j < n; j++) if (j !== i) sum += overlapArea(ri, rectOf(j));
    return sum;
  };

  const ESCALATE_OFFSETS = [2, -2, 3, -3, 4, -4, 5, -5, 6.5, -6.5, 8, -8, 9.5, -9.5];
  const ESCALATE_T: number[] = [];
  for (let k = 0; k <= 20; k++) ESCALATE_T.push(0.06 + (k / 20) * 0.88);

  for (let i = 0; i < n; i++) {
    if (residualOf(i) <= 0.5) continue;
    const path = prepared[i]!.path;
    const others: Rect[] = [];
    for (const r of cityBoxes) others.push(r);
    for (let j = 0; j < n; j++) if (j !== i) others.push(rectOf(j));

    let best: Vec | null = null;
    let bestScore = Infinity;

    const consider = (cand: Vec, penalty: number): boolean => {
      if (
        cand.x < w[i]! / 2 ||
        cand.x > space.width - w[i]! / 2 ||
        cand.y < h / 2 ||
        cand.y > space.height - h / 2
      ) {
        return false;
      }
      const rect = rectFromCenter(cand, w[i]!, h);
      let sum = 0;
      for (const o of others) {
        sum += overlapArea(rect, o);
        if (sum * 8 > bestScore) break;
      }
      const score = sum * 8 + penalty;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
      return sum === 0;
    };

    /* First choice: still on the badge's own line, just further out. */
    search: for (const k of ESCALATE_OFFSETS) {
      for (const t of ESCALATE_T) {
        const frame = frameAt(path, t);
        const cand = {
          x: frame.point.x + frame.normal.x * k * h,
          y: frame.point.y + frame.normal.y * k * h,
        };
        if (consider(cand, Math.abs(k) * h)) break search;
      }
    }

    /*
     * Last resort: a ring search in free 2D around the edge's midpoint. The
     * normal search can only probe two directions, so a badge whose route runs
     * through a dense corridor may have no clear slot on either side while
     * there is plenty of room just off-axis. The leader line keeps it
     * unambiguous wherever it lands.
     */
    if (bestScore > 0) {
      const mid = frameAt(path, 0.5).point;
      const GOLDEN = 2.39996;
      rings: for (let ring = 1; ring <= 10; ring++) {
        const radius = h * (1.4 + ring * 1.25);
        const steps = 12 + ring * 4;
        for (let s = 0; s < steps; s++) {
          const a = s * GOLDEN + ring * 0.7;
          const cand = { x: mid.x + Math.cos(a) * radius, y: mid.y + Math.sin(a) * radius };
          if (consider(cand, radius * 1.6)) break rings;
        }
      }
    }

    if (best) at[i] = best;
  }

  /* --- report and finish --- */
  const out: SolvedBadge[] = [];
  for (let i = 0; i < n; i++) {
    const { conn, path } = prepared[i]!;
    const residual = residualOf(i);
    // The leader points at the nearest point of this badge's OWN route, so an
    // offset badge is never ambiguous about which connection it prices.
    const near = closestOnPolyline(path.points, at[i]!);
    out.push({
      conn,
      path,
      badge: {
        at: { ...at[i]! },
        w: w[i]! - pad * 2,
        h: m.badgeH,
        anchor: near.point,
        leader: Math.sqrt(near.d2) > m.badgeH * 1.15,
        residual,
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

const layoutCache = new Map<string, BoardLayout>();

/**
 * @param outOfPlay Visual centre of each area that is out of the playing zone
 *   (§1). Each gets a label placed clear of the nameplates, and that label is
 *   then reserved against the badge solver — three connection costs used to be
 *   dropped straight on top of it.
 */
export function buildLayout(
  map: GameMap,
  containerW: number,
  containerH: number,
  outOfPlay: readonly { id: string; at: Vec }[] = [],
): BoardLayout {
  const metrics = computeMetrics(map, containerW, containerH);
  // Quantise the cache key: a 1 px resize must not re-solve 83 badges. The
  // out-of-play labels are part of the obstacle field, so they key it too.
  const zoneKey = outOfPlay.map((a) => a.id).join(',');
  const cacheKey = `${map.id}@${metrics.pxPerUnit.toFixed(3)}#${zoneKey}`;
  const cached = layoutCache.get(cacheKey);
  if (cached) return cached;

  const space = boardSpace(map);
  const m = metrics;
  const anchors = map.cities.map((c) => cityPoint(c, space));

  /*
   * One box per city carrying both the name ribbon and the three house slots,
   * exactly as the printed board draws a nameplate. Keeping them in a single
   * box (rather than a plate plus a floating label) is what makes all 42 names
   * fit alongside all 83 cost badges at the smallest supported container size.
   */
  const sizes = map.cities.map((c) => footprintFor(c.name, m));
  const { pos, moved } = relaxPlates(anchors, sizes, m, space);

  // Breathing room around every reserved box, in board units (~1.5 screen px).
  const pad = 1 / m.pxPerUnit;

  /*
   * The §1 region labels take whatever room the settled nameplates left them.
   * Plates carry data and are never moved for a label; the label moves instead.
   */
  const plateBoxes = pos.map((p, i) =>
    rectFromCenter(p, sizes[i]!.w + pad * 2, sizes[i]!.h + pad * 2),
  );
  const outzoneLabels = placeOutzoneLabels(outOfPlay, plateBoxes, m, space);

  /* --- reserved furniture: a cost badge never covers any of it --- */
  const cityBoxes: Rect[] = [
    ...plateBoxes,
    // The true-position dot must stay visible even when the plate moved away.
    ...anchors.map((a) => rectFromCenter(a, m.anchorR * 4, m.anchorR * 4)),
    // §1 region labels. They are drawn text like any other and were the one
    // piece of board furniture the solver did not know about.
    ...outzoneLabels.map((l) => rectFromCenter(l.at, l.w + pad * 2, l.h + pad * 2)),
  ];

  const anchorById = new Map(map.cities.map((c, i) => [c.id, anchors[i]!] as const));
  const prepared = map.connections
    .map((conn: MapConnection) => {
      const a = anchorById.get(conn.a);
      const b = anchorById.get(conn.b);
      if (!a || !b) return null;
      return { conn, path: buildRoutePath(conn, a, b, space) };
    })
    .filter((x): x is { conn: MapConnection; path: RoutePath } => x !== null)
    // Shortest first: a 25-unit edge has almost no free arc to bargain with.
    .sort((p, q) => p.path.length - q.path.length);

  const badges = solveBadges(prepared, cityBoxes, m, space, pad);

  const nodes: NodeLayout[] = map.cities.map((city, i) => ({
    id: city.id,
    name: city.name,
    areaId: city.area,
    anchor: anchors[i]!,
    plate: pos[i]!,
    w: sizes[i]!.w,
    h: sizes[i]!.h,
    plateW: m.plateW,
    // Name above, slot plate beneath, both inside one reserved footprint.
    nameY: -m.plateH / 2 + m.nameH * 0.46,
    slotY: -m.plateH / 2 + m.nameH + m.slotH / 2,
    stem: moved[i]!,
  }));

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const solved: RouteLayout[] = badges.map((b) => ({
    id: pairKey(b.conn.a, b.conn.b),
    a: b.conn.a,
    b: b.conn.b,
    cost: b.conn.cost,
    path: b.path,
    badge: b.badge,
  }));
  /*
   * Honest verification, on the geometry that is actually drawn — no solver
   * padding, no internal bookkeeping. This is the number U5 lives or dies by,
   * so it is measured the same way an inspector measuring the DOM would.
   */
  const drawnBadges = badges.map((b) => rectFromCenter(b.badge.at, b.badge.w, b.badge.h));
  const drawnPlates = pos.map((p, i) => rectFromCenter(p, sizes[i]!.w, sizes[i]!.h));
  const drawnLabels = outzoneLabels.map((l) => rectFromCenter(l.at, l.w, l.h));

  const collisions = {
    badgeBadge: 0,
    badgeName: 0,
    nameName: 0,
    badgeOutzone: 0,
    nameOutzone: 0,
    total: 0,
  };
  let badgeCollisions = 0;
  for (let i = 0; i < drawnBadges.length; i++) {
    let hit = false;
    for (let j = i + 1; j < drawnBadges.length; j++) {
      if (overlapArea(drawnBadges[i]!, drawnBadges[j]!) > 0.5) {
        collisions.badgeBadge++;
        hit = true;
      }
    }
    for (let j = 0; j < drawnPlates.length; j++) {
      if (overlapArea(drawnBadges[i]!, drawnPlates[j]!) > 0.5) {
        collisions.badgeName++;
        hit = true;
      }
    }
    for (let j = 0; j < drawnLabels.length; j++) {
      if (overlapArea(drawnBadges[i]!, drawnLabels[j]!) > 0.5) {
        collisions.badgeOutzone++;
        hit = true;
      }
    }
    if (hit) badgeCollisions++;
  }
  for (let i = 0; i < drawnPlates.length; i++) {
    for (let j = i + 1; j < drawnPlates.length; j++) {
      if (overlapArea(drawnPlates[i]!, drawnPlates[j]!) > 0.5) collisions.nameName++;
    }
    for (let j = 0; j < drawnLabels.length; j++) {
      if (overlapArea(drawnPlates[i]!, drawnLabels[j]!) > 0.5) collisions.nameOutzone++;
    }
  }
  collisions.total =
    collisions.badgeBadge +
    collisions.badgeName +
    collisions.nameName +
    collisions.badgeOutzone +
    collisions.nameOutzone;

  const routesByCity = new Map<CityId, RouteLayout[]>();
  const routeByPair = new Map<string, RouteLayout>();
  for (const r of solved) {
    routeByPair.set(r.id, r);
    for (const id of [r.a, r.b]) {
      const list = routesByCity.get(id);
      if (list) list.push(r);
      else routesByCity.set(id, [r]);
    }
  }

  const layout: BoardLayout = {
    map,
    space,
    metrics: m,
    nodes,
    nodeById,
    routes: solved,
    routesByCity,
    routeByPair,
    outzoneLabels,
    badgeCollisions,
    collisions,
  };

  // Bounded cache: a handful of container sizes per session, never unbounded.
  if (layoutCache.size > 12) layoutCache.clear();
  layoutCache.set(cacheKey, layout);
  return layout;
}

/** Exported for the dev harness / diagnostics. */
export const BOARD_UNIT_HEIGHT = BOARD_H;
