/**
 * §16's reckoning.
 *
 * Everything hidden becomes visible at once: every secret objective, every
 * exiled card, and who actually won — which in this game is a per-player
 * question, not a single winner. Several players can win together, and everyone
 * can lose, so the panel says so per seat rather than crowning somebody.
 */

import type { GameEndReason, GameState } from '@game/dead-of-winter';
import type { PlayerId } from '@tt/core';
import { Badge, Button, Panel } from '@tt/ui';

import { net } from '@/net';

import { secretObjective } from '../content';

const REASON: Record<GameEndReason, string> = {
  morale: 'Morale hit zero. The colony fell apart.',
  rounds: 'The round tracker ran out.',
  mainObjective: 'The main objective was resolved.',
  twoNonBetrayerExiles: 'Two innocent people were thrown out into the snow.',
  allPlayersEliminated: 'Nobody was left.',
  effect: 'A card ended it.',
};

export function GameOverPanel({ state, me }: { state: GameState; me: PlayerId | null }): JSX.Element {
  const outcome = state.outcome;
  const iWon = me !== null && (outcome?.winners.includes(me) ?? false);

  return (
    <div className="dow-over">
      <Panel
        tone="glass"
        padding="roomy"
        ticks
        title={iWon ? 'You survived the winter' : 'The winter took it'}
        subtitle={outcome ? REASON[outcome.reason] : undefined}
        actions={
          <Badge tone={outcome?.mainObjectiveComplete ? 'success' : 'danger'}>
            {outcome?.mainObjectiveComplete ? 'Objective complete' : 'Objective failed'}
          </Badge>
        }
        className="dow-over__panel"
      >
        <div className="dow-over__results">
          {(outcome?.results ?? []).map((result) => {
            const player = state.players[result.playerId];
            return (
              <div key={result.playerId} className="dow-over__row">
                <span className="dow-over__name">{player?.name ?? result.playerId}</span>
                <Badge tone={result.won ? 'success' : 'neutral'}>
                  {result.won ? 'Won' : 'Lost'}
                </Badge>
                <span className="dow-over__objectives">
                  {result.secretObjectiveIds
                    .map((cardId) => secretObjective(cardId)?.name ?? '???')
                    .join(', ') || 'no secret objective'}
                  {result.exiledObjectiveId
                    ? ` · exiled: ${secretObjective(result.exiledObjectiveId)?.name ?? '???'}`
                    : ''}
                </span>
                <Badge tone={result.objectiveComplete ? 'success' : 'warning'}>
                  {result.objectiveComplete ? 'Fulfilled' : 'Unfulfilled'}
                </Badge>
              </div>
            );
          })}
        </div>

        <div className="dow-over__actions">
          <Button variant="primary" onClick={() => net.leaveGame()}>
            Back to the portal
          </Button>
        </div>
      </Panel>
    </div>
  );
}
