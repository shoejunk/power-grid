/**
 * Shared SVG paint: gradients, filters and patterns.
 *
 * Everything expensive is declared once and referenced by id. There is exactly
 * one real filter on the board — the route-preview glow — and it is applied to
 * a handful of paths at a time. City plates and cost badges fake their
 * elevation with a duplicated offset shape instead, so panning 42 nodes and 83
 * badges never triggers a filter re-rasterisation (QUALITY-BAR M6). An earlier
 * pulsing halo on every legal build target cost ~30 live filters at once and
 * dropped the board off 60 fps; it is now a flat keyline.
 */

import { PLAYER_COLORS } from '@pg/shared';

import type { Metrics } from './layout';
import type { BoardTheme } from './theme';

export const DEF = {
  glowRoute: 'pgb-glow-route',
  grain: 'pgb-grain',
  plate: 'pgb-plate',
  plateLive: 'pgb-plate-live',
  well: 'pgb-well',
  badge: 'pgb-badge',
  badgeHot: 'pgb-badge-hot',
  hover: 'pgb-hover',
  edgeFade: 'pgb-edge-fade',
  house: (c: string): string => `pgb-house-${c}`,
} as const;

interface Props {
  theme: BoardTheme;
  metrics: Metrics;
  /** Tiling grain from the art module, as a data URI. */
  grain: string | null;
}

export function BoardDefs({ theme, metrics, grain }: Props): JSX.Element {
  return (
    <defs>
      {/* Route highlight glow — one element at a time. */}
      <filter id={DEF.glowRoute} x="-45%" y="-45%" width="190%" height="190%">
        <feGaussianBlur stdDeviation={metrics.routeW * 0.9} result="b1" />
        <feGaussianBlur stdDeviation={metrics.routeW * 2.4} result="b2" />
        <feMerge>
          <feMergeNode in="b2" />
          <feMergeNode in="b1" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {grain ? (
        <pattern id={DEF.grain} width={128} height={128} patternUnits="userSpaceOnUse">
          <image href={grain} x={0} y={0} width={128} height={128} preserveAspectRatio="none" />
        </pattern>
      ) : null}

      {/* City plate: brushed metal, lit from above. */}
      <linearGradient id={DEF.plate} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2b3949" />
        <stop offset="42%" stopColor="#1a2532" />
        <stop offset="100%" stopColor="#0e161f" />
      </linearGradient>
      <linearGradient id={DEF.plateLive} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#33475c" />
        <stop offset="42%" stopColor="#1f2e3e" />
        <stop offset="100%" stopColor="#111b26" />
      </linearGradient>

      {/* Empty house slot: a well sunk into the plate. */}
      <radialGradient id={DEF.well} cx="0.5" cy="0.34" r="0.72">
        <stop offset="0%" stopColor="#05090e" />
        <stop offset="62%" stopColor="#0b131c" />
        <stop offset="100%" stopColor="#16212c" />
      </radialGradient>

      {/* Cost badge plate. */}
      <linearGradient id={DEF.badge} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1d2836" />
        <stop offset="55%" stopColor="#121b25" />
        <stop offset="100%" stopColor="#0a1119" />
      </linearGradient>
      <linearGradient id={DEF.badgeHot} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0d4d5d" />
        <stop offset="55%" stopColor="#0a3d4b" />
        <stop offset="100%" stopColor="#06232c" />
      </linearGradient>

      {/*
        Edge fade. The painted plate is a rectangle with its own sea colour, so
        without this it reads as a photograph pasted onto the panel. Four
        gradients dissolve its border into the board surface instead.
      */}
      {(
        [
          ['l', 0, 0, 1, 0],
          ['r', 1, 0, 0, 0],
          ['t', 0, 0, 0, 1],
          ['b', 0, 1, 0, 0],
        ] as const
      ).map(([side, x1, y1, x2, y2]) => (
        <linearGradient
          key={side}
          id={`${DEF.edgeFade}-${side}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
        >
          <stop offset="0%" stopColor={theme.void} stopOpacity={0.95} />
          <stop offset="100%" stopColor={theme.void} stopOpacity={0} />
        </linearGradient>
      ))}

      <radialGradient id={DEF.hover} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stopColor={theme.cyan} stopOpacity={0.42} />
        <stop offset="55%" stopColor={theme.cyan} stopOpacity={0.14} />
        <stop offset="100%" stopColor={theme.cyan} stopOpacity={0} />
      </radialGradient>

      {/* One lit dome per seat colour, so a placed house reads as an object. */}
      {PLAYER_COLORS.map((color) => {
        const seat = theme.seat(color);
        return (
          <radialGradient key={color} id={DEF.house(color)} cx="0.36" cy="0.3" r="0.82">
            <stop offset="0%" stopColor={seat.light} />
            <stop offset="46%" stopColor={seat.base} />
            <stop offset="100%" stopColor={seat.dark} />
          </radialGradient>
        );
      })}

      <radialGradient id={DEF.house('trust')} cx="0.36" cy="0.3" r="0.82">
        <stop offset="0%" stopColor="#c3cddb" />
        <stop offset="46%" stopColor={theme.trust} />
        <stop offset="100%" stopColor="#2b333d" />
      </radialGradient>
    </defs>
  );
}
