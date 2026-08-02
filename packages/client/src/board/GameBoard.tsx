/**
 * The Power Grid game board.
 *
 * Mount contract (see `screens/GameScreen.tsx`): fills 100% of its grid cell,
 * introduces no scroll container, reads state through `useGameStore` and sends
 * through `net.action`. It never mutates state and never re-implements a rule —
 * every interactive decision comes from `legalActions()` in `@pg/shared`.
 *
 * Composition, bottom to top:
 *
 *   painted terrain raster  →  region ink + out-of-play scrim (§1)
 *   →  83 curved routes     →  collision-solved cost badges (U5)
 *   →  route preview trace  →  42 city nodes with three slots each (§8, §10)
 *   →  transparent hit layer →  DOM tooltip + view controls
 *
 * Everything below the hit layer is memoised on the layout, so hovering,
 * previewing and panning never re-render the board — a drag is one SVG
 * attribute write per frame.
 */

import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { loadArtManifest } from '@/art';
import { net, useGameStore } from '@/net';
import { SLOTS_OPEN_AT_STEP, getMap, type CityId } from '@pg/shared';

import { BoardDefs, DEF } from './Defs';
import { CityNode, type NodeState } from './CityNode';
import { BadgeLayer, RegionLayer, RouteLayer } from './layers';
import { buildLayout, type BoardLayout } from './layout';
import { buildModel, winningRouteEdges } from './selectors';
import { boardTheme } from './theme';
import { paintTerrain } from './terrain';
import { usePrefersReducedMotion, useViewport } from './useBoardMotion';
import './board.scss';

interface Box {
  w: number;
  h: number;
}

interface Fit {
  scale: number;
  ox: number;
  oy: number;
}

export function GameBoard(): JSX.Element {
  const gameState = useGameStore((s) => s.gameState);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const reduced = usePrefersReducedMotion();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });

  /* --- container measurement ------------------------------------- */
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const read = (): void => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev
          : { w: r.width, h: r.height },
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const map = useMemo(
    () => (gameState ? getMap(gameState.settings.mapId) : null),
    [gameState],
  );

  const theme = useMemo(() => boardTheme(), []);

  /*
   * The layout solver measures real glyph widths to reserve space for city
   * names, so it must not run against a fallback face — that would place every
   * label against the wrong metrics and then reflow when Oswald arrives (V8).
   */
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === 'undefined' || !('fonts' in document),
  );
  useEffect(() => {
    if (fontsReady) return;
    let live = true;
    void document.fonts.load('500 100px Oswald').finally(() => {
      if (live) setFontsReady(true);
    });
    return () => {
      live = false;
    };
  }, [fontsReady]);

  const layout = useMemo<BoardLayout | null>(() => {
    if (!map || !fontsReady || box.w < 40 || box.h < 40) return null;
    return buildLayout(map, box.w, box.h);
  }, [map, fontsReady, box.w, box.h]);

  const model = useMemo(
    () => (gameState && map ? buildModel(gameState, map, myPlayerId) : null),
    [gameState, map, myPlayerId],
  );

  /* --- art assets: painted raster + grain ------------------------- */
  const [terrain, setTerrain] = useState<string | null>(null);
  const [grain, setGrain] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadArtManifest()
      .then((art) => {
        if (live) setGrain(art.paperGrain);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    let live = true;
    setTerrain(null);
    // Off the first paint: the raster costs ~150 ms and must not block mount.
    const id = window.setTimeout(() => {
      const url = paintTerrain(map);
      if (live) setTerrain(url);
    }, 16);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [map]);

  /* --- viewport --------------------------------------------------- */
  const space = layout?.space ?? { width: 780, height: 1000 };
  const fit = useRef<Fit>({ scale: 1, ox: 0, oy: 0 });
  const [, forceTipTick] = useState(0);

  const onViewChange = useCallback(() => {
    if (hoverRef.current) forceTipTick((n) => (n + 1) % 1024);
  }, []);

  const viewport = useViewport({
    width: space.width,
    height: space.height,
    reduced,
    onChange: onViewChange,
  });

  useLayoutEffect(() => {
    const scale = Math.min(box.w / space.width, box.h / space.height) || 1;
    fit.current = {
      scale,
      ox: (box.w - space.width * scale) / 2,
      oy: (box.h - space.height * scale) / 2,
    };
  }, [box.w, box.h, space.width, space.height]);

  /* --- hover / preview -------------------------------------------- */
  const [hovered, setHovered] = useState<CityId | null>(null);
  const hoverRef = useRef<CityId | null>(null);
  hoverRef.current = hovered;

  const highlighted = useMemo<Set<string>>(() => {
    if (!hovered || !gameState || !map || !myPlayerId || !model) return new Set();
    if (model.mode !== 'building') return new Set();
    if (!model.cities.get(hovered)?.target) return new Set();
    return new Set(winningRouteEdges(gameState, map, myPlayerId, hovered));
  }, [hovered, gameState, map, myPlayerId, model]);

  /* --- entrance settle -------------------------------------------- */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), 700);
    return () => window.clearTimeout(id);
  }, []);

  /* --- pointer: pan, zoom, click ---------------------------------- */
  const drag = useRef<{ active: boolean; moved: number; x: number; y: number }>({
    active: false,
    moved: 0,
    x: 0,
    y: 0,
  });

  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const el = hostRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const f = fit.current;
    return {
      x: (clientX - r.left - f.ox) / f.scale,
      y: (clientY - r.top - f.oy) / f.scale,
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const p = toViewBox(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0016);
      viewport.zoomAt(factor, p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport, toViewBox]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { active: true, moved: 0, x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d.active) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = e.clientX;
      d.y = e.clientY;
      const s = fit.current.scale || 1;
      viewport.panBy(dx / s, dy / s);
      if (d.moved > 6) setHovered(null);
    },
    [viewport],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as Element;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    drag.current.active = false;
  }, []);

  const onCityClick = useCallback(
    (cityId: CityId) => {
      if (drag.current.moved > 6) return;
      if (!model) return;
      if (!model.interactive.has(cityId)) return;
      if (model.mode === 'building') net.action({ type: 'buildCity', cityId });
      else if (model.mode === 'startCity') net.action({ type: 'markStartCity', cityId });
      else if (model.mode === 'trustPlacement') net.action({ type: 'placeTrustHouse', cityId });
    },
    [model],
  );

  /* --- keyboard (U6): pan, zoom, reset ---------------------------- */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 60;
      switch (e.key) {
        case 'ArrowLeft':
          viewport.panBy(step, 0);
          break;
        case 'ArrowRight':
          viewport.panBy(-step, 0);
          break;
        case 'ArrowUp':
          viewport.panBy(0, step);
          break;
        case 'ArrowDown':
          viewport.panBy(0, -step);
          break;
        case '+':
        case '=':
          viewport.zoomAt(1.25, space.width / 2, space.height / 2);
          break;
        case '-':
        case '_':
          viewport.zoomAt(0.8, space.width / 2, space.height / 2);
          break;
        case '0':
          viewport.reset();
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [viewport, space.width, space.height],
  );

  /* --- diagnostics: frame rate + solver residual ------------------- */
  const fpsRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number): void => {
      frames++;
      if (now - last >= 500) {
        const fps = Math.round((frames * 1000) / (now - last));
        frames = 0;
        last = now;
        const w = window as unknown as { __pgBoard?: Record<string, unknown> };
        w.__pgBoard = {
          ...(w.__pgBoard ?? {}),
          fps,
          badgeCollisions: layout?.badgeCollisions ?? null,
          routes: layout?.routes.length ?? 0,
          cities: layout?.nodes.length ?? 0,
          badgeFontPx: layout?.metrics.badgeFontPx ?? null,
        };
        if (fpsRef.current) fpsRef.current.textContent = `${fps}`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  const debug =
    typeof window !== 'undefined' && window.location.search.includes('boarddebug');

  /* --- tooltip anchoring ------------------------------------------ */
  const hoveredNode = hovered && layout ? layout.nodeById.get(hovered) ?? null : null;
  const hoveredView = hovered && model ? model.cities.get(hovered) ?? null : null;

  let tipStyle: React.CSSProperties | undefined;
  let tipSide: 'above' | 'below' = 'above';
  if (hoveredNode) {
    const v = viewport.current.current;
    const f = fit.current;
    const sx = f.ox + (hoveredNode.plate.x * v.k + v.tx) * f.scale;
    const sy = f.oy + (hoveredNode.plate.y * v.k + v.ty) * f.scale;
    tipSide = sy < box.h * 0.42 ? 'below' : 'above';
    tipStyle = {
      left: `${Math.round(Math.min(Math.max(sx, 12), Math.max(box.w - 12, 12)))}px`,
      top: `${Math.round(sy + (tipSide === 'above' ? -1 : 1) * (layout?.metrics.plateH ?? 20) * f.scale * v.k * 0.9)}px`,
    };
  }

  if (!gameState || !map) {
    return <div className="pgb-root pgb-root--empty" ref={hostRef} aria-hidden="true" />;
  }

  const slotsOpen = SLOTS_OPEN_AT_STEP[gameState.step] ?? 1;

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="pgb-root"
        ref={hostRef}
        data-mode={model?.mode ?? 'idle'}
        tabIndex={0}
        role="application"
        aria-label={`${map.name} game board`}
        onKeyDown={onKeyDown}
      >
        {layout && model ? (
          <svg
            ref={svgRef}
            className="pgb-svg"
            viewBox={`0 0 ${space.width} ${space.height}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <BoardDefs theme={theme} metrics={layout.metrics} grain={grain} />

            <motion.g
              ref={viewport.ref}
              initial={reduced ? { opacity: 0 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0.12 : 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <RegionLayer
                layout={layout}
                model={model}
                theme={theme}
                terrain={terrain}
                hasGrain={grain !== null}
              />
              <RouteLayer layout={layout} model={model} />

              {/* Preview trace: the exact edges of the cheapest route (U3). */}
              <g className="pgb-preview" pointerEvents="none">
                {[...highlighted].map((id, i) => {
                  const route = layout.routeByPair.get(id);
                  if (!route) return null;
                  return (
                    <motion.path
                      key={id}
                      d={route.path.d}
                      fill="none"
                      stroke={theme.cyanBright}
                      strokeWidth={layout.metrics.routeW * 1.35}
                      strokeLinecap="round"
                      filter={`url(#${DEF.glowRoute})`}
                      initial={reduced ? { opacity: 0 } : { pathLength: 0, opacity: 0.2 }}
                      animate={reduced ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
                      transition={
                        reduced
                          ? { duration: 0.1 }
                          : { duration: 0.3, delay: i * 0.055, ease: [0.22, 1, 0.36, 1] }
                      }
                    />
                  );
                })}
              </g>

              {/* Hover bloom under the focused city. */}
              {hoveredNode ? (
                <circle
                  cx={hoveredNode.plate.x}
                  cy={hoveredNode.plate.y}
                  r={layout.metrics.plateW * 1.15}
                  fill={`url(#${DEF.hover})`}
                  pointerEvents="none"
                />
              ) : null}

              <g className="pgb-nodes">
                {layout.nodes.map((node) => {
                  const view = model.cities.get(node.id);
                  if (!view) return null;
                  const state: NodeState = !view.inZone
                    ? 'outzone'
                    : model.interactive.has(node.id)
                      ? 'buildable'
                      : view.blockedReason
                        ? 'blocked'
                        : 'live';
                  return (
                    <CityNode
                      key={node.id}
                      node={node}
                      view={view}
                      metrics={layout.metrics}
                      theme={theme}
                      state={state}
                      hovered={hovered === node.id}
                      settled={settled}
                      reduced={reduced}
                    />
                  );
                })}
              </g>

              {/*
                Badges paint above the city layer. The solver already reserved
                every plate and anchor dot, so a badge can never land on one —
                this ordering only decides who wins against a *name* label, and
                the answer is always the cost (U5).
              */}
              <BadgeLayer
                layout={layout}
                model={model}
                theme={theme}
                highlighted={highlighted}
              />

              {/* Hit layer — one transparent target per city, above everything. */}
              <g className="pgb-hits">
                {layout.nodes.map((node) => {
                  const interactive = model.interactive.has(node.id);
                  const view = model.cities.get(node.id);
                  const dead = !view?.inZone;
                  return (
                    <g
                      key={node.id}
                      className="pgb-hit"
                      data-interactive={interactive || undefined}
                      data-dead={dead || undefined}
                      onPointerEnter={() => setHovered(node.id)}
                      onPointerLeave={() => setHovered((h) => (h === node.id ? null : h))}
                      onClick={() => onCityClick(node.id)}
                    >
                      <rect
                        x={node.plate.x - layout.metrics.plateW * 0.6}
                        y={node.plate.y - layout.metrics.plateH * 0.95}
                        width={layout.metrics.plateW * 1.2}
                        height={layout.metrics.plateH * 1.9}
                        fill="transparent"
                      />
                      <circle
                        cx={node.anchor.x}
                        cy={node.anchor.y}
                        r={layout.metrics.anchorR * 3}
                        fill="transparent"
                      />
                    </g>
                  );
                })}
              </g>
            </motion.g>
          </svg>
        ) : null}

        {/* ---------- DOM overlays ---------- */}

        <div className="pgb-legend" aria-hidden="true">
          <span className="pgb-legend__step">Step {gameState.step}</span>
          <span className="pgb-legend__rule">
            {slotsOpen} of 3 house slots open
          </span>
          <span className="pgb-legend__slots">
            {[10, 15, 20].map((cost, i) => (
              <span key={cost} className="pgb-legend__slot" data-open={i < slotsOpen}>
                {cost}
              </span>
            ))}
          </span>
        </div>

        <div className="pgb-controls">
          <button
            type="button"
            className="pgb-btn"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => viewport.zoomAt(1.35, space.width / 2, space.height / 2)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3.4v9.2M3.4 8h9.2" />
            </svg>
          </button>
          <button
            type="button"
            className="pgb-btn"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => viewport.zoomAt(0.74, space.width / 2, space.height / 2)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.4 8h9.2" />
            </svg>
          </button>
          <button
            type="button"
            className="pgb-btn pgb-btn--reset"
            title="Reset view"
            aria-label="Reset view"
            data-active={viewport.zoom > 1.01}
            onClick={() => viewport.reset()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.6 6.4h3.2V3.2M13.4 9.6h-3.2v3.2" />
              <path d="M3.1 9.1a5 5 0 0 0 9 1.6M12.9 6.9a5 5 0 0 0-9-1.6" />
            </svg>
            <span className="pgb-btn__zoom">{viewport.zoom.toFixed(1)}×</span>
          </button>
        </div>

        {debug ? (
          <div className="pgb-debug">
            <span ref={fpsRef}>–</span> fps · badges {layout?.routes.length ?? 0} · unsolved{' '}
            {layout?.badgeCollisions ?? '–'} · cost type{' '}
            {layout?.metrics.badgeFontPx.toFixed(1) ?? '–'} px
          </div>
        ) : (
          <span ref={fpsRef} hidden />
        )}

        <AnimatePresence>
          {hoveredNode && hoveredView ? (
            <motion.div
              className="pgb-tip"
              data-side={tipSide}
              data-tone={
                hoveredView.target && !hoveredView.unaffordable
                  ? 'go'
                  : hoveredView.blockedReason
                    ? 'no'
                    : 'info'
              }
              style={tipStyle}
              initial={{ opacity: 0, y: tipSide === 'above' ? 4 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="pgb-tip__head">
                <span className="pgb-tip__name">{hoveredNode.name}</span>
                <span className="pgb-tip__area">
                  {map.areas.find((a) => a.id === hoveredNode.areaId)?.name ?? ''}
                </span>
              </div>

              {hoveredView.target ? (
                <dl className="pgb-tip__cost">
                  <div>
                    <dt>Cheapest route</dt>
                    <dd className="pg-numeral">{hoveredView.target.routeCost}</dd>
                  </div>
                  <div>
                    <dt>House slot {hoveredView.target.slot + 1}</dt>
                    <dd className="pg-numeral">{hoveredView.target.slotCost}</dd>
                  </div>
                  <div className="pgb-tip__total">
                    <dt>Total</dt>
                    <dd className="pg-numeral">{hoveredView.target.total}</dd>
                  </div>
                </dl>
              ) : null}

              {hoveredView.blockedReason ? (
                <p className="pgb-tip__reason">{hoveredView.blockedReason}</p>
              ) : null}

              {hoveredView.target && !hoveredView.unaffordable ? (
                <p className="pgb-tip__cta">Click to connect</p>
              ) : null}

              <ul className="pgb-tip__slots">
                {hoveredView.slots.map((slot) => (
                  <li
                    key={slot.index}
                    data-open={slot.open}
                    data-taken={slot.occupant !== null}
                    style={
                      slot.occupant
                        ? ({
                            '--pgb-seat': slot.occupant.isTrust
                              ? theme.trust
                              : theme.seat(slot.occupant.color).base,
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    <span className="pgb-tip__slotcost pg-numeral">{slot.cost}</span>
                    <span className="pgb-tip__slotwho">
                      {slot.occupant
                        ? slot.occupant.name
                        : slot.open
                          ? 'open'
                          : `Step ${slot.index + 1}`}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
