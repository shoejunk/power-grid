import { expect, it } from 'vitest';
import { FACILITIES, facilitiesForVersion, findFacility, getFacility, compareMarketCards } from '../../data/facilities.js';
import { RESOURCE_TYPES } from '../../types.js';
import { createGame, applyAction, acquirePlant, scrapPlant, refillMarket } from '../index.js';
import { jevContext } from '../jev.js';
import { NOW, seats, settingsFor } from './helpers.js';

const VERSION_6_FACILITIES = facilitiesForVersion(6);

function industry(version = 6) {
  const state = createGame({ ...settingsFor({ playerCount: 2 }), rulesMode: 'industry' }, seats(2), 'p1', 'PROD01', { now: NOW, version });
  return applyAction(state, 'p1', { type: 'selectZone', areas: [] }, NOW);
}

it('has two independently identified copies of each resource and size, producing 1/3/5 at unchanged costs', () => {
  expect(VERSION_6_FACILITIES).toHaveLength(24);
  expect(new Set(VERSION_6_FACILITIES.map(f => f.id)).size).toBe(24);
  for (const resource of RESOURCE_TYPES) {
    for (const [size, output] of [['small', 1], ['medium', 3], ['large', 5]] as const) {
      const copies = VERSION_6_FACILITIES.filter(f => f.resource === resource && f.size === size);
      expect(copies).toHaveLength(2);
      expect(copies.map(f => f.output)).toEqual([output, output]);
      expect(copies.map(f => f.cost)).toEqual([getFacility(copies[0]!.id, 5).cost, getFacility(copies[0]!.id, 5).cost]);
    }
  }
  expect([110, 210, 102, 202, 18].sort(compareMarketCards)).toEqual([18, 102, 202, 110, 210]);
});

it.each([4, 5])('keeps the twelve-card 1/2/3 catalog for version %i saves and AI context', version => {
  const state = industry(version);
  const cards = facilitiesForVersion(version);
  expect(cards).toHaveLength(12);
  expect(cards.slice(0, 3).map(f => f.output)).toEqual([1, 2, 3]);
  expect(jevContext(state, state.activePlayerId!).facilities).toEqual(cards);
  state.players.p1!.facilities = [103];
  for (const slot of state.resourceMarket.coal) slot.filled = 0;
  state.supply.coal = 24;
  refillMarket(state, NOW);
  expect(state.log.find(e => e.data?.event === 'facilityIncome')?.data?.requested).toBe(3);
});

it('lets one player acquire both copies and scrap just one', () => {
  const state = industry();
  state.plantMarket.current = [101, 201, 10, 13];
  state.plantMarket.future = []; state.plantMarket.stack = [];
  state.plantMarket.discountPlantId = null;
  acquirePlant(state, NOW, 'p1', 101, { price: 8, via: 'auction' });
  acquirePlant(state, NOW, 'p1', 201, { price: 8, via: 'auction' });
  expect(state.players.p1!.facilities).toEqual([101, 201]);
  expect(state.players.p1!.money).toBe(34);
  scrapPlant(state, NOW, 'p1', 101);
  expect(state.players.p1!.facilities).toEqual([201]);
  expect(state.plantMarket.removed).toContain(101);
  expect(state.plantMarket.removed).not.toContain(201);
});

it.each([1, 2, 3] as const)('delivers both large mines at five each and charges ten handling fees in Step %i', step => {
  const state = industry(); state.step = step;
  state.players.p1!.facilities = [103]; state.players.p2!.facilities = [203];
  for (const slot of state.resourceMarket.coal) slot.filled = 0;
  state.supply.coal = 24;
  refillMarket(state, NOW);
  const payments = state.log.filter(e => e.data?.event === 'facilityIncome').map(e => e.data!);
  expect(payments).toHaveLength(2);
  for (const payment of payments) {
    expect(payment.output).toBe(5);
    expect(payment.requested).toBe(10);
    expect(payment.delivered).toBe(10);
    expect(payment.totalRevenue).toBe(55); // 65 in filled-slot prices less ten handling fees
  }
  expect(state.players.p1!.money + state.players.p2!.money).toBe(155);
  expect(state.supply.coal).toBe(13); // one free baseline plus ten produced
  expect(state.resourceMarket.coal.reduce((n, slot) => n + slot.filled, 0)).toBe(11);
});

it('limits doubled five-token output to the remaining finite reserves', () => {
  const state = industry();
  state.players.p1!.facilities = [103]; state.players.p2!.facilities = [203];
  for (const slot of state.resourceMarket.coal) slot.filled = 0;
  state.supply.coal = 3;
  refillMarket(state, NOW);
  expect(state.supply.coal).toBe(0);
  expect(state.players.p1!.money).toBe(57);
  expect(state.players.p2!.money).toBe(57);
  expect(state.log.find(e => e.data?.event === 'facilityIncome')?.data?.delivered).toBe(2);
});


it('uses nineteen unique facilities with the requested output tiers', () => {
  expect(FACILITIES).toHaveLength(19);
  expect(new Set(FACILITIES.map(f => f.id)).size).toBe(19);
  expect(FACILITIES.filter(f => f.resource === 'coal').map(f => f.output)).toEqual([3, 4, 5, 6, 7, 8]);
  expect(FACILITIES.filter(f => f.resource === 'oil').map(f => f.output)).toEqual([2, 3, 4, 5, 6, 7]);
  expect(FACILITIES.filter(f => f.resource === 'garbage').map(f => f.output)).toEqual([2, 3, 4, 5]);
  expect(FACILITIES.filter(f => f.resource === 'uranium').map(f => f.output)).toEqual([2, 3, 4]);
  expect(jevContext(industry(8), 'p1').facilities).toEqual(FACILITIES);
  expect(FACILITIES.map(f => [f.id, f.cost])).toEqual(facilitiesForVersion(7).map(f => [f.id, f.cost]));
  expect(createGame({ ...settingsFor({ playerCount: 2 }), rulesMode: 'industry' }, seats(2), 'p1', 'NEW001', { now: NOW }).version).toBe(8);
  expect(jevContext(industry(6), 'p1').facilities).toEqual(VERSION_6_FACILITIES);
  for (const id of [109, 112, ...VERSION_6_FACILITIES.filter(f => f.id >= 200).map(f => f.id)]) {
    expect(findFacility(id, 7)).toBeUndefined();
    expect(findFacility(id, 6)).toBeDefined();
    expect(findFacility(id)).toBeDefined(); // historical cards still render, sort and auction as facilities
  }
});

it.each([1, 2, 3] as const)('delivers the revised garbage and uranium output with handling in Step %i', step => {
  const state = industry(7); state.step = step;
  state.players.p1!.facilities = [321, 331];
  state.players.p2!.facilities = [323, 333];
  for (const resource of ['garbage', 'uranium'] as const) {
    for (const slot of state.resourceMarket[resource]) slot.filled = 0;
  }
  state.supply.garbage = 24; state.supply.uranium = 12;
  refillMarket(state, NOW);
  const payments = state.log.filter(e => e.data?.event === 'facilityIncome').map(e => e.data!);
  expect(payments.filter(p => p.resource === 'garbage').map(p => [p.output, p.delivered, p.totalRevenue, p.paid]))
    .toEqual([[2, 6, 37, 12], [4, 6, 37, 25]]);
  expect(payments.filter(p => p.resource === 'uranium').map(p => [p.output, p.delivered, p.totalRevenue, p.paid]))
    .toEqual([[1, 4, 48, 12], [3, 4, 48, 36]]);
  expect(state.supply.garbage).toBe(17); // six produced plus the one-token baseline
  expect(state.supply.uranium).toBe(8); // four produced, no two-player uranium baseline
  expect(state.players.p1!.money + state.players.p2!.money).toBe(185);
});


it.each([1, 2, 3] as const)('delivers increased version-8 production at full slot prices in Step %i', step => {
  const state = industry(8); state.step = step;
  state.players.p1!.facilities = [306, 316, 324, 333];
  for (const resource of RESOURCE_TYPES) {
    for (const slot of state.resourceMarket[resource]) slot.filled = 0;
    state.supply[resource] = resource === 'uranium' ? 12 : 24;
  }
  refillMarket(state, NOW);
  const payments = state.log.filter(e => e.data?.event === 'facilityIncome').map(e => e.data!);
  expect(payments.map(p => [p.resource, p.output, p.delivered, p.paid])).toEqual([
    ['coal', 8, 8, 55], ['oil', 7, 7, 49], ['garbage', 5, 5, 37], ['uranium', 4, 4, 52],
  ]);
  expect(state.players.p1!.money).toBe(243);
  expect(state.supply).toMatchObject({ coal: 15, oil: 16, garbage: 18, uranium: 8 });
});

it('preserves version-7 outputs and names for saved-game production and logs', () => {
  const expected = { coal: [1, 2, 3, 4, 5, 6], oil: [1, 2, 3, 4, 5, 6], garbage: [2, 3, 4, 5], uranium: [1, 2, 3] };
  for (const resource of RESOURCE_TYPES) {
    expect(facilitiesForVersion(7).filter(f => f.resource === resource).map(f => f.output)).toEqual(expected[resource]);
  }
  const state = industry(7);
  expect(jevContext(state, 'p1').facilities).toEqual(facilitiesForVersion(7));
  state.plantMarket.current = [301]; state.plantMarket.future = []; state.plantMarket.stack = [];
  state.plantMarket.discountPlantId = null;
  acquirePlant(state, NOW, 'p1', 301, { via: 'auction', price: 9 });
  expect(state.log.some(e => e.message.includes('wins Coal Mine (1)'))).toBe(true);
  scrapPlant(state, NOW, 'p1', 301);
  expect(state.log.at(-1)?.message).toContain('scraps Coal Mine (1)');
});


it('pays full price for cheap slots and nothing for undelivered version-8 output', () => {
  const state = industry(8);
  state.players.p1!.facilities = [301, 331];
  for (const slot of state.resourceMarket.coal) slot.filled = slot.capacity;
  state.resourceMarket.coal[0]!.filled = 0; // three slots at price 1; baseline fills one
  state.supply.coal = 3;
  for (const slot of state.resourceMarket.uranium) slot.filled = 0;
  state.supply.uranium = 1; // two requested, only one available, at price 16
  refillMarket(state, NOW);
  const payments = state.log.filter(e => e.data?.event === 'facilityIncome').map(e => e.data!);
  expect(payments.map(p => [p.resource, p.requested, p.delivered, p.paid]))
    .toEqual([['coal', 3, 2, 2], ['uranium', 2, 1, 16]]);
  expect(state.players.p1!.money).toBe(68);
  expect(jevContext(state, 'p1').rules.settlement).toContain('full slot price with no handling fee');
  expect(state.log.filter(e => e.data?.event === 'facilityIncome').every(e => !e.message.includes('handling'))).toBe(true);
  refillMarket(state, NOW);
  expect(state.players.p1!.money).toBe(68); // full coal market and empty uranium reserve
});
