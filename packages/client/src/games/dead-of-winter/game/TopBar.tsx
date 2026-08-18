/**
 * The colony's vital signs, plus the two cards the whole table is playing
 * against: the main objective and the crisis in front of it.
 *
 * §21 wants morale, food, rounds, the objective's progress and the current
 * step legible without opening anything, so all of it is one row that never
 * scrolls.
 */

import type { GameState } from '@game/dead-of-winter';
import { Badge, Panel } from '@tt/ui';
import type { PlayerId } from '@tt/core';

import { crisisCard, crossroadsCard, mainObjectiveName, mainObjectiveSide } from '../content';
import { foodDue, phaseLabel } from './model';
import { Stat } from './parts';

export function TopBar({ state, me }: { state: GameState; me: PlayerId | null }): JSX.Element {
  const objective = mainObjectiveSide(state);
  const crisis = crisisCard(state);
  const due = foodDue(state);
  const holder = state.turn ? state.players[state.turn.crossroadsHolderId] : undefined;
  const heldCrossroads =
    state.turn && me === state.turn.crossroadsHolderId
      ? crossroadsCard(state.turn.crossroadsCardId)
      : undefined;

  return (
    <div className="dow-top">
      <Panel padding="tight" tone="plate" className="dow-top__vitals">
        <div className="dow-top__stats">
          <Stat
            label="Morale"
            value={`${state.colony.morale}/${state.colony.maxMorale}`}
            tone={state.colony.morale <= 2 ? 'danger' : state.colony.morale <= 4 ? 'warning' : 'normal'}
            hint="At zero the colony loses immediately. §16"
          />
          <Stat
            label="Food"
            value={state.colony.food}
            tone={state.colony.food < due ? 'danger' : 'normal'}
            hint={`The colony will need ${due} at the end of this round. §11.1`}
          />
          <Stat label="Rounds left" value={state.colony.rounds} hint="§11.6" />
          <Stat label="Round" value={state.round} />
          {state.colony.starvation > 0 ? (
            <Stat
              label="Starvation"
              value={state.colony.starvation}
              tone="danger"
              hint="Each failed feeding costs this much morale, every time. §11.1"
            />
          ) : null}
          <Stat
            label="Waste"
            value={state.colony.waste.length}
            tone={state.colony.waste.length >= 10 ? 'warning' : 'normal'}
            hint="Ten or more costs morale in the Colony Phase. §11.2"
          />
        </div>
        <div className="dow-top__phase">
          <Badge tone="info" dot>
            {phaseLabel(state)}
          </Badge>
          {holder ? (
            <Badge tone="neutral" title="Holds this turn's crossroads card. §10">
              Crossroads: {holder.name}
            </Badge>
          ) : null}
          {heldCrossroads ? (
            <Badge tone="warning" title={heldCrossroads.story}>
              You hold “{heldCrossroads.name}”
            </Badge>
          ) : null}
        </div>
      </Panel>

      <Panel
        padding="tight"
        title={mainObjectiveName(state)}
        subtitle={state.mainObjective.side === 'hardcore' ? 'Hardcore side' : 'Standard side'}
        actions={<Badge tone="info">{state.mainObjective.contributions.length} added</Badge>}
        className="dow-top__objective"
      >
        <p className="tt-caption">{objective?.text ?? 'Unknown objective.'}</p>
        {Object.entries(state.mainObjective.counters).length > 0 ? (
          <div className="dow-top__counters">
            {Object.entries(state.mainObjective.counters).map(([id, value]) => (
              <Badge key={id} tone="neutral">
                {id}: {value}
              </Badge>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel
        padding="tight"
        title={crisis?.name ?? 'No crisis'}
        actions={
          <Badge tone={state.crisis.contributions.length > 0 ? 'warning' : 'neutral'}>
            {state.crisis.contributions.length} face down
          </Badge>
        }
        className="dow-top__crisis"
      >
        <p className="tt-caption">{crisis?.text ?? 'The next crisis arrives with the round.'}</p>
        {crisis ? (
          <p className="tt-caption dow-top__symbols">
            Wants: {crisis.acceptedSymbols.join(', ') || 'nothing'} — anything else counts against
            it. §11.3
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
