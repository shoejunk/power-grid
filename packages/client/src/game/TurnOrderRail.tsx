import { motion } from 'framer-motion';
import type { Phase } from '@pg/shared';

import { springSnappy, springSoft } from '../styles/motion';
import { Avatar, Badge, Hint, Money, Panel, Tooltip } from '../ui';
import { PHASE_META, STATUS_META } from './format';
import { orderedPlayers, useMatch } from './model';

/** Phases 3 and 4 are resolved in reverse player order. §4. */
const REVERSED: readonly Phase[] = ['resources', 'building'];

/**
 * The player-order track (§4).
 *
 * Shows the computed order for the round and each seat's phase status —
 * eligible, acting, purchased, passed, acted — which §4 explicitly requires the
 * digital player-order state to expose. The list re-sorts itself into the
 * resolution order of the current phase, so "who is next" is never a puzzle.
 */
export function TurnOrderRail(): JSX.Element {
  const { state, meId } = useMatch();
  const phase = state.phase;
  const meta = PHASE_META[phase];
  const reversed = REVERSED.includes(phase);
  const players = orderedPlayers(state).filter((p) => !p.isTrust);
  const sequence = reversed ? players.slice().reverse() : players;

  return (
    <Panel
      padding="tight"
      className="pg-grail"
      title="Turn order"
      subtitle={reversed ? 'This phase runs in reverse' : 'This phase runs in order'}
      actions={
        <Hint
          placement="right"
          title="Player order"
          rule="§4 Player order"
          content="At the start of every round players are ranked by connected cities, highest first, with the highest-numbered owned plant breaking ties. Phase 2 and Phase 5 run in that order; Phases 3 and 4 run in reverse, starting with the last player."
        />
      }
    >
      <div className="pg-grail__list" role="list">
        {sequence.map((player) => {
          const acting = state.activePlayerId === player.id;
          // A stale `acting` marker on a seat the engine is not waiting on
          // would claim two players are up at once.
          const effective =
            !acting && player.phaseStatus === 'acting' ? 'eligible' : player.phaseStatus;
          const status = STATUS_META[effective];
          const acquired = state.acquiredThisRound.includes(player.id);
          const passed = state.passedThisPhase.includes(player.id);
          const label =
            phase === 'auction' && acquired
              ? STATUS_META.purchased
              : phase === 'auction' && passed
                ? STATUS_META.passed
                : status;

          return (
            <motion.div
              key={player.id}
              className="pg-grail__row"
              role="listitem"
              data-player-color={player.color}
              data-acting={acting}
              layout
              transition={springSoft}
            >
              {acting ? (
                <motion.span
                  className="pg-grail__cursor"
                  layoutId="pg-rail-cursor"
                  transition={springSnappy}
                />
              ) : null}
              <span className="pg-grail__pos pg-numeral">{player.orderIndex + 1}</span>
              <Avatar name={player.name} color={player.color} size="sm" connected={player.connected} glow={acting} />
              <span className="pg-grail__body">
                <span className="pg-grail__name">
                  {player.name}
                  {player.id === meId ? <em>you</em> : null}
                </span>
                <span className="pg-grail__meta">
                  <Money value={player.money} size="sm" />
                  <span className="pg-grail__dot" aria-hidden="true" />
                  <span className="pg-numeral">{player.cities.length}</span> cities
                </span>
              </span>
              <Tooltip placement="right" title={label.label} rule="§4 Player order" content={label.note}>
                <span className="pg-grail__status" data-status={acting ? 'acting' : effective} tabIndex={0}>
                  {acting ? 'Acting' : label.label}
                </span>
              </Tooltip>
            </motion.div>
          );
        })}
      </div>

      <div className="pg-grail__foot">
        <Badge tone="info" size="sm">
          Phase {meta.index} · {meta.order}
        </Badge>
        <p className="pg-caption">{meta.summary}</p>
      </div>
    </Panel>
  );
}
