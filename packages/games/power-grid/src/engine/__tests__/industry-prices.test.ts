import { expect, it } from 'vitest';
import { PLANTS } from '../../data/plants.js';
import { FACILITIES, facilitiesForVersion, findFacility, cardNumber, compareMarketCards } from '../../data/facilities.js';
import { STEP3_PLANT_ID, emptyResources } from '../../types.js';
import { acquirePlant, applyAction, computePlayerOrder, createGame, largestPlant, legalActions, validateAction } from '../index.js';
import { buryHighestFuture, drawReplacement, minimumBid, placeDiscountToken, removeLowestCurrent, sortMarket } from '../plantMarket.js';
import { scorePlayer } from '../score.js';
import { jevContext } from '../jev.js';
import { NOW, seats, settingsFor } from './helpers.js';

function industry() {
  const state = createGame({ ...settingsFor({ playerCount: 2 }), rulesMode: 'industry' }, seats(2), 'p1', 'PRICE1', { now: NOW });
  return applyAction(state, 'p1', { type: 'selectZone', areas: [] }, NOW);
}

it('assigns all 59 Industry cards unique printed costs while preserving plant order and Classic prices', () => {
  const plants = PLANTS.filter(p => !p.isStep3);
  const cards = [...plants.map(p => p.id), ...FACILITIES.map(f => f.id)];
  const prices = cards.map(id => cardNumber(id, 9));
  expect(prices.sort((a, b) => a - b)).toEqual(Array.from({ length: 59 }, (_, i) => i + 3));
  expect(plants.map(p => cardNumber(p.id, 9))).toEqual(plants.map(p => cardNumber(p.id, 9)).sort((a, b) => a - b));
  for (const version of [1, 2, 3, 4, 5, 6]) expect(plants.map(p => cardNumber(p.id, version))).toEqual(plants.map(p => p.id));
  expect(cardNumber(STEP3_PLANT_ID, 9)).toBeGreaterThan(Math.max(...prices));
  for (const facility of FACILITIES) expect(facility.cost).toBe(cardNumber(facility.id, 9));
});

it('uses printed costs for sorting, bidding, discounts, replacement removal and market cycling', () => {
  const state = industry();
  Object.assign(state.plantMarket, { current: [331, 301, 11, 10], future: [305, 50, 321, 4], stack: [], discountPlantId: null });
  sortMarket(state);
  expect(state.plantMarket.current).toEqual([4, 301, 10, 11]);
  expect(state.plantMarket.future).toEqual([321, 331, 305, 50]);
  expect(minimumBid(state, 10)).toBe(11);
  expect(validateAction(state, state.activePlayerId!, { type: 'nominatePlant', plantId: 10, bid: 10 }).ok).toBe(false);
  expect(legalActions(state, state.activePlayerId!).nominatablePlants.find(p => p.plantId === 10)?.minimumBid).toBe(11);
  expect(buryHighestFuture(state, NOW)).toBe(50); // 61 beats a facility whose internal ID is 305
  expect(removeLowestCurrent(state, NOW, 'test')).toBe(4);
  placeDiscountToken(state, NOW);
  expect(state.plantMarket.discountPlantId).toBe(301);
  expect(minimumBid(state, 301)).toBe(1);
  state.plantMarket.stack = [8, 311];
  expect(drawReplacement(state, NOW, 'test')).toEqual({ kind: 'placed', plantId: 311 });
  expect(state.plantMarket.removed).toContain(8); // cost 8 is below discounted cost 9
  expect(state.plantMarket.discountPlantId).toBeNull();
  expect([...state.plantMarket.current, ...state.plantMarket.future]).toEqual(
    [...state.plantMarket.current, ...state.plantMarket.future].sort((a, b) => compareMarketCards(a, b, 9)));
  const context = jevContext(state, 'p1');
  expect(context.plants.find(p => p.id === 10)).toMatchObject({ cost: 11 });
  expect(context.rules.order).toContain('facilities');
});

it('breaks city ties by the highest printed cost of any owned card, not IDs, sums, cash or auction payments', () => {
  const state = industry();
  state.playerOrder = ['p1', 'p2'];
  state.players.p1!.facilities = [301, 311]; // costs 9 and 12, combined 21
  state.players.p2!.plants = [{ plantId: 11, stored: emptyResources() }]; // printed cost 13
  expect(largestPlant(state, 'p1')).toBe(12);
  expect(scorePlayer(state, state.players.p1!).plants).toBe(21);
  expect(computePlayerOrder(state)).toEqual(['p2', 'p1']);
  state.players.p1!.facilities = [];
  state.plantMarket.current = [331]; state.plantMarket.future = []; state.plantMarket.stack = [];
  acquirePlant(state, NOW, 'p1', 331, { via: 'auction', price: 1 });
  expect(largestPlant(state, 'p1')).toBe(26);
  expect(scorePlayer(state, state.players.p1!).plants).toBe(26); // discounted payment of 1 does not change printed cost
  expect(computePlayerOrder(state)).toEqual(['p1', 'p2']);
  state.players.p2!.cities = ['test-city'];
  expect(computePlayerOrder(state)).toEqual(['p2', 'p1']);
  state.players.p2!.cities = [];
  state.players.p2!.plants = [{ plantId: 50, stored: emptyResources() }];
  expect(computePlayerOrder(state)).toEqual(['p2', 'p1']);
});

it('recalculates first-round order using facilities before reverse-order resource purchases', () => {
  let state = industry();
  state.playerOrder = ['p1', 'p2']; state.activePlayerId = 'p1';
  state.plantMarket.current = [301, 11, 13, 331]; state.plantMarket.future = []; state.plantMarket.stack = [];
  state.plantMarket.discountPlantId = null;
  state = applyAction(state, 'p1', { type: 'nominatePlant', plantId: 331, bid: 26 }, NOW);
  state = applyAction(state, 'p2', { type: 'passBid' }, NOW);
  state = applyAction(state, 'p2', { type: 'nominatePlant', plantId: 11, bid: 13 }, NOW);
  expect(state.phase).toBe('resources');
  expect(state.playerOrder).toEqual(['p1', 'p2']);
  expect(state.activePlayerId).toBe('p2');
});


it('keeps the original 61-card prices in version-7/8 saves while closing both removed-card gaps', () => {
  const plants = PLANTS.filter(p => !p.isStep3);
  for (const version of [7, 8]) {
    const ids = [...plants.map(p => p.id), ...facilitiesForVersion(version).map(f => f.id)];
    expect(ids.map(id => cardNumber(id, version)).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 61 }, (_, i) => i + 3));
    expect(findFacility(306, version)).toBeDefined();
    expect(findFacility(316, version)).toBeDefined();
  }
  for (const id of [306, 316]) {
    expect(findFacility(id, 9)).toBeUndefined();
    expect(findFacility(id)).toBeDefined(); // historical cards still render as facilities
  }
  expect([315, 333, 37, 44, 46, 50].map(id => cardNumber(id, 9))).toEqual([52, 53, 54, 59, 60, 61]);
  expect(facilitiesForVersion(9).filter(f => f.resource === 'coal').at(-1)).toMatchObject({ id: 305, output: 7, size: 'large' });
  expect(facilitiesForVersion(9).filter(f => f.resource === 'oil').at(-1)).toMatchObject({ id: 315, output: 6, size: 'large' });
});
