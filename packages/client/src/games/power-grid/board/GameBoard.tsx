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

import { BOARD_BASE_SIZE, loadArtManifest, type ArtManifest } from '@/games/power-grid/art';
import { net, useGameStore } from '@/net';
import { Button, Modal } from '@tt/ui';
import { SLOTS_OPEN_AT_STEP, getMap, type CityId } from '@game/power-grid';

import { usePowerGridState } from '../state';

import { BoardDefs, DEF } from './Defs';
import { CityNode, type NodeState } from './CityNode';
import { BadgeLayer, RegionLayer, RouteLayer } from './layers';
import { buildLayout, type BoardLayout } from './layout';
import { buildModel, winningRouteEdges } from './selectors';
import { regionRasters } from './terrain';
import { boardTheme } from './theme';
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

/*
 * A full-map fit leaves only ~7.5 horizontal pixels per Germany city at the
 * real match-grid size. Solve the board for a larger virtual canvas, then make
 * that detailed view the reset position. Labels retain their legible pixel
 * size while cities and their routes gain 45% more room. The view remains
 * pannable, and Zoom out provides the complete-map overview.
 */
const BOARD_DETAIL_SCALE = 1.45;

/** A map choice that must be explicitly confirmed before it reaches the server. */
type PendingPlacement =
  | { type: 'buildCity'; cityId: CityId }
  | { type: 'markStartCity'; cityId: CityId };

export function GameBoard(): JSX.Element {
  const gameState = usePowerGridState();
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
    /*
     * Belt and braces. ResizeObserver callbacks are delivered as part of the
     * rendering steps, so a window that resizes while the tab is not painting
     * (backgrounded, occluded, offscreen) can deliver nothing at all and leave
     * the board solved for the previous size. `resize` still fires there.
     */
    window.addEventListener('resize', read);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', read);
    };
  }, []);

  const map = useMemo(
    () => (gameState ? getMap(gameState.settings.mapId) : null),
    [gameState],
  );

  /* --- the board asks the match grid for a cell of its own shape ---
   *
   * Germany is portrait (aspect 0.78). Handed a landscape cell, `meet` draws
   * the map into a letterbox and throws away roughly half the pixels it was
   * given — which is exactly the criticism levelled at the benchmark, and it
   * also starves the label solver, because every type size on the board is
   * derived from how many screen pixels one board unit is worth.
   *
   * So the centre column is sized to the map instead. The cell HEIGHT is set
   * by the grid's rows and is independent of the column widths, so writing the
   * width back from the measured height is not circular: it converges on the
   * first pass and then reports the same value forever. The two rails absorb
   * whatever is left as `fr`, so extra monitor width becomes a wider log and
   * wider markets rather than a wider empty margin.
   */
  const aspect = map?.aspectRatio ?? null;
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || aspect === null) return;
    const grid = el.closest<HTMLElement>('.pg-game__grid');
    if (!grid) return;

    // Below the single-column breakpoint the grid stacks and owns its own
    // track sizing; an inline width there would fight the stylesheet.
    if (box.h < 40 || window.innerWidth < 1024) {
      grid.style.removeProperty('--pg-board-w');
      return;
    }

    const cs = getComputedStyle(grid);
    const px = (v: string, fallback: number): number => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const railMin = px(cs.getPropertyValue('--pg-rail-min'), 244);
    const phaseMin = px(cs.getPropertyValue('--pg-phase-min'), 356);
    const gap = px(cs.columnGap, 12);
    const inner =
      grid.clientWidth - px(cs.paddingLeft, 0) - px(cs.paddingRight, 0) - gap * 2;

    // +2 px of slack absorbs sub-pixel rounding so the fit stays height-bound
    // (the map keeps its full height) rather than flipping to width-bound.
    const ideal = box.h * aspect + 2;
    const widest = Math.max(320, inner - railMin - phaseMin);
    const w = Math.round(Math.min(Math.max(ideal, 320), widest));
    grid.style.setProperty('--pg-board-w', `${w}px`);
  }, [aspect, box.h, box.w]);

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

  /*
   * Region tint and out-of-play scrim. Keyed on the zone rather than folded
   * into the layout, because the zone is game state that can change at setup
   * while every position on the board stays exactly where it was.
   */
  const regions = useMemo(
    () => (map && gameState ? regionRasters(map, gameState.zone) : null),
    [map, gameState],
  );

  /*
   * Where the "OUT OF PLAY" labels land (§1). They are handed to the layout
   * solver as reserved boxes: the label is drawn text like a city name, and
   * before this the badge solver treated it as empty canvas and dropped three
   * connection costs straight on top of it.
   */
  const outOfPlay = useMemo(() => {
    if (!map || !gameState || !regions?.hasScrim) return [];
    return map.areas
      .filter((a) => !gameState.zone.includes(a.id))
      .map((a) => ({ id: a.id, at: regions.centroids[a.id] }))
      .filter((a): a is { id: string; at: { x: number; y: number } } => a.at !== undefined);
  }, [map, gameState, regions]);

  const layout = useMemo<BoardLayout | null>(() => {
    if (!map || !fontsReady || box.w < 40 || box.h < 40) return null;
    return buildLayout(map, box.w * BOARD_DETAIL_SCALE, box.h * BOARD_DETAIL_SCALE, outOfPlay);
  }, [map, fontsReady, box.w, box.h, outOfPlay]);

  const model = useMemo(
    () => (gameState && map ? buildModel(gameState, map, myPlayerId) : null),
    [gameState, map, myPlayerId],
  );
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);

  /*
   * The server can advance the match while a confirmation is open. Do not leave
   * a stale decision on screen, and never submit it after its legal window has
   * closed.
   */
  useEffect(() => {
    if (!pendingPlacement || !model) return;
    const expectedMode = pendingPlacement.type === 'buildCity' ? 'building' : 'startCity';
    if (model.mode !== expectedMode || !model.interactive.has(pendingPlacement.cityId)) {
      setPendingPlacement(null);
    }
  }, [model, pendingPlacement]);

  /* --- art assets: the painted plate + grain ----------------------- */
  const [art, setArt] = useState<ArtManifest | null>(null);

  useEffect(() => {
    let live = true;
    loadArtManifest()
      .then((manifest) => {
        if (live) setArt(manifest);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const terrain = art && map ? art.boardBase[map.id] : null;
  const grain = art?.paperGrain ?? null;

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
    defaultZoom: BOARD_DETAIL_SCALE,
    onChange: onViewChange,
  });

  const relativeZoom = viewport.zoom / BOARD_DETAIL_SCALE;

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
    // Capture is an optimisation, not a requirement: it throws if the pointer
    // has already been released, and a drag must never break the board.
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* no capture available — pointermove on the element still works */
    }
  }, []);

  // A city click must not become a board drag. In particular, capturing the
  // pointer on the SVG retargets the subsequent click away from the city's hit
  // layer in some browsers, which made the visible house slots appear inert.
  const onInteractiveCityPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { active: false, moved: 0, x: e.clientX, y: e.clientY };
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
    try {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    drag.current.active = false;
  }, []);

  const onCityClick = useCallback(
    (cityId: CityId) => {
      if (drag.current.moved > 6) return;
      if (!model) return;
      if (!model.interactive.has(cityId)) return;
      if (model.mode === 'building') setPendingPlacement({ type: 'buildCity', cityId });
      else if (model.mode === 'startCity') setPendingPlacement({ type: 'markStartCity', cityId });
      else if (model.mode === 'trustPlacement') net.action({ type: 'placeTrustHouse', cityId });
    },
    [model],
  );

  const confirmPlacement = useCallback(() => {
    if (!pendingPlacement || !model) return;
    const expectedMode = pendingPlacement.type === 'buildCity' ? 'building' : 'startCity';
    if (model.mode !== expectedMode || !model.interactive.has(pendingPlacement.cityId)) {
      setPendingPlacement(null);
      return;
    }

    setPendingPlacement(null);
    net.action(pendingPlacement);
  }, [model, pendingPlacement]);

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

  /* --- diagnostics: frame rate + solver residual -------------------
   *
   * The solver census is published from the layout effect rather than from the
   * frame loop: requestAnimationFrame is throttled to nothing in a background
   * or offscreen tab, and the overlap counts are exactly what an automated
   * check wants to read there.
   */
  const fpsRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const w = window as unknown as { __pgBoard?: Record<string, unknown> };
    w.__pgBoard = {
      ...(w.__pgBoard ?? {}),
      badgeCollisions: layout?.badgeCollisions ?? null,
      collisions: layout?.collisions ?? null,
      routes: layout?.routes.length ?? 0,
      cities: layout?.nodes.length ?? 0,
      cell: { w: box.w, h: box.h },
      badgeFontPx: layout?.metrics.badgeFontPx ?? null,
      nameFontPx: layout?.metrics.nameFontPx ?? null,
      outzoneFontPx: layout?.metrics.outzoneFontPx ?? null,
      medianNNpx: layout?.metrics.medianNNpx ?? null,
    };
  }, [layout, box.w, box.h]);

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
        w.__pgBoard = { ...(w.__pgBoard ?? {}), fps };
        if (fpsRef.current) fpsRef.current.textContent = `${fps}`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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
  const pendingCity = pendingPlacement
    ? map.cities.find((city) => city.id === pendingPlacement.cityId) ?? null
    : null;
  const pendingBuildTarget =
    pendingPlacement?.type === 'buildCity'
      ? model?.cities.get(pendingPlacement.cityId)?.target ?? null
      : null;

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
        {layout && model && regions ? (
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

            {/*
              The board settles in rather than fading up from nothing. Starting
              at zero means any stall in the animation loop — a backgrounded
              tab, a throttled frame budget — leaves the board invisible, and
              the board is the one thing on this screen that must never be
              missing. 0.55 is enough to read as an entrance and always legible.
            */}
            <motion.g
              ref={viewport.ref}
              initial={{ opacity: 0.55 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0.12 : 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <RegionLayer
                layout={layout}
                model={model}
                theme={theme}
                terrain={terrain}
                plateSize={BOARD_BASE_SIZE[map.id]}
                regions={regions}
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
                      plateArt={art?.cityPlate ?? null}
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
                      data-city-id={node.id}
                      data-interactive={interactive || undefined}
                      data-dead={dead || undefined}
                      onPointerEnter={() => setHovered(node.id)}
                      onPointerLeave={() => setHovered((h) => (h === node.id ? null : h))}
                      onPointerDown={interactive ? onInteractiveCityPointerDown : undefined}
                      onClick={() => onCityClick(node.id)}
                    >
                      <rect
                        /*
                         * `node.w` includes the measured city label as well as
                         * the slot plate. Using only the plate width left the
                         * readable ends of long names (for example,
                         * Wilhelmshaven) visibly outside the click target.
                         */
                        x={node.plate.x - node.w / 2}
                        y={node.plate.y - node.h / 2}
                        width={node.w}
                        height={node.h}
                        fill="transparent"
                        pointerEvents="all"
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
            data-active={Math.abs(relativeZoom - 1) > 0.01}
            onClick={() => viewport.reset()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.6 6.4h3.2V3.2M13.4 9.6h-3.2v3.2" />
              <path d="M3.1 9.1a5 5 0 0 0 9 1.6M12.9 6.9a5 5 0 0 0-9-1.6" />
            </svg>
            <span className="pgb-btn__zoom">{relativeZoom.toFixed(1)}×</span>
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

        {pendingPlacement && pendingCity ? (
          <Modal
            open
            onClose={() => setPendingPlacement(null)}
            title={pendingPlacement.type === 'buildCity' ? 'Confirm house placement' : 'Mark starting city'}
            description={
              pendingPlacement.type === 'buildCity'
                ? 'Review the connection cost before placing your house.'
                : 'This adds a neutral marker. Any player may claim it as their first city until it is occupied.'
            }
            footer={
              <>
                <Button variant="ghost" onClick={() => setPendingPlacement(null)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={confirmPlacement}>
                  {pendingPlacement.type === 'buildCity' ? 'Confirm placement' : 'Confirm marker'}
                </Button>
              </>
            }
          >
            <p>
              {pendingPlacement.type === 'buildCity'
                ? `Place your next house in ${pendingCity.name}.`
                : `Mark ${pendingCity.name} as an available starting city.`}
            </p>
            {pendingBuildTarget ? (
              <dl>
                <div>
                  <dt>Cheapest route</dt>
                  <dd className="tt-numeral">{pendingBuildTarget.routeCost} Elektro</dd>
                </div>
                <div>
                  <dt>House slot {pendingBuildTarget.slot + 1}</dt>
                  <dd className="tt-numeral">{pendingBuildTarget.slotCost} Elektro</dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd className="tt-numeral">{pendingBuildTarget.total} Elektro</dd>
                </div>
              </dl>
            ) : null}
          </Modal>
        ) : null}

        <AnimatePresence>
          {/*
            Only opacity is animated here. Giving framer-motion a `y` as well
            would make it write `style.transform`, silently dropping the
            `translate(-50%, -100%)` that flips the tooltip above the city —
            the same attribute-vs-style collision the city nodes hit.
          */}
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
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
                    <dd className="tt-numeral">{hoveredView.target.routeCost}</dd>
                  </div>
                  <div>
                    <dt>House slot {hoveredView.target.slot + 1}</dt>
                    <dd className="tt-numeral">{hoveredView.target.slotCost}</dd>
                  </div>
                  <div className="pgb-tip__total">
                    <dt>Total</dt>
                    <dd className="tt-numeral">{hoveredView.target.total}</dd>
                  </div>
                </dl>
              ) : null}

              {hoveredView.blockedReason ? (
                <p className="pgb-tip__reason">{hoveredView.blockedReason}</p>
              ) : null}

              {hoveredView.target && !hoveredView.unaffordable ? (
                <p className="pgb-tip__cta">Click to review placement</p>
              ) : model?.mode === 'startCity' && model.interactive.has(hoveredNode.id) ? (
                <p className="pgb-tip__cta">Click to mark this starting city</p>
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
                    <span className="pgb-tip__slotcost tt-numeral">{slot.cost}</span>
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
