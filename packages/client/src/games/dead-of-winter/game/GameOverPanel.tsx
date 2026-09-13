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
import type { CardPreview } from './CardPreviewDialog';

const REASON: Record<GameEndReason, string> = {
  morale: 'Morale hit zero. The colony fell apart.',
  rounds: 'The round tracker ran out.',
  mainObjective: 'The main objective was resolved.',
  twoNonBetrayerExiles: 'Two innocent people were thrown out into the snow.',
  allPlayersEliminated: 'Nobody was left.',
  effect: 'A card ended it.',
};

export function GameOverPanel({
  state,
  me,
  onPreview,
}: {
  state: GameState;
  me: PlayerId | null;
  onPreview: (preview: CardPreview) => void;
}): JSX.Element {
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
                  {result.secretObjectiveIds.length === 0 ? 'no secret objective' : null}
                  {result.secretObjectiveIds.map((cardId) => {
                    const card = secretObjective(state, cardId);
                    return card ? (
                      <button
                        type="button"
                        key={cardId}
                        onClick={() => onPreview({ kind: 'secretObjective', card })}
                      >
                        {card.name}
                      </button>
                    ) : (
                      <span key={cardId}>???</span>
                    );
                  })}
                  {result.exiledObjectiveId ? ' · exiled: ' : null}
                  {result.exiledObjectiveId ? (() => {
                    const card = secretObjective(state, result.exiledObjectiveId);
                    return card ? (
                      <button
                        type="button"
                        onClick={() => onPreview({ kind: 'secretObjective', card })}
                      >
                        {card.name}
                      </button>
                    ) : '???';
                  })() : null}
                </span>
                <Badge tone={result.objectiveComplete ? 'success' : 'warning'}>
                  {result.objectiveComplete ? 'Fulfilled' : 'Unfulfilled'}
                </Badge>
              </div>
            );
          })}
        </div>

        <div className="dow-over__actions">
          <Button variant="primary" onClick={() => net.viewGames()}>
            Back to my games
          </Button>
        </div>
      </Panel>
    </div>
  );
}
