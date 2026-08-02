/**
 * The three static board layers: painted regions, routes, and cost badges.
 *
 * All three are `memo`ised and depend only on the layout plus the playing zone,
 * so hovering a city, previewing a route or panning the board never re-renders
 * them — React does nothing at all during a drag, and the browser only has to
 * re-composite one transform.
 */

import { memo } from 'react';

import type { BoardLayout } from './layout';
import type { BoardModel } from './selectors';
import { DEF } from './Defs';
import type { BoardTheme } from './theme';

/* ------------------------------------------------------------------ *
 * Regions
 * ------------------------------------------------------------------ */

interface RegionProps {
  layout: BoardLayout;
  model: BoardModel;
  theme: BoardTheme;
  terrain: string | null;
  hasGrain: boolean;
}

function RegionLayerImpl({ layout, model, theme, terrain, hasGrain }: RegionProps): JSX.Element {
  const { space, outlines, map, metrics } = layout;
  const ink = metrics.routeW * 0.62;

  return (
    <g className="pgb-regions">
      {/* Sea floor, so there is never a frame of empty white. */}
      <rect x={0} y={0} width={space.width} height={space.height} fill="#0a141e" />

      {terrain ? (
        <image
          href={terrain}
          x={0}
          y={0}
          width={space.width}
          height={space.height}
          preserveAspectRatio="none"
        />
      ) : null}

      {hasGrain ? (
        <rect
          x={0}
          y={0}
          width={space.width}
          height={space.height}
          fill={`url(#${DEF.grain})`}
          opacity={0.7}
          style={{ mixBlendMode: 'overlay' }}
        />
      ) : null}

      {/* Painted seams: a heavy ink line with a lighter inner rim. */}
      {outlines.map((o) =>
        o.d ? (
          <path
            key={`ink-${o.areaId}`}
            d={o.d}
            fill="none"
            stroke="#050a0f"
            strokeOpacity={0.62}
            strokeWidth={ink * 2.1}
            strokeLinejoin="round"
          />
        ) : null,
      )}
      {outlines.map((o) => {
        const area = map.areas.find((a) => a.id === o.areaId);
        return o.d ? (
          <path
            key={`rim-${o.areaId}`}
            d={o.d}
            fill="none"
            stroke={area?.color ?? theme.line}
            strokeOpacity={0.5}
            strokeWidth={ink * 0.75}
            strokeLinejoin="round"
          />
        ) : null;
      })}

      {/*
        §1: areas outside the playing zone are unusable for the entire game, so
        they are drained of colour, dimmed, hatched and dashed off. There is no
        way to mistake them for live territory.
      */}
      <g className="pgb-outzone" pointerEvents="none">
        {outlines
          .filter((o) => !model.zone.has(o.areaId))
          .map((o) => (
            <g key={o.areaId}>
              <path d={o.d} fill="#8d9aab" style={{ mixBlendMode: 'saturation' }} />
              <path d={o.d} fill={theme.void} opacity={0.66} />
              <path d={o.d} fill={`url(#${DEF.hatch})`} opacity={0.34} />
              <path
                d={o.d}
                fill="none"
                stroke={theme.textFaint}
                strokeOpacity={0.55}
                strokeWidth={ink * 1.1}
                strokeDasharray={`${ink * 5} ${ink * 3.4}`}
                strokeLinejoin="round"
              />
              <text
                className="pgb-outzone-label"
                x={o.centroid.x}
                y={o.centroid.y}
                fontSize={metrics.nameFont * 0.95}
                textAnchor="middle"
                dominantBaseline="central"
                fill={theme.textFaint}
                stroke={theme.void}
                strokeWidth={metrics.nameFont * 0.4}
                strokeOpacity={0.8}
                style={{ paintOrder: 'stroke' }}
              >
                OUT OF PLAY
              </text>
            </g>
          ))}
      </g>
    </g>
  );
}

export const RegionLayer = memo(RegionLayerImpl);

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

interface RouteProps {
  layout: BoardLayout;
  model: BoardModel;
}

function RouteLayerImpl({ layout, model }: RouteProps): JSX.Element {
  const w = layout.metrics.routeW;
  const routes = layout.routes;
  const alive = (id: string): boolean => model.liveRoutes.has(id);

  return (
    <g className="pgb-routes" pointerEvents="none">
      {/* Casing — reads as the shadow the route casts on the terrain. */}
      {routes.map((r) => (
        <path
          key={`c-${r.id}`}
          d={r.path.d}
          fill="none"
          stroke="#04070b"
          strokeOpacity={alive(r.id) ? 0.82 : 0.3}
          strokeWidth={w * 2.15}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Body — warm bone, the highest-contrast neutral over painted terrain. */}
      {routes.map((r) => (
        <path
          key={`b-${r.id}`}
          d={r.path.d}
          fill="none"
          stroke={alive(r.id) ? '#dccbaa' : '#5c6675'}
          strokeOpacity={alive(r.id) ? 0.94 : 0.3}
          strokeWidth={w}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Sleepers — dark ticks that make a route read as built infrastructure. */}
      {routes.map((r) => (
        <path
          key={`t-${r.id}`}
          d={r.path.d}
          fill="none"
          stroke="#2b2418"
          strokeOpacity={alive(r.id) ? 0.44 : 0.14}
          strokeWidth={w * 0.94}
          strokeDasharray={`${(w * 0.44).toFixed(2)} ${(w * 2.35).toFixed(2)}`}
          strokeLinecap="butt"
        />
      ))}
    </g>
  );
}

export const RouteLayer = memo(RouteLayerImpl);

/* ------------------------------------------------------------------ *
 * Cost badges — QUALITY-BAR U5
 * ------------------------------------------------------------------ */

interface BadgeProps {
  layout: BoardLayout;
  model: BoardModel;
  theme: BoardTheme;
  /** Route ids on the currently previewed cheapest path. */
  highlighted: ReadonlySet<string>;
}

function BadgeLayerImpl({ layout, model, theme, highlighted }: BadgeProps): JSX.Element {
  const m = layout.metrics;

  return (
    <g className="pgb-badges" pointerEvents="none">
      {layout.routes.map((r) => {
        const b = r.badge;
        const live = model.liveRoutes.has(r.id);
        const hot = highlighted.has(r.id);
        const rx = b.h * 0.34;
        const x = b.at.x - b.w / 2;
        const y = b.at.y - b.h / 2;

        return (
          <g key={r.id} opacity={live ? 1 : 0.34}>
            {/* Leader line back to the route this badge belongs to. */}
            {b.leader ? (
              <>
                <line
                  x1={b.anchor.x}
                  y1={b.anchor.y}
                  x2={b.at.x}
                  y2={b.at.y}
                  stroke={theme.void}
                  strokeOpacity={0.75}
                  strokeWidth={m.routeW * 0.5}
                />
                <line
                  x1={b.anchor.x}
                  y1={b.anchor.y}
                  x2={b.at.x}
                  y2={b.at.y}
                  stroke={hot ? theme.cyan : theme.elektroDim}
                  strokeOpacity={0.9}
                  strokeWidth={m.routeW * 0.24}
                  strokeDasharray={`${m.routeW * 0.9} ${m.routeW * 0.7}`}
                />
                <circle
                  cx={b.anchor.x}
                  cy={b.anchor.y}
                  r={m.routeW * 0.44}
                  fill={hot ? theme.cyan : theme.elektro}
                  opacity={0.9}
                />
              </>
            ) : null}

            <rect
              x={x}
              y={y + b.h * 0.14}
              width={b.w}
              height={b.h}
              rx={rx}
              fill="#04070a"
              opacity={0.72}
            />
            <rect
              className="pgb-badge-plate"
              x={x}
              y={y}
              width={b.w}
              height={b.h}
              rx={rx}
              fill={`url(#${hot ? DEF.badgeHot : DEF.badge})`}
              stroke={hot ? theme.cyanBright : '#3d4a5b'}
              strokeOpacity={hot ? 1 : 0.85}
              strokeWidth={b.h * (hot ? 0.1 : 0.07)}
            />
            <path
              d={`M${x + rx} ${y + b.h * 0.07}H${x + b.w - rx}`}
              stroke="#ffffff"
              strokeOpacity={0.14}
              strokeWidth={b.h * 0.06}
              strokeLinecap="round"
            />
            <text
              className="pgb-badge-text"
              x={b.at.x}
              y={b.at.y}
              fontSize={m.badgeFont}
              textAnchor="middle"
              dominantBaseline="central"
              fill={hot ? theme.cyanBright : theme.elektro}
            >
              {r.cost}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export const BadgeLayer = memo(BadgeLayerImpl);
