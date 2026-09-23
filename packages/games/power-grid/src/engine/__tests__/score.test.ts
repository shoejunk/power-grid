import { describe, expect, it } from 'vitest';
import { emptyResources } from '../../types.js';
import { createGame } from '../setup.js';
import { currentResourcePrice, scorePlayer } from '../score.js';

function game() {
  return createGame(
    { mapId: 'germany', playerCount: 2, experiencedStart: false, againstTheTrust: false, seed: 'score-test' },
    [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
    'a',
    'SCORE',
  );
}

describe('player score', () => {
  it('adds Elektro, 20 per city, printed plant numbers, and stored fuel at the current market price', () => {
    const state = game();
    const alice = state.players.a!;
    alice.cities = ['one', 'two'];
    alice.plants = [
      { plantId: 10, stored: { ...emptyResources(), coal: 2, oil: 1 } },
      { plantId: 23, stored: { ...emptyResources(), garbage: 1, uranium: 1 } },
    ];
    alice.money = 999;

    expect(scorePlayer(state, alice)).toEqual({ elektro: 999, cities: 40, plants: 33, resources: 25, total: 1097 });
    expect(scorePlayer(state, state.players.b!).total).toBe(50);
  });

  it('revalues every player when the market changes between phases', () => {
    const state = game();
    for (const player of Object.values(state.players)) {
      player.plants = [{ plantId: 10, stored: { ...emptyResources(), coal: 2 } }];
    }
    expect(Object.values(state.players).map((player) => scorePlayer(state, player).total)).toEqual([62, 62]);

    state.phase = 'resources';
    state.resourceMarket.coal[0]!.filled = 0;
    expect(Object.values(state.players).map((player) => scorePlayer(state, player).total)).toEqual([64, 64]);

    for (const space of state.resourceMarket.coal) space.filled = 0;
    expect(currentResourcePrice(state, 'coal')).toBe(8);
    expect(scorePlayer(state, state.players.a!).total).toBe(76);
  });
});
