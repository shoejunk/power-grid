/**
 * The table: who is playing, what they are holding, and what they owe.
 *
 * Hand *counts* are public (§3) even though hand contents are not, and so is
 * how many cards each player has pushed face down onto the crisis — the whole
 * social game runs on those two numbers, so they are on screen permanently
 * rather than behind a hover.
 */

import { SEAT_COLOR_HEX, type GameState, type SeatColorId } from '@game/dead-of-winter';
import type { PlayerId } from '@tt/core';
import { Badge, Panel } from '@tt/ui';

import { secretObjective } from '../content';
import { DowIcon } from './iconography';
import { Die } from './parts';

export function Seats({ state, me }: { state: GameState; me: PlayerId | null }): JSX.Element {
  const contributionsBy = (id: PlayerId): number =>
    state.crisis.contributions.filter((c) => c.playerId === id).length;

  return (
    <Panel padding="tight" className="dow-seats" title="The table">
      <div className="dow-seats__row">
        {state.seating.map((id) => {
          const player = state.players[id];
          if (!player) return null;
          const isMe = id === me;
          const acting = state.turn?.playerId === id;
          const tint = SEAT_COLOR_HEX[player.color as SeatColorId];
          const secret = isMe ? secretObjective(player.secretObjectiveIds[0] ?? null) : undefined;

          return (
            <div
              key={id}
              className={[
                'dow-seat',
                acting ? 'dow-seat--acting' : '',
                player.exiled ? 'dow-seat--exiled' : '',
                player.eliminated ? 'dow-seat--out' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ '--dow-seat-tint': tint } as React.CSSProperties}
            >
              <div className="dow-seat__head">
                <span className="dow-seat__pip" style={{ background: tint }} />
                <span className="dow-seat__name">
                  {player.name}
                  {isMe ? ' (you)' : ''}
                </span>
                {state.firstPlayerId === id ? (
                  <Badge tone="info" title="First player token. §5.1">
                    1st
                  </Badge>
                ) : null}
                {acting ? (
                  <Badge tone="success" dot>
                    Turn
                  </Badge>
                ) : null}
                {player.exiled ? <Badge tone="danger">Exiled</Badge> : null}
                {player.eliminated ? <Badge tone="danger">Out</Badge> : null}
                {player.connected ? null : <Badge tone="warning">Away</Badge>}
              </div>

              <div className="dow-seat__body">
                <span title="Cards in hand — the count is public, the cards are not. §3">
                  <DowIcon name="card" size={12} decorative /> {player.hand.length}
                </span>
                <span title="Cards pushed face down onto the crisis. §8.2">
                  <DowIcon name="card" size={12} decorative /> {contributionsBy(id)}
                </span>
                <span className="dow-seat__dice">
                  {player.unusedDice.map((value, i) => (
                    <Die key={`u${i}`} value={value} />
                  ))}
                  {player.usedDice.map((value, i) => (
                    <Die key={`s${i}`} value={value} spent />
                  ))}
                </span>
              </div>

              {secret ? (
                <p className="dow-seat__secret" title={secret.text}>
                  Your objective: <strong>{secret.name}</strong> — {secret.text}
                </p>
              ) : null}
              {player.revealedObjectiveIds.length > 0 ? (
                <p className="dow-seat__secret">
                  Revealed:{' '}
                  {player.revealedObjectiveIds
                    .map((cardId) => secretObjective(cardId)?.name ?? '???')
                    .join(', ')}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
