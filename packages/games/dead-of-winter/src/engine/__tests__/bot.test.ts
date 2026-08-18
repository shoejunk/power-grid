/**
 * Automated seats, driven exactly the way the server drives them.
 *
 * The test that matters here is not "does the bot play well" — it is "can a
 * table of bots ever stop". The server offers a move only to the seat
 * `activePlayerOf` names, applies it, and asks again; if that loop ever has no
 * answer, the table is stuck forever and nobody can do anything about it. So
 * the loop below is the server's, reproduced against the plugin's own surface,
 * and it runs whole games out to their end.
 *
 * The §15 vote is the interesting case and has its own test: votes are
 * simultaneous, so the engine leaves the clock with the nominator, and it is
 * the plugin's `activePlayerOf` that has to hand it to each elector who still
 * owes a commitment.
 */

import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameState, PlayerId } from '../../types.js';
import { applyAction } from '../index.js';
import { fresh, NOW, settingsFor } from './helpers.js';

/** The server's automation loop: ask, apply, repeat. */
function runTable(state: GameState, limit = 4000): { state: GameState; steps: number } {
  let current = state;
  let steps = 0;

  for (; steps < limit; steps++) {
    if (deadOfWinter.isGameOver(current)) break;
    const active = deadOfWinter.activePlayerOf(current);
    if (active === null) break;

    const candidates: GameAction[] = [];
    const planned = deadOfWinter.defaultActionFor?.(current, active) ?? null;
    if (planned) candidates.push(planned);
    candidates.push(...(deadOfWinter.safeDefaultActions?.(current, active) ?? []));

    const playable = candidates.find(
      (action) => deadOfWinter.validateAction(current, active, action).ok,
    );
    // No legal move for the seat holding the clock is precisely the stall this
    // suite exists to catch.
    expect(playable, `no legal automatic action for ${active} at ${describeAt(current)}`).toBeDefined();

    current = applyAction(current, active, playable!, NOW + steps);
  }

  return { state: current, steps };
}

const describeAt = (state: GameState): string =>
  `phase=${state.phase} step=${state.colonyStep ?? '-'} round=${state.round} choices=${state.pendingChoices
    .map((c) => `${c.kind}:${c.playerId ?? 'all'}`)
    .join(',')}`;

describe('automated seats', () => {
  it('drives a three-player table from setup to a finished game', () => {
    const { state, steps } = runTable(fresh({ playerCount: 3, settings: { mode: 'standard' } }));

    expect(steps).toBeGreaterThan(20);
    expect(state.phase).toBe('gameOver');
    expect(state.outcome).not.toBeNull();
  });

  it('finishes a five-player table too', () => {
    const { state } = runTable(fresh({ playerCount: 5, seed: 'BOT-FIVE' }));
    expect(state.phase).toBe('gameOver');
  });

  it('never leaves a decision unanswered while it runs', () => {
    const { state } = runTable(fresh({ playerCount: 4, seed: 'BOT-FOUR' }));
    expect(state.pendingChoices).toHaveLength(0);
  });

  it('hands the clock to every elector who still owes a vote', () => {
    /*
     * A vote is started for real — nominated by p1 against p2 — and then the
     * table is driven automatically. If `activePlayerOf` did not walk the
     * electorate, the loop would stall on the first uncommitted seat.
     */
    let state = fresh({ playerCount: 3, seed: 'BOT-VOTE' });
    state = runToPlayerTurns(state);

    const nominator = state.turn!.playerId;
    const nominee = state.seating.find((id) => id !== nominator)!;
    state = applyAction(state, nominator, { type: 'nominateExile', targetPlayerId: nominee }, NOW);

    expect(state.vote).not.toBeNull();
    const electorate = state.vote!.electorate;
    expect(deadOfWinter.activePlayerOf(state)).toBe(electorate[0]);

    const { state: finished } = runTable(state);
    expect(finished.vote).toBeNull();
  });

  it('answers every setup decision without a human', () => {
    const state = fresh({ playerCount: 3, seed: 'BOT-SETUP' });
    expect(state.phase).toBe('setup');

    let current = state;
    for (let i = 0; i < 200 && current.phase === 'setup'; i++) {
      const active = deadOfWinter.activePlayerOf(current)!;
      const action = deadOfWinter.defaultActionFor!(current, active)!;
      current = applyAction(current, active, action, NOW + i);
    }

    expect(current.phase).toBe('playerTurns');
    for (const id of current.seating) {
      expect(survivorCount(current, id)).toBe(2);
      expect(current.players[id]!.leaderSurvivorId).not.toBeNull();
    }
  });

  it('uses the same settings object the plugin publishes', () => {
    // The harness must not test a configuration the product never ships.
    expect(settingsFor({ playerCount: 4 })).toEqual({
      ...deadOfWinter.defaultSettings(),
      seed: 'SEED-ALPHA',
      playerCount: 4,
    });
  });
});

function runToPlayerTurns(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 200 && current.phase === 'setup'; i++) {
    const active = deadOfWinter.activePlayerOf(current)!;
    const action = deadOfWinter.defaultActionFor!(current, active)!;
    current = applyAction(current, active, action, NOW + i);
  }
  return current;
}

const survivorCount = (state: GameState, playerId: PlayerId): number =>
  Object.values(state.survivors).filter((s) => s.controllerId === playerId).length;
