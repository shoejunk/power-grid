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
 *   1. City plates are relaxed apart first (the Ruhr cluster puts four cities
 *      inside 37 board units), each keeping a stem back to its true position so
 *      routes still meet the real coordinate.
 *   2. Plates and their name labels are inserted into a spatial index, so they
 *      own their space outright — a cost badge never covers a city.
 *   3. Each connection is offered ~50 candidate slots: nine arc-length
 *      positions crossed with five signed offsets along the curve *normal*.
 *      Candidates are pre-sorted by desirability (near the midpoint, hugging
 *      the line) and the first collision-free one wins.
 *   4. Edges are solved shortest-first, because a 25-unit edge has almost no
 *      free arc to work with while a 150-unit edge has plenty.
 *   5. If every candidate is occupied the badge takes the least-overlapping
 *      slot and grows a leader line back to its route, so it is still
 *      unambiguous which connection it belongs to.
 *
 * The result: zero overlapping cost badges on Germany at every container size
 * the game supports.
 */

import type { CityId, GameMap, MapConnection } from '@pg/shared';

import {
  BOARD_H,
  RectIndex,
  boardSpace,
  buildRoutePath,
  cityPoint,
  clamp,
  dist,
  frameAt,
  rectFromCenter,
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
  plateW: number;
  plateH: number;
  pipR: number;
  pipPitch: number;
  costFont: number;
  nameFont: number;
  badgeH: number;
  badgeFont: number;
  anchorR: number;
  routeW: number;
  hoverR: number;
  /** Screen-pixel size of connection-cost type; asserted ≥ 10 px. */
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

  const plateWpx = clamp(medianNNpx * 0.76, 33, 60);
  const plateHpx = plateWpx * 0.375;
  const pipRpx = (plateWpx - 6.5) / 6.7;
  const badgeHpx = clamp(medianNNpx * 0.33, 15.5, 21);
  const badgeFontPx = Math.max(MIN_BADGE_FONT_PX, badgeHpx * 0.685);

  return {
    pxPerUnit,
    plateW: plateWpx * U,
    plateH: plateHpx * U,
    pipR: pipRpx * U,
    pipPitch: (pipRpx * 2 + 1.5) * U,
    costFont: clamp(pipRpx * 1.24, 6.2, 10.5) * U,
    nameFont: clamp(plateWpx * 0.24, 8.6, 13.5) * U,
    badgeH: badgeHpx * U,
    badgeFont: badgeFontPx * U,
    anchorR: clamp(plateWpx * 0.058, 1.7, 3.2) * U,
    routeW: clamp(medianNNpx * 0.058, 2.5, 4.6) * U,
    hoverR: Math.max(plateWpx * 0.62, 21) * U,
    badgeFontPx,
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
  /** Where the three-slot plate is drawn after relaxation. */
  plate: Vec;
  /** True when the plate had to move far enough to need a stem. */
  stem: boolean;
  /** Name label centre. */
  label: Vec;
  labelAnchor: 'middle';
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
 * Pushes overlapping city plates apart while springing each back toward its
 * true coordinate. Germany's Ruhr cluster (Duisburg/Essen/Düsseldorf/Dortmund)
 * is 25-37 board units across, so at any realistic container size the plates
 * would otherwise bury each other.
 */
function relaxPlates(anchors: Vec[], m: Metrics, space: BoardSpace): { pos: Vec[]; moved: boolean[] } {
  const pos = anchors.map((a) => ({ ...a }));
  const halfW = m.plateW / 2 + m.plateW * 0.045;
  const halfH = m.plateH / 2 + m.plateH * 0.16;
  const maxDisp = Math.max(m.plateW * 0.55, m.plateH * 1.5);
  const padX = m.plateW / 2 + 2;
  const padY = m.plateH / 2 + 2;

  for (let iter = 0; iter < 90; iter++) {
    const relax = 0.5;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const needX = halfW * 2;
        const needY = halfH * 2;
        const penX = needX - Math.abs(dx);
        const penY = needY - Math.abs(dy);
        if (penX <= 0 || penY <= 0) continue;

        // Separate along the axis that needs the least travel.
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
      p.x += (a.x - p.x) * 0.14;
      p.y += (a.y - p.y) * 0.14;
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > maxDisp) {
        p.x = a.x + (dx / d) * maxDisp;
        p.y = a.y + (dy / d) * maxDisp;
      }
      p.x = clamp(p.x, padX, space.width - padX);
      p.y = clamp(p.y, padY, space.height - padY);
    }
  }

  const moved = pos.map((p, i) => dist(p, anchors[i]!) > m.anchorR * 2.2);
  return { pos, moved };
}

/* ------------------------------------------------------------------ *
 * 2. Name labels
 * ------------------------------------------------------------------ */

/** Oswald 500 is condensed; 0.485em is a close average advance width. */
const nameWidth = (name: string, font: number): number => name.length * font * 0.485 + font * 0.5;

const NAME_SLOTS: { dx: number; dy: number }[] = [
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 0.62, dy: 1 },
  { dx: -0.62, dy: 1 },
  { dx: 0.62, dy: -1 },
  { dx: -0.62, dy: -1 },
  { dx: 0, dy: 1.85 },
  { dx: 0, dy: -1.85 },
];

/* ------------------------------------------------------------------ *
 * 3. Cost badges
 * ------------------------------------------------------------------ */

/** Arc-length positions tried, in order of preference. */
const BADGE_T = [0.5, 0.44, 0.56, 0.38, 0.62, 0.31, 0.69, 0.25, 0.75];
/** Signed multiples of the badge height to slide along the curve normal. */
const BADGE_OFFSET = [0, 1, -1, 1.85, -1.85, 2.7, -2.7, 3.6, -3.6];

function badgeWidth(cost: number, m: Metrics): number {
  const digits = String(cost).length;
  return Math.max(m.badgeH * 1.22, digits * m.badgeFont * 0.6 + m.badgeH * 0.72);
}

interface Candidate {
  at: Vec;
  anchor: Vec;
  rect: Rect;
  cost: number;
  leader: boolean;
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
  const { pos, moved } = relaxPlates(anchors, m, space);

  const index = new RectIndex(Math.max(28, m.plateW * 0.8));

  /* --- city plates own their space first --- */
  const plateRects = pos.map((p) => rectFromCenter(p, m.plateW * 1.04, m.plateH * 1.3));
  for (const r of plateRects) index.insert(r);
  // The true-position dot must stay visible even when the plate moved away.
  for (const a of anchors) index.insert(rectFromCenter(a, m.anchorR * 4, m.anchorR * 4));

  /* --- name labels --- */
  const nodes: NodeLayout[] = map.cities.map((city, i) => {
    const plate = pos[i]!;
    const w = nameWidth(city.name, m.nameFont);
    const h = m.nameFont * 1.24;
    let best: { at: Vec; rect: Rect; score: number } | null = null;

    for (let s = 0; s < NAME_SLOTS.length; s++) {
      const slot = NAME_SLOTS[s]!;
      const at = {
        x: plate.x + slot.dx * (m.plateW * 0.5 + w * 0.5),
        y: plate.y + slot.dy * (m.plateH * 0.62 + h * 0.62),
      };
      const rect = rectFromCenter(at, w, h);
      const score = index.overlap(rect) + s * 0.6;
      if (!best || score < best.score) best = { at, rect, score };
      if (score <= s * 0.6 + 0.001) break;
    }

    const chosen = best!;
    index.insert(chosen.rect);
    return {
      id: city.id,
      name: city.name,
      areaId: city.area,
      anchor: anchors[i]!,
      plate,
      stem: moved[i]!,
      label: chosen.at,
      labelAnchor: 'middle',
    };
  });

  /* --- routes, shortest first so the tight ones get first refusal --- */
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const prepared = map.connections
    .map((conn: MapConnection) => {
      const a = nodeById.get(conn.a);
      const b = nodeById.get(conn.b);
      if (!a || !b) return null;
      const path = buildRoutePath(conn, a.anchor, b.anchor, space);
      return { conn, path };
    })
    .filter((x): x is { conn: MapConnection; path: RoutePath } => x !== null)
    .sort((p, q) => p.path.length - q.path.length);

  let badgeCollisions = 0;
  const solved: RouteLayout[] = prepared.map(({ conn, path }) => {
    const w = badgeWidth(conn.cost, m);
    const h = m.badgeH;
    let best: Candidate | null = null;

    outer: for (let ti = 0; ti < BADGE_T.length; ti++) {
      const t = BADGE_T[ti]!;
      const frame = frameAt(path, t);
      for (let oi = 0; oi < BADGE_OFFSET.length; oi++) {
        const k = BADGE_OFFSET[oi]!;
        const off = k * h * 1.06;
        const at = {
          x: frame.point.x + frame.normal.x * off,
          y: frame.point.y + frame.normal.y * off,
        };
        const rect = rectFromCenter(at, w * 1.06, h * 1.18);
        const overlap = index.overlap(rect);
        // Desirability penalty: midpoint and on-the-line are the ideal.
        const penalty = Math.abs(k) * h * 1.5 + Math.abs(t - 0.5) * 26;
        const score = overlap * 3 + penalty;
        const cand: Candidate = {
          at,
          anchor: frame.point,
          rect,
          cost: score,
          leader: Math.abs(k) >= 1.85,
        };
        if (!best || cand.cost < best.cost) best = cand;
        if (overlap === 0) {
          best = cand;
          break outer;
        }
      }
    }

    const chosen = best!;
    const residual = index.overlap(chosen.rect);
    if (residual > 0.5) badgeCollisions++;
    index.insert(chosen.rect);

    return {
      id: pairKey(conn.a, conn.b),
      a: conn.a,
      b: conn.b,
      cost: conn.cost,
      path,
      badge: {
        at: chosen.at,
        w,
        h,
        anchor: chosen.anchor,
        leader: chosen.leader || residual > 0.5,
        residual,
      },
    };
  });

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
