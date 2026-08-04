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
import type { RegionRaster } from './terrain';
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
  /** Painted plate from the art module — the board's base artwork. */
  terrain: string | null;
  /** Intrinsic size of that plate, so a mismatched aspect covers rather than skews. */
  plateSize: { width: number; height: number } | undefined;
  /** Region tint + out-of-play scrim, rasterised from the map's area field. */
  regions: RegionRaster;
  hasGrain: boolean;
}

function RegionLayerImpl({
  layout,
  model,
  theme,
  terrain,
  plateSize,
  regions,
  hasGrain,
}: RegionProps): JSX.Element {
  const { space, map, metrics } = layout;

  /*
   * The plate is authored to the map's own aspect ratio, so it normally maps
   * 1:1 onto the board box. If a plate is ever swapped in at a different
   * aspect, cover the box rather than stretching the artwork.
   */
  const plateAspect = plateSize ? plateSize.width / plateSize.height : null;
  const boxAspect = space.width / space.height;
  const skewFree =
    plateAspect === null || Math.abs(plateAspect - boxAspect) / boxAspect < 0.01;

  const fadeW = space.width * 0.05;
  const fadeH = space.height * 0.04;

  return (
    <g className="pgb-regions">
      {/* Sea floor, so there is never a frame of empty white. */}
      <rect x={0} y={0} width={space.width} height={space.height} fill="#0a141e" />

      {terrain ? (
        <image
          className="pgb-plate-art"
          href={terrain}
          x={0}
          y={0}
          width={space.width}
          height={space.height}
          preserveAspectRatio={skewFree ? 'none' : 'xMidYMid slice'}
        />
      ) : null}

      {/*
        Region identity (§1, MapArea.color). The plate supplies painted relief
        and brushwork; the hue is washed over it here.

        The raster already carries its own alpha ramp — full chroma along each
        border, decaying to a near-neutral whisper across the interior — so it
        composites normally. It deliberately does NOT use a `color` blend any
        more: that reproduced the area hue at full saturation across the entire
        region, putting a red ground under the red seat's houses and a purple
        ground under purple's, which is a straight QUALITY-BAR V3 failure.
      */}
      <image
        className="pgb-tint"
        href={regions.tint}
        x={0}
        y={0}
        width={space.width}
        height={space.height}
        preserveAspectRatio="none"
      />

      {hasGrain ? (
        <rect
          x={0}
          y={0}
          width={space.width}
          height={space.height}
          fill={`url(#${DEF.grain})`}
          opacity={0.55}
          style={{ mixBlendMode: 'overlay' }}
        />
      ) : null}

      {/* Dissolve the plate's rectangle into the board surface on all four sides. */}
      {(
        [
          ['l', 0, 0, fadeW, space.height],
          ['r', space.width - fadeW, 0, fadeW, space.height],
          ['t', 0, 0, space.width, fadeH],
          ['b', 0, space.height - fadeH, space.width, fadeH],
        ] as const
      ).map(([side, x, y, w, h]) => (
        <rect
          key={side}
          x={x}
          y={y}
          width={w}
          height={h}
          fill={`url(#${DEF.edgeFade}-${side})`}
        />
      ))}

      {/*
        §1: areas outside the playing zone are unusable for the entire game, so
        they are drained of colour, dimmed and hatched. There is no way to
        mistake them for live territory.
      */}
      {regions.hasScrim ? (
        <>
          <image
            className="pgb-outzone"
            href={regions.scrim}
            x={0}
            y={0}
            width={space.width}
            height={space.height}
            preserveAspectRatio="none"
          />
          {map.areas
            .filter((a) => !model.zone.has(a.id))
            .map((a) => {
              const c = regions.centroids[a.id];
              if (!c) return null;
              return (
                <text
                  key={a.id}
                  className="pgb-outzone-label"
                  x={c.x}
                  y={c.y}
                  fontSize={metrics.nameFont * 0.92}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={theme.textFaint}
                  stroke={theme.void}
                  strokeWidth={metrics.nameFont * 0.42}
                  strokeOpacity={0.85}
                  style={{ paintOrder: 'stroke' }}
                >
                  OUT OF PLAY
                </text>
              );
            })}
        </>
      ) : null}
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
