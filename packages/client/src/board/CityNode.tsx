/**
 * A city on the board.
 *
 * The node carries four pieces of information at once, which is the whole
 * information-density argument against the benchmark's phone-sized UI:
 *
 *  · all three house slots and their 10 / 15 / 20 costs (§8),
 *  · which of them are open at the current Step (§10) — closed slots are
 *    visibly shuttered, not merely absent,
 *  · who occupies each slot, by seat colour *and* seat sigil so colour is never
 *    the only identity channel (QUALITY-BAR V3),
 *  · whether the city is a legal build target right now.
 *
 * Where the map puts cities closer together than a plate is wide (Germany's
 * Ruhr), the plate is nudged aside by the layout solver and keeps a stem back
 * to a dot at the true coordinate, which is also where routes meet.
 */

import { motion } from 'framer-motion';
import { memo } from 'react';

import type { Metrics, NodeLayout } from './layout';
import type { CityView } from './selectors';
import { DEF } from './Defs';
import { sigilPath, type BoardTheme } from './theme';

export type NodeState = 'live' | 'buildable' | 'blocked' | 'outzone';

interface Props {
  node: NodeLayout;
  view: CityView;
  metrics: Metrics;
  theme: BoardTheme;
  state: NodeState;
  hovered: boolean;
  /** True once the board's entrance has finished, so houses only pop on real placements. */
  settled: boolean;
  reduced: boolean;
}

function CityNodeImpl({ node, view, metrics, theme, state, hovered, settled, reduced }: Props): JSX.Element {
  const m = metrics;
  const w = m.plateW;
  const h = m.plateH;
  const r = h * 0.42;
  const outzone = state === 'outzone';
  const buildable = state === 'buildable';

  const px = node.plate.x;
  const py = node.plate.y;
  const pipY = 0;
  const pipX = (i: number): number => (i - 1) * m.pipPitch;

  const spring = reduced
    ? { duration: 0.001 }
    : { type: 'spring' as const, stiffness: 380, damping: 26, mass: 0.8 };

  return (
    <g
      className="pgb-node"
      data-state={state}
      data-hovered={hovered || undefined}
      opacity={outzone ? 0.42 : 1}
    >
      {/* Stem back to the real coordinate when the plate had to move. */}
      {node.stem ? (
        <line
          x1={node.anchor.x}
          y1={node.anchor.y}
          x2={px}
          y2={py}
          stroke={theme.void}
          strokeOpacity={0.85}
          strokeWidth={m.anchorR * 1.15}
          strokeLinecap="round"
        />
      ) : null}

      {/* The true map coordinate — routes meet here, not at the plate. */}
      <circle cx={node.anchor.x} cy={node.anchor.y} r={m.anchorR * 1.5} fill={theme.void} opacity={0.8} />
      <circle
        cx={node.anchor.x}
        cy={node.anchor.y}
        r={m.anchorR}
        fill={outzone ? theme.textFaint : theme.elektro}
        opacity={outzone ? 0.5 : 0.95}
      />

      <motion.g
        initial={false}
        animate={{ scale: hovered ? 1.11 : 1 }}
        transition={spring}
        style={{ originX: `${px}px`, originY: `${py}px` }}
        transform={`translate(${px.toFixed(2)} ${py.toFixed(2)})`}
      >
        {/* Buildable halo — a soft cyan bloom under the plate. */}
        {buildable ? (
          <motion.rect
            x={-w / 2 - h * 0.34}
            y={-h / 2 - h * 0.34}
            width={w + h * 0.68}
            height={h + h * 0.68}
            rx={r + h * 0.3}
            fill="none"
            stroke={theme.cyan}
            strokeWidth={h * 0.13}
            filter={`url(#${DEF.glowNode})`}
            initial={false}
            animate={reduced ? { opacity: 0.75 } : { opacity: [0.42, 0.9, 0.42] }}
            transition={reduced ? { duration: 0.001 } : { duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : null}

        {/* Contact shadow — a duplicated shape, not a filter. */}
        <rect
          x={-w / 2}
          y={-h / 2 + h * 0.16}
          width={w}
          height={h}
          rx={r}
          fill={theme.void}
          opacity={0.62}
        />

        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={r}
          fill={`url(#${buildable || hovered ? DEF.plateLive : DEF.plate})`}
          stroke={buildable ? theme.cyan : '#05090e'}
          strokeWidth={buildable ? h * 0.075 : h * 0.06}
        />
        {/* Top bevel — the light edge that gives the plate thickness (V6). */}
        <path
          d={`M${-w / 2 + r} ${-h / 2 + h * 0.055}H${w / 2 - r}`}
          stroke="#ffffff"
          strokeOpacity={0.16}
          strokeWidth={h * 0.055}
          strokeLinecap="round"
          fill="none"
        />

        {view.slots.map((slot) => {
          const cx = pipX(slot.index);
          const pr = m.pipR;
          const occupant = slot.occupant;

          if (occupant) {
            const seat = occupant.isTrust ? null : theme.seat(occupant.color);
            const fill = seat ? `url(#${DEF.house(occupant.color)})` : `url(#${DEF.house('trust')})`;
            const inkColor = seat ? seat.ink : '#0a0e13';
            const sigil = seat ? sigilPath(seat.sigil, pr * 0.5) : null;
            return (
              <g key={slot.index}>
                <circle cx={cx} cy={pipY + pr * 0.2} r={pr} fill={theme.void} opacity={0.7} />
                <motion.g
                  initial={settled && !reduced ? { scale: 1.9, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={
                    reduced
                      ? { duration: 0.12 }
                      : { type: 'spring', stiffness: 520, damping: 17, mass: 0.9 }
                  }
                  style={{ originX: `${cx}px`, originY: `${pipY}px` }}
                >
                  <circle
                    cx={cx}
                    cy={pipY}
                    r={pr}
                    fill={fill}
                    stroke="#04070a"
                    strokeWidth={pr * 0.19}
                  />
                  {sigil ? (
                    <path
                      d={sigil}
                      transform={`translate(${cx} ${pipY})`}
                      fill={inkColor}
                      fillOpacity={0.92}
                    />
                  ) : (
                    <circle cx={cx} cy={pipY} r={pr * 0.34} fill={inkColor} fillOpacity={0.8} />
                  )}
                  {/* Specular pip so the house reads as a solid object. */}
                  <ellipse
                    cx={cx - pr * 0.26}
                    cy={pipY - pr * 0.34}
                    rx={pr * 0.36}
                    ry={pr * 0.24}
                    fill="#ffffff"
                    opacity={0.3}
                  />
                </motion.g>
              </g>
            );
          }

          /* Empty. Open slots invite; Step-locked slots are shuttered (§10). */
          return (
            <g key={slot.index} opacity={slot.open ? 1 : 0.5}>
              <circle
                cx={cx}
                cy={pipY}
                r={pr}
                fill={`url(#${DEF.well})`}
                stroke={slot.open ? theme.line : '#0b1219'}
                strokeOpacity={slot.open ? 0.5 : 1}
                strokeWidth={pr * 0.15}
                strokeDasharray={slot.open ? undefined : `${pr * 0.5} ${pr * 0.34}`}
              />
              <text
                className="pgb-cost"
                x={cx}
                y={pipY}
                fontSize={m.costFont}
                fill={slot.open ? theme.textMuted : theme.textFaint}
                fillOpacity={slot.open ? 1 : 0.7}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {slot.cost}
              </text>
              {!slot.open ? (
                <line
                  x1={cx - pr * 0.78}
                  y1={pipY + pr * 0.78}
                  x2={cx + pr * 0.78}
                  y2={pipY - pr * 0.78}
                  stroke={theme.void}
                  strokeOpacity={0.75}
                  strokeWidth={pr * 0.2}
                  strokeLinecap="round"
                />
              ) : null}
            </g>
          );
        })}
      </motion.g>

      {/* Name — halo stroked *under* the glyphs so it stays legible on any terrain. */}
      <text
        className="pgb-name"
        x={node.label.x}
        y={node.label.y}
        fontSize={m.nameFont}
        textAnchor="middle"
        dominantBaseline="central"
        fill={outzone ? theme.textFaint : hovered || buildable ? theme.cyanBright : theme.text}
        stroke={theme.void}
        strokeWidth={m.nameFont * 0.34}
        strokeOpacity={0.86}
        style={{ paintOrder: 'stroke' }}
      >
        {node.name}
      </text>
    </g>
  );
}

export const CityNode = memo(CityNodeImpl);
