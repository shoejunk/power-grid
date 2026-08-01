/** §12 Map-specific rules: the German nuclear phase-out and USA coal storage. */

import { describe, expect, it } from 'vitest';
import type { GameState } from '../../types.js';
import { getMap } from '../../data/maps/index.js';
import {
  deepClone,
  purchaseCost,
  refillMarket,
  removeLowestCurrent,
  applyPowerCities,
  buryHighestFuture,
  updatePlantMarket,
} from '../index.js';
import { act, enterPhase, lastLog, placeHouse, start } from './helpers.js';

function auctionState(seed: string, mutate: (s: GameState) => void = () => {}): GameState {
  const s = deepClone(start({ playerCount: 3, seed }));
  s.round = 2;
  s.plantMarket.current = [36, 38, 39, 40];
  s.plantMarket.future = [42, 44, 46, 50];
  s.plantMarket.stack = [20, 21, 22];
  s.plantMarket.removed = [];
  s.plantMarket.discountPlantId = null;
  s.plantMarket.discountReplacementRuleArmed = false;
  for (const id of s.playerOrder) s.players[id]!.money = 100;
  mutate(s);
  return s;
}

describe('§12 Germany — nuclear phase-out', () => {
  it('the map data names plant 39 as the trigger', () => {
    expect(getMap('germany').rules.nuclearPhaseOutPlant).toBe(39);
    expect(getMap('usa').rules.nuclearPhaseOutPlant).toBeUndefined();
  });

  it('fires when a player BUYS plant 39', () => {
    const s = auctionState('N39-BUY');
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 39, bid: 39 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.uraniumPhaseOut).toBe(true);
    expect(lastLog(t, 'uraniumPhaseOut')!.data).toMatchObject({ plantId: 39, playerId: a });
  });

  it('does NOT fire when plant 39 merely leaves the market', () => {
    const s = auctionState('N39-DISCARD', (x) => {
      x.plantMarket.current = [39, 40, 42, 44];
      x.plantMarket.future = [46, 50];
    });
    const removed = deepClone(s);
    removeLowestCurrent(removed, 1, 'test');
    expect(removed.plantMarket.removed).toContain(39);
    expect(removed.uraniumPhaseOut).toBe(false);

    const buried = deepClone(s);
    buried.plantMarket.current = [3, 4, 5, 6];
    buried.plantMarket.future = [7, 8, 39];
    buryHighestFuture(buried, 1);
    expect(buried.uraniumPhaseOut).toBe(false);
  });

  it('does NOT fire when plant 39 was removed during setup', () => {
    const s = auctionState('N39-SETUP', (x) => {
      x.plantMarket.current = [36, 38, 40, 42];
      x.plantMarket.future = [44, 46, 50];
      x.plantMarket.removed = [39];
    });
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 36, bid: 36 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.uraniumPhaseOut).toBe(false);
  });

  it('does NOT fire on the USA map, where no plant carries the rule', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'N39-USA', mapId: 'usa' }));
    s.round = 2;
    s.plantMarket.current = [36, 38, 39, 40];
    s.plantMarket.future = [42, 44, 46, 50];
    s.plantMarket.stack = [20];
    s.plantMarket.discountPlantId = null;
    s.plantMarket.discountReplacementRuleArmed = false;
    for (const id of s.playerOrder) s.players[id]!.money = 100;
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 39, bid: 39 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.uraniumPhaseOut).toBe(false);
  });

  it('stops uranium resupply for the rest of the game', () => {
    const s = auctionState('N39-REFILL');
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 39, bid: 39 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.uraniumPhaseOut).toBe(true);

    const before = t.resourceMarket.uranium.map((x) => x.filled);
    const later = deepClone(t);
    for (let round = 0; round < 3; round++) refillMarket(later, round);
    expect(later.resourceMarket.uranium.map((x) => x.filled)).toEqual(before);
    expect(later.supply.uranium).toBe(t.supply.uranium);
  });
});

describe('§12 USA — separate coal storage', () => {
  it('completes the burn → storage → refill → buy cycle', () => {
    const base = start({ playerCount: 3, seed: 'USA-CYCLE', mapId: 'usa' });
    const s = deepClone(base);
    const actor = s.playerOrder[0]!;
    const map = getMap('usa');
    const cities = map.cities.filter((c) => s.zone.includes(c.area)).map((c) => c.id);
    for (let i = 0; i < 2; i++) placeHouse(s, actor, cities[i]!);
    s.players[actor]!.plants = [
      { plantId: 8, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } },
    ];
    // The market is dry: every coal token is either burnt or already bought.
    for (const space of s.resourceMarket.coal) space.filled = 0;

    // 1. Burning coal fills the storage area.
    const burnt = deepClone(s);
    applyPowerCities(burnt, 1, actor, { operatePlantIds: [8], citiesSupplied: 2 });
    expect(burnt.usaCoalStorage).toBe(3);
    expect(burnt.supply.coal).toBe(0);

    // 2. Storage coal is buyable at 8 Elektro while the market is empty.
    expect(purchaseCost(burnt, 'coal', 3)).toBe(24);

    // 3. The next resupply pulls from storage back on to the market.
    const refilled = deepClone(burnt);
    refillMarket(refilled, 2);
    expect(refilled.usaCoalStorage).toBe(0);
    expect(refilled.resourceMarket.coal.reduce((a, b) => a + b.filled, 0)).toBe(3);
    // …and it lands on the most expensive empty spaces. §9.2.
    expect(refilled.resourceMarket.coal[7]!.filled).toBe(3);
    // 4. Market coal is cheap again.
    expect(purchaseCost(refilled, 'coal', 1)).toBe(8);
    expect(refilled.supply.coal).toBe(0);
  });

  it('never lets the coal supply go negative when storage is empty', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'USA-EMPTY', mapId: 'usa' }));
    for (const space of s.resourceMarket.coal) space.filled = 0;
    s.usaCoalStorage = 0;
    refillMarket(s, 1);
    expect(s.usaCoalStorage).toBe(0);
    expect(s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0)).toBe(0);
    expect(lastLog(s, 'marketRefilled')!.data).toMatchObject({ added: { coal: 0 } });
  });

  it('the plant market update is unaffected by the map', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'USA-PLANTS', mapId: 'usa' }));
    s.plantMarket.current = [3, 4, 5, 6];
    s.plantMarket.future = [7, 8, 9, 10];
    s.plantMarket.stack = [20];
    s.plantMarket.removed = [];
    s.plantMarket.discountPlantId = null;
    s.plantMarket.discountReplacementRuleArmed = false;
    updatePlantMarket(s, 1);
    expect(s.plantMarket.future).toEqual([7, 8, 9, 20]);
    expect(s.plantMarket.stack).toEqual([10]);
  });

  it('a Phase 3 purchase of storage coal is possible end to end', () => {
    const base = start({ playerCount: 3, seed: 'USA-BUY', mapId: 'usa' });
    const s = deepClone(base);
    const actor = s.playerOrder[2]!;
    s.players[actor]!.plants = [
      { plantId: 8, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } },
    ];
    for (const space of s.resourceMarket.coal) space.filled = 0;
    s.usaCoalStorage = 4;
    const t = act(enterPhase(s, 'resources', actor), actor, {
      type: 'buyResources',
      purchases: [{ resource: 'coal', count: 2 }],
    });
    expect(t.players[actor]!.money).toBe(50 - 16);
    expect(t.usaCoalStorage).toBe(2);
    expect(t.players[actor]!.plants[0]!.stored.coal).toBe(2);
  });
});
