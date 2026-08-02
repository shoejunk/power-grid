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
import { areaOutlines, type AreaOutline } from './terrain';

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
  /** Screen-pixel size of connection-cost type; floored for legibility. */
  badgeFontPx: number;
}

const MIN_BADGE_FONT_PX = 10.5;

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

  const pipRpx = clamp(medianNNpx * 0.105, 4.6, 8.4);
  const pipPitchPx = pipRpx * 2 + 1.7;
  const slotHpx = pipRpx * 2 + 3.4;
  const nameFontPx = clamp(medianNNpx * 0.145, 8.2, 13);
  const nameHpx = nameFontPx * 1.34;
  const badgeHpx = clamp(medianNNpx * 0.32, 13.6, 21);
  const badgeFontPx = Math.max(MIN_BADGE_FONT_PX, badgeHpx * 0.7);

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
    badgeFontPx,
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
  outlines: AreaOutline[];
  /** Number of badges that could not find a fully clear slot. */
  badgeCollisions: number;
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
      const hp = home[i]!;
      p.x += (hp.x - p.x) * homePull;
      p.y += (hp.y - p.y) * homePull;
      // Tether to the route, and stay on the board.
      const dx = p.x - hp.x;
      const dy = p.y - hp.y;
      const d = Math.hypot(dx, dy);
      if (d > tether) {
        p.x = hp.x + (dx / d) * tether;
        p.y = hp.y + (dy / d) * tether;
      }
      p.x = clamp(p.x, w[i]! / 2, space.width - w[i]! / 2);
      p.y = clamp(p.y, h / 2, space.height - h / 2);
    }
  }

  /* --- report and finish --- */
  const out: SolvedBadge[] = [];
  for (let i = 0; i < n; i++) {
    const { conn, path } = prepared[i]!;
    const ri = rectOf(i);
    let residual = obstacles.overlap(ri);
    for (let j = 0; j < n; j++) {
      if (j !== i) residual += overlapArea(ri, rectOf(j));
    }
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

export function buildLayout(map: GameMap, containerW: number, containerH: number): BoardLayout {
  const metrics = computeMetrics(map, containerW, containerH);
  // Quantise the cache key: a 1 px resize must not re-solve 83 badges.
  const cacheKey = `${map.id}@${metrics.pxPerUnit.toFixed(3)}`;
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

  /* --- nameplates own their space outright: a cost badge never covers one --- */
  const cityBoxes: Rect[] = [
    ...pos.map((p, i) => rectFromCenter(p, sizes[i]!.w + pad * 2, sizes[i]!.h + pad * 2)),
    // The true-position dot must stay visible even when the plate moved away.
    ...anchors.map((a) => rectFromCenter(a, m.anchorR * 4, m.anchorR * 4)),
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
  const badgeCollisions = badges.filter((b) => b.badge.residual > 0.5).length;

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
    outlines: areaOutlines(map),
    badgeCollisions,
  };

  // Bounded cache: a handful of container sizes per session, never unbounded.
  if (layoutCache.size > 12) layoutCache.clear();
  layoutCache.set(cacheKey, layout);
  return layout;
}

/** Exported for the dev harness / diagnostics. */
export const BOARD_UNIT_HEIGHT = BOARD_H;
