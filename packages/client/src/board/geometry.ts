/**
 * Board geometry — pure maths, no DOM, no React.
 *
 * The board lives in a fixed *board-unit* space: a viewBox of
 * `BOARD_H * aspectRatio` x `BOARD_H`. City `x`/`y` from `@pg/shared` are
 * normalised [0,1] and scale straight into it, so the SVG's own
 * `preserveAspectRatio="xMidYMid meet"` does the letterboxing for us at any
 * container size — there is no manual fit code anywhere in the renderer.
 */

import type { GameMap, MapCity, MapConnection } from '@pg/shared';

/** Height of the board-unit coordinate space. Width is `H * aspectRatio`. */
export const BOARD_H = 1000;

export interface Vec {
  x: number;
  y: number;
}

export interface BoardSpace {
  width: number;
  height: number;
}

export const boardSpace = (map: GameMap): BoardSpace => ({
  width: BOARD_H * map.aspectRatio,
  height: BOARD_H,
});

export const cityPoint = (city: MapCity, space: BoardSpace): Vec => ({
  x: city.x * space.width,
  y: city.y * space.height,
});

/* ------------------------------------------------------------------ *
 * Small vector helpers
 * ------------------------------------------------------------------ */

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a: Vec): Vec {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smoothstep, the standard Hermite ramp. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ *
 * Deterministic hashing
 *
 * Route bow direction and terrain noise must be identical on every client and
 * across reloads, so nothing here may touch `Math.random`.
 * ------------------------------------------------------------------ */

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable pseudo-random in [-1, 1] derived from a string key. */
export function hashUnit(s: string): number {
  return (hashString(s) / 0xffffffff) * 2 - 1;
}

/* ------------------------------------------------------------------ *
 * Route curves
 * ------------------------------------------------------------------ */

export interface RoutePath {
  /** Sampled polyline in board units. */
  points: Vec[];
  /** Cumulative arc length at each sample. */
  arc: number[];
  /** Total arc length. */
  length: number;
  /** `d` attribute for an SVG path. */
  d: string;
}

/**
 * Catmull-Rom through the supplied points, converted to cubic Béziers.
 * Used when a connection carries explicit `waypoints`.
 */
function catmullRom(points: Vec[], samplesPerSegment: number): Vec[] {
  if (points.length < 2) return points.slice();
  const pts = points.slice();
  // Duplicate the ends so the spline actually reaches them.
  const p = [pts[0]!, ...pts, pts[pts.length - 1]!];
  const out: Vec[] = [];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2]!;
    const last = i === p.length - 3;
    const steps = samplesPerSegment;
    for (let s = 0; s < steps + (last ? 1 : 0); s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

/** Quadratic Bézier sample. */
function quad(a: Vec, c: Vec, b: Vec, t: number): Vec {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/**
 * Builds the drawn route between two cities.
 *
 * `waypoints` (normalised, per `MapConnection`) are honoured when present.
 * Otherwise the route bows away from the straight line by a deterministic
 * amount so the board reads as a hand-drawn network of roads rather than a
 * graph of straight segments — and, usefully, so that two routes leaving the
 * same city fan apart instead of overlapping.
 */
export function buildRoutePath(
  conn: MapConnection,
  a: Vec,
  b: Vec,
  space: BoardSpace,
): RoutePath {
  const straight = dist(a, b);
  let pts: Vec[];

  if (conn.waypoints && conn.waypoints.length > 0) {
    const via = conn.waypoints.map((w) => ({ x: w.x * space.width, y: w.y * space.height }));
    pts = catmullRom([a, ...via, b], 14);
  } else {
    const key = conn.a < conn.b ? `${conn.a}~${conn.b}` : `${conn.b}~${conn.a}`;
    // Bow amplitude: proportionally gentler on long routes so nothing loops.
    const bow = hashUnit(key) * Math.min(straight * 0.11, 34) + Math.sign(hashUnit(key)) * 4;
    const dir = norm(sub(b, a));
    const nrm = { x: -dir.y, y: dir.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ctrl = add(mid, scale(nrm, bow));
    const steps = clamp(Math.round(straight / 9), 10, 48);
    pts = [];
    for (let i = 0; i <= steps; i++) pts.push(quad(a, ctrl, b, i / steps));
  }

  const arc: number[] = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const length = arc[arc.length - 1] ?? 0;

  let d = `M${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += `L${pts[i]!.x.toFixed(2)} ${pts[i]!.y.toFixed(2)}`;

  return { points: pts, arc, length, d };
}

export interface FramePoint {
  point: Vec;
  /** Unit tangent. */
  tangent: Vec;
  /** Unit left-hand normal. */
  normal: Vec;
}

/** Point + tangent frame at arc-length fraction `t` along a route. */
export function frameAt(path: RoutePath, t: number): FramePoint {
  const target = clamp(t, 0, 1) * path.length;
  let i = 1;
  while (i < path.arc.length - 1 && path.arc[i]! < target) i++;
  const a = path.points[i - 1]!;
  const b = path.points[i]!;
  const seg = path.arc[i]! - path.arc[i - 1]!;
  const f = seg > 0 ? (target - path.arc[i - 1]!) / seg : 0;
  const point = { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
  const tangent = norm(sub(b, a));
  return { point, tangent, normal: { x: -tangent.y, y: tangent.x } };
}

/* ------------------------------------------------------------------ *
 * Axis-aligned rectangles — the currency of the collision solver
 * ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectFromCenter = (c: Vec, w: number, h: number): Rect => ({
  x: c.x - w / 2,
  y: c.y - h / 2,
  w,
  h,
});

/**
 * Minimal translation that separates `a` from `b`, applied to `a`.
 * Zero when they do not overlap. Always moves along the axis of least
 * penetration, which keeps a relaxation pass from spiralling.
 */
export function separation(a: Rect, b: Rect): Vec {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (ox <= 0) return { x: 0, y: 0 };
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (oy <= 0) return { x: 0, y: 0 };
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  if (ox < oy) return { x: ox * (acx < bcx ? -1 : 1), y: 0 };
  return { x: 0, y: oy * (acy < bcy ? -1 : 1) };
}

/** Closest point on a polyline to `p`, plus the squared distance to it. */
export function closestOnPolyline(points: Vec[], p: Vec): { point: Vec; d2: number } {
  let best = points[0] ?? { x: 0, y: 0 };
  let bestD2 = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    const t = l2 > 0 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2, 0, 1) : 0;
    const qx = a.x + vx * t;
    const qy = a.y + vy * t;
    const d2 = (p.x - qx) ** 2 + (p.y - qy) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { x: qx, y: qy };
    }
  }
  return { point: best, d2: bestD2 };
}

export function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (ox <= 0) return 0;
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (oy <= 0) return 0;
  return ox * oy;
}

/**
 * Uniform-grid spatial index over rectangles.
 *
 * The badge solver asks "does this candidate box hit anything already placed?"
 * a few thousand times per layout; a linear scan over ~200 boxes would be fine
 * but this keeps re-layout on resize comfortably inside one frame.
 */
export class RectIndex {
  private readonly cell: number;
  private readonly buckets = new Map<number, Rect[]>();

  constructor(cell = 48) {
    this.cell = cell;
  }

  private *keys(r: Rect): Generator<number> {
    const x0 = Math.floor(r.x / this.cell);
    const x1 = Math.floor((r.x + r.w) / this.cell);
    const y0 = Math.floor(r.y / this.cell);
    const y1 = Math.floor((r.y + r.h) / this.cell);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) yield y * 73856093 + x;
    }
  }

  insert(r: Rect): void {
    for (const k of this.keys(r)) {
      const bucket = this.buckets.get(k);
      if (bucket) bucket.push(r);
      else this.buckets.set(k, [r]);
    }
  }

  /** Every inserted rectangle that intersects `r`. */
  query(r: Rect): Rect[] {
    const out: Rect[] = [];
    const seen = new Set<Rect>();
    for (const k of this.keys(r)) {
      const bucket = this.buckets.get(k);
      if (!bucket) continue;
      for (const other of bucket) {
        if (seen.has(other)) continue;
        seen.add(other);
        if (overlapArea(r, other) > 0) out.push(other);
      }
    }
    return out;
  }

  /** Total overlap area between `r` and everything already inserted. */
  overlap(r: Rect): number {
    let total = 0;
    const seen = new Set<Rect>();
    for (const k of this.keys(r)) {
      const bucket = this.buckets.get(k);
      if (!bucket) continue;
      for (const other of bucket) {
        if (seen.has(other)) continue;
        seen.add(other);
        total += overlapArea(r, other);
      }
    }
    return total;
  }

  clear(): void {
    this.buckets.clear();
  }
}
