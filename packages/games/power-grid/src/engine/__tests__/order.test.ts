/** §4 Player order and §5 the one-time first-round exception. Acceptance 2. */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../types.js';
import { computePlayerOrder, deepClone, largestPlant, rankPlayers } from '../index.js';
import { act, grantPlant, placeHouse, start } from './helpers.js';

/** Records who the engine asks, in order, while every actor passes. */
function collectActors(
  state: GameState,
  pass: (s: GameState, id: PlayerId) => GameState,
): { actors: PlayerId[]; state: GameState } {
  const phase = state.phase;
  const actors: PlayerId[] = [];
  let s = state;
  let guard = 0;
  while (s.phase === phase && guard++ < 40) {
    const actor = s.activePlayerId!;
    actors.push(actor);
    s = pass(s, actor);
  }
  return { actors, state: s };
}

describe('§4 ranking rules', () => {
  it('ranks by connected cities, highest first', () => {
    const s = deepClone(start({ playerCount: 4, seed: 'RANK-1' }));
    const [a, b, c, d] = s.playerOrder as [string, string, string, string];
    placeHouse(s, a, 'flensburg');
    placeHouse(s, b, 'kiel');
    placeHouse(s, b, 'hamburg');
    placeHouse(s, c, 'bremen');
    placeHouse(s, c, 'hannover');
    placeHouse(s, c, 'cuxhaven');
    expect(rankPlayers(s, [a, b, c, d])).toEqual([c, b, a, d]);
  });

  it('breaks a tie with the highest-numbered owned plant', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'RANK-2' }));
    const [a, b, c] = s.playerOrder as [string, string, string];
    grantPlant(s, a, 12);
    grantPlant(s, b, 30);
    grantPlant(s, c, 4);
    grantPlant(s, c, 29);
    expect(largestPlant(s, c)).toBe(29);
    expect(rankPlayers(s, [a, b, c])).toEqual([b, c, a]);
  });

  it('cities dominate the plant tie-break', () => {
    const s = deepClone(start({ playerCount: 2, seed: 'RANK-3' }));
    const [a, b] = s.playerOrder as [string, string];
    grantPlant(s, a, 50);
    placeHouse(s, b, 'flensburg');
    expect(rankPlayers(s, [a, b])).toEqual([b, a]);
  });

  it('falls back to the previous order when players are indistinguishable', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'RANK-4' }));
    expect(rankPlayers(s, s.playerOrder)).toEqual(s.playerOrder);
    expect(computePlayerOrder(s)).toEqual(s.playerOrder);
  });
});

describe('§4 per-phase turn order', () => {
  it('Phase 2 runs in player order, Phases 3-4 in reverse, Phase 5 forward', () => {
    // Round 1 with a rigged market: each player buys in turn, uncontested.
    const base = start({ playerCount: 3, seed: 'ORDER-FLOW' });
    const s = deepClone(base);
    s.plantMarket.current = [3, 4, 5, 6];
    s.plantMarket.future = [7, 8, 9, 10];
    s.plantMarket.stack = [16, 17, 18, 19, 20];
    s.plantMarket.discountPlantId = null;
    s.plantMarket.discountReplacementRuleArmed = false;

    const auctionOrder = s.playerOrder.slice();
    const nominators: PlayerId[] = [];
    let t: GameState = s;
    const plantFor: Record<number, number> = { 0: 3, 1: 4, 2: 5 };
    for (let i = 0; i < 3; i++) {
      nominators.push(t.activePlayerId!);
      const actor = t.activePlayerId!;
      t = act(t, actor, { type: 'nominatePlant', plantId: plantFor[i]!, bid: plantFor[i]! });
      while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    }
    // §4: "Phase 2 normally proceeds in player order, starting with the first player."
    expect(nominators).toEqual(auctionOrder);

    // §5: the order is recomputed after the first round's auctions.
    expect(t.phase).toBe('resources');
    const recomputed = t.playerOrder.slice();
    expect(recomputed).toEqual([auctionOrder[2], auctionOrder[1], auctionOrder[0]]);
    expect(recomputed).not.toEqual(auctionOrder);

    // §4: "Phases 3 and 4 proceed in reverse player order."
    const resources = collectActors(t, (st, id) => act(st, id, { type: 'passResources' }));
    expect(resources.actors).toEqual(recomputed.slice().reverse());

    const building = collectActors(resources.state, (st, id) =>
      act(st, id, { type: 'passBuilding' }),
    );
    expect(building.actors).toEqual(recomputed.slice().reverse());

    // §4: "Phase 5 cash payment starts with the first player."
    const bureaucracy = collectActors(building.state, (st, id) =>
      act(st, id, { type: 'powerCities', decision: { operatePlantIds: [], citiesSupplied: 0 } }),
    );
    expect(bureaucracy.actors).toEqual(recomputed);
  });

  it('§5 round 1 uses the random setup order for the auctions', () => {
    const s = start({ playerCount: 4, seed: 'ORDER-R1' });
    const logged = s.log.find(
      (l) => (l.data as { reason?: string } | undefined)?.reason === 'initialRandomOrder',
    );
    expect(logged).toBeDefined();
    expect(s.activePlayerId).toBe(s.playerOrder[0]);
  });

  it('later rounds recompute the order at Phase 1 from city counts', () => {
    const base = start({ playerCount: 3, seed: 'ORDER-R2' });
    const s = deepClone(base);
    // Fast-forward to the start of a Phase 5 with everyone already paid.
    s.round = 3;
    s.phase = 'bureaucracy';
    const [a, b, c] = s.playerOrder as [string, string, string];
    placeHouse(s, c, 'flensburg');
    placeHouse(s, c, 'kiel');
    placeHouse(s, b, 'hamburg');
    for (const id of s.playerOrder) s.players[id]!.phaseStatus = 'acted';
    s.players[a]!.phaseStatus = 'acting';
    s.activePlayerId = a;

    const t = act(s, a, {
      type: 'powerCities',
      decision: { operatePlantIds: [], citiesSupplied: 0 },
    });
    expect(t.round).toBe(4);
    expect(t.playerOrder).toEqual([c, b, a]);
  });
});
