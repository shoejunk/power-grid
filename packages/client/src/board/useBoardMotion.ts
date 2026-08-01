/**
 * Board viewport: pan, zoom, clamping and the spring that settles them.
 *
 * The transform is written straight onto the world `<g>` as an SVG `transform`
 * attribute from inside one rAF loop. React is never involved in a drag, so a
 * pan costs exactly one attribute write per frame regardless of how many
 * elements the board contains (QUALITY-BAR M6).
 *
 * `prefers-reduced-motion` collapses the spring to an immediate snap — the
 * board stays fully usable, it just stops gliding (M5).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clamp } from './geometry';

export interface ViewState {
  k: number;
  tx: number;
  ty: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface Options {
  width: number;
  height: number;
  reduced: boolean;
  /** Called whenever the applied transform changes, for tooltip anchoring. */
  onChange?: (view: ViewState) => void;
}

export interface Viewport {
  /** Attach to the world `<g>`. */
  ref: (node: SVGGElement | null) => void;
  /** Live values — read inside event handlers, never during render. */
  current: React.MutableRefObject<ViewState>;
  /** Rounded zoom for UI state; updates at most a few times per gesture. */
  zoom: number;
  panBy: (dxViewBox: number, dyViewBox: number) => void;
  zoomAt: (factor: number, viewBoxX: number, viewBoxY: number) => void;
  reset: () => void;
  /** True while the spring is still travelling. */
  settleNow: () => void;
}

function clampView(v: ViewState, width: number, height: number): ViewState {
  const k = clamp(v.k, MIN_ZOOM, MAX_ZOOM);
  return {
    k,
    tx: clamp(v.tx, width * (1 - k), 0),
    ty: clamp(v.ty, height * (1 - k), 0),
  };
}

export function useViewport({ width, height, reduced, onChange }: Options): Viewport {
  const current = useRef<ViewState>({ k: 1, tx: 0, ty: 0 });
  const target = useRef<ViewState>({ k: 1, tx: 0, ty: 0 });
  const velocity = useRef<ViewState>({ k: 0, tx: 0, ty: 0 });
  const node = useRef<SVGGElement | null>(null);
  const frame = useRef(0);
  const [zoom, setZoom] = useState(1);
  const lastReported = useRef(1);

  const apply = useCallback(() => {
    const g = node.current;
    if (!g) return;
    const v = current.current;
    g.setAttribute(
      'transform',
      `translate(${v.tx.toFixed(3)} ${v.ty.toFixed(3)}) scale(${v.k.toFixed(5)})`,
    );
    onChange?.(v);
  }, [onChange]);

  /* Critically-damped spring, integrated once per frame. */
  const tick = useCallback(() => {
    frame.current = 0;
    const c = current.current;
    const t = target.current;
    const v = velocity.current;

    if (reduced) {
      current.current = { ...t };
      velocity.current = { k: 0, tx: 0, ty: 0 };
      apply();
    } else {
      const stiffness = 260;
      const damping = 30;
      const dt = 1 / 60;
      let moving = false;
      (['k', 'tx', 'ty'] as const).forEach((axis) => {
        const scaleFor = axis === 'k' ? 400 : 1;
        const delta = t[axis] - c[axis];
        const accel = delta * stiffness - v[axis] * damping;
        v[axis] += accel * dt;
        c[axis] += v[axis] * dt;
        if (Math.abs(delta) * scaleFor > 0.05 || Math.abs(v[axis]) * scaleFor > 0.05) moving = true;
      });
      if (!moving) {
        current.current = { ...t };
        velocity.current = { k: 0, tx: 0, ty: 0 };
      }
      apply();
      if (moving) frame.current = requestAnimationFrame(tick);
    }

    const rounded = Math.round(current.current.k * 100) / 100;
    if (Math.abs(rounded - lastReported.current) > 0.01) {
      lastReported.current = rounded;
      setZoom(rounded);
    }
  }, [apply, reduced]);

  const kick = useCallback(() => {
    if (frame.current === 0) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Re-clamp when the board box changes.
  useEffect(() => {
    target.current = clampView(target.current, width, height);
    current.current = clampView(current.current, width, height);
    apply();
  }, [width, height, apply]);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const t = target.current;
      target.current = clampView({ k: t.k, tx: t.tx + dx, ty: t.ty + dy }, width, height);
      // Dragging must feel direct, so pan bypasses the spring entirely.
      current.current = { ...target.current };
      velocity.current = { k: 0, tx: 0, ty: 0 };
      apply();
    },
    [width, height, apply],
  );

  const zoomAt = useCallback(
    (factor: number, vx: number, vy: number) => {
      const t = target.current;
      const k = clamp(t.k * factor, MIN_ZOOM, MAX_ZOOM);
      // Keep the world point under the cursor pinned.
      const wx = (vx - t.tx) / t.k;
      const wy = (vy - t.ty) / t.k;
      target.current = clampView({ k, tx: vx - wx * k, ty: vy - wy * k }, width, height);
      kick();
    },
    [width, height, kick],
  );

  const reset = useCallback(() => {
    target.current = { k: 1, tx: 0, ty: 0 };
    kick();
  }, [kick]);

  const settleNow = useCallback(() => {
    current.current = { ...target.current };
    velocity.current = { k: 0, tx: 0, ty: 0 };
    apply();
  }, [apply]);

  const ref = useCallback(
    (n: SVGGElement | null) => {
      node.current = n;
      if (n) apply();
    },
    [apply],
  );

  return useMemo(
    () => ({ ref, current, zoom, panBy, zoomAt, reset, settleNow }),
    [ref, zoom, panBy, zoomAt, reset, settleNow],
  );
}
