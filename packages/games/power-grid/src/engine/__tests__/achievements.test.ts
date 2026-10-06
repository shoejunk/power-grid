import { afterEach, expect, it } from 'vitest';
import { POWER_GRID_ACHIEVEMENTS, powerGridAchievementAwards } from '../../achievements.js';
import type { GameState } from '../../types.js';
import { applyBuyResources } from '../resources.js';
import { registerMap, stateMap, unregisterMap } from '../mapAccess.js';
import { runFinalEvaluation } from '../endgame.js';
import { act, enterPhase, grantPlant, placeHouse, start, finishCombinedTurn } from './helpers.js';

afterEach(() => unregisterMap('germany'));

function completed(): GameState {
  const state = start();
  state.phase = 'gameOver';
  state.winnerId = 'p1';
  return state;
}

function ids(state: GameState, playerId = 'p1'): string[] {
  return powerGridAchievementAwards(state).filter(a => a.playerId === playerId).map(a => a.id);
}

function log(state: GameState, event: string, data: Record<string, unknown> = {}, round = 1, playerId = 'p1', step: 1 | 2 | 3 = 1): void {
  state.log.push({ id: state.log.length + 1, at: 1, round, phase: 'building', step, category: 'build', playerId, message: event, data: { event, ...data } });
}

function chain(): GameState {
  const state = start();
  const original = stateMap(state);
  const area = state.zone[0]!;
  registerMap({ ...original, cities: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `City ${i}`, area, x: i / 8, y: 0 })),
    connections: Array.from({ length: 7 }, (_, i) => ({ a: `c${i}`, b: `c${i + 1}`, cost: 1 })) });
  state.citySlots = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`c${i}`, [null, null, null]]));
  state.players.p1!.money = 1000;
  return enterPhase(state, 'building', 'p1');
}

it('has exactly 20 stable, distinct achievements and never awards an unfinished game or automated seats', () => {
  expect(POWER_GRID_ACHIEVEMENTS).toHaveLength(20);
  expect(new Set(POWER_GRID_ACHIEVEMENTS.map(a => a.id)).size).toBe(20);
  expect(powerGridAchievementAwards(start())).toEqual([]);
  const state = completed();
  expect(ids(state)).toEqual(['first-finish', 'first-win', 'win-without-scrapping']);
  state.players.p1!.isBot = true;
  expect(ids(state)).toEqual([]);
  state.players.p1!.isBot = false;
  state.players.p1!.isTrust = true;
  expect(ids(state)).toEqual([]);
});

it('counts the two retained first-turn builds, ignoring undo and neutral starting markers', () => {
  let state = chain();
  state.players.p1!.markedStartCity = 'c7';
  for (const cityId of ['c0', 'c1', 'c2']) state = act(state, 'p1', { type: 'buildCity', cityId });
  state = act(state, 'p1', { type: 'undoLastBuild' });
  state = finishCombinedTurn(state, 'p1');
  state.phase = 'gameOver';
  expect(ids(state)).toContain('two-cities-turn-one');
  state.round = 2;
  expect(ids(state)).not.toContain('zero-cities-turn-one-win');
});

it('awards a zero-build opening only with a proven first turn and eventual victory', () => {
  let state = finishCombinedTurn(chain(), 'p1');
  state.phase = 'gameOver'; state.winnerId = 'p1';
  expect(ids(state)).toContain('zero-cities-turn-one-win');
  state.winnerId = 'p2';
  expect(ids(state)).not.toContain('zero-cities-turn-one-win');
  state.winnerId = 'p1';
  state.log = [];
  expect(ids(state)).not.toContain('zero-cities-turn-one-win');
  log(state, 'buildingDone', { networkSize: 1 });
  expect(ids(state)).not.toContain('zero-cities-turn-one-win');
});

it('awards urban sprawl and a long connection from retained builds only', () => {
  let state = chain();
  for (const cityId of ['c0', 'c3', 'c4', 'c5']) state = act(state, 'p1', { type: 'buildCity', cityId });
  state.phase = 'gameOver';
  expect(ids(state)).toEqual(expect.arrayContaining(['urban-sprawl', 'long-connection']));
  state.phase = 'building';
  state = act(state, 'p1', { type: 'undoLastBuild' });
  state = act(state, 'p1', { type: 'undoLastBuild' });
  state = act(state, 'p1', { type: 'undoLastBuild' });
  state.phase = 'gameOver';
  expect(ids(state)).not.toContain('urban-sprawl');
  expect(ids(state)).not.toContain('long-connection');
});

it('does not count a first city or a nearer network connection as three hops', () => {
  let state = chain();
  for (const cityId of ['c7', 'c5', 'c4']) state = act(state, 'p1', { type: 'buildCity', cityId });
  state.phase = 'gameOver';
  expect(ids(state)).not.toContain('long-connection');
});

it('credits the first committed threshold builder, not a later builder or an undone threshold', () => {
  const state = completed();
  log(state, 'cityConnected', { cityId: 'x', networkSize: 7 });
  log(state, 'buildUndone', { cityId: 'x' });
  log(state, 'cityConnected', { cityId: 'y', networkSize: 7 }, 1, 'p2');
  log(state, 'cityConnected', { cityId: 'z', networkSize: 7 });
  log(state, 'stepChange', { step: 2, reason: 'cityThreshold' });
  expect(ids(state, 'p2')).toContain('open-step-two');
  expect(ids(state)).not.toContain('open-step-two');
  state.log[state.log.length - 1]!.data!.reason = 'forcedByStep3';
  expect(ids(state, 'p2')).not.toContain('open-step-two');
});

it('uses six cities to open Step 2 in six-player games', () => {
  const state = completed(); state.settings.playerCount = 6;
  log(state, 'cityConnected', { cityId: 'x', networkSize: 6 });
  log(state, 'stepChange', { step: 2, reason: 'cityThreshold' });
  expect(ids(state)).toContain('open-step-two');
});

it.each([
  [21, [10, 21], 76, true, true, false],
  [20, [3, 20], 75, false, false, false],
  [22, [11, 22], 21, false, false, true],
  [21, [21], 21, false, false, false],
] as const)('checks plant %i auction thresholds and previous owned plants', (plantId, plants, price, upgrade, expensive, bargain) => {
  const state = completed();
  log(state, 'plantAcquired', { plantId, plants, price, via: 'auction' });
  expect(ids(state).includes('big-upgrade')).toBe(upgrade);
  expect(ids(state).includes('expensive-auction')).toBe(expensive);
  expect(ids(state).includes('bargain-plant')).toBe(bargain);
  state.log[state.log.length - 1]!.data!.via = 'trust';
  for (const id of ['big-upgrade', 'expensive-auction', 'bargain-plant']) expect(ids(state)).not.toContain(id);
});

it('requires a nonempty fleet of only ecological plants at victory', () => {
  const state = completed();
  expect(ids(state)).not.toContain('eco-only-win');
  grantPlant(state, 'p1', 13); grantPlant(state, 'p1', 50);
  expect(ids(state)).toContain('eco-only-win');
  grantPlant(state, 'p1', 4);
  expect(ids(state)).not.toContain('eco-only-win');
});

it.each([[2, 17], [3, 17], [4, 17], [5, 15], [6, 14]])('compares final powered cities with the %i-player achievement target', (playerCount, threshold) => {
  const state = completed(); state.settings.playerCount = playerCount;
  state.finalEvaluation = [{ playerId: 'p1', citiesSupplied: threshold + 1, money: 50, networkSize: threshold + 1, plantIds: [] }];
  expect(ids(state)).toContain('above-threshold-win');
  expect(ids(state)).not.toContain('below-threshold-win');
  state.finalEvaluation[0]!.citiesSupplied = threshold;
  expect(ids(state)).not.toContain('above-threshold-win');
  expect(ids(state)).not.toContain('below-threshold-win');
  state.finalEvaluation[0]!.citiesSupplied = threshold - 1;
  expect(ids(state)).toContain('below-threshold-win');
});

it('uses final supply and money to prove a real tiebreaker victory', () => {
  const state = start();
  const cities = stateMap(state).cities.filter(c => state.zone.includes(c.area)).slice(0, 2);
  for (const id of ['p1', 'p2']) { grantPlant(state, id, 18); for (const city of cities) placeHouse(state, id, city.id, id === 'p1' ? 0 : 1); }
  state.players.p1!.money = 100; state.players.p2!.money = 99;
  runFinalEvaluation(state, 1);
  expect(state.winnerId).toBe('p1');
  expect(ids(state)).toEqual(expect.arrayContaining(['tiebreaker-win', 'cash-reserve-win']));
  state.finalEvaluation!.find(r => r.playerId === 'p2')!.money = 100;
  expect(ids(state)).not.toContain('tiebreaker-win');
  state.players.p1!.money = 99;
  expect(ids(state)).not.toContain('cash-reserve-win');
});

it('checks only available regions for Home Turf and Coast to Coast', () => {
  const state = completed(); const map = stateMap(state);
  placeHouse(state, 'p1', map.cities.find(c => c.area === state.zone[0])!.id);
  expect(ids(state)).toContain('skip-region-win');
  expect(ids(state)).not.toContain('all-regions-win');
  for (const area of state.zone.slice(1)) placeHouse(state, 'p1', map.cities.find(c => c.area === area)!.id);
  expect(ids(state)).toContain('all-regions-win');
  expect(ids(state)).not.toContain('skip-region-win');
});

it('awards ten powered cities and remembers scrapping an earlier plant', () => {
  const state = completed();
  log(state, 'citiesPowered', { citiesSupplied: 9 });
  expect(ids(state)).not.toContain('power-ten');
  log(state, 'citiesPowered', { citiesSupplied: 10 });
  log(state, 'plantScrapped', { plantId: 4 });
  expect(ids(state)).toContain('power-ten');
  expect(ids(state)).not.toContain('win-without-scrapping');
});

function resourceGame(mapId: 'germany' | 'usa' = 'germany'): GameState {
  const state = start({ mapId });
  state.playerOrder = ['p3', 'p2', 'p1'];
  state.phase = 'resources'; state.activePlayerId = 'p1';
  for (const player of Object.values(state.players)) player.phaseStatus = 'eligible';
  state.players.p1!.phaseStatus = 'acting';
  grantPlant(state, 'p1', 4); grantPlant(state, 'p2', 5);
  state.resourceMarket.coal.forEach(space => { space.filled = 0; });
  state.resourceMarket.coal[0]!.filled = 2;
  state.resourceMarket.oil.forEach(space => { space.filled = 0; });
  state.usaCoalStorage = 0;
  return state;
}

it('records and awards exhausting coal before a later player needs fuel, including a hybrid', () => {
  const state = resourceGame();
  applyBuyResources(state, 1, 'p1', [{ resource: 'coal', count: 2 }]);
  const bought = state.log[state.log.length - 1]!;
  expect(bought.data!.blockedResourceBuyers).toEqual([{ playerId: 'p2', resource: 'coal' }]);
  state.phase = 'gameOver';
  expect(ids(state)).toContain('asshole');
});

it.each(['alternative-fuel', 'alternative-market', 'already-bought', 'earlier-player', 'not-empty', 'usa-storage', 'legacy'] as const)('does not falsely award resource denial: %s', reason => {
  const state = resourceGame(reason === 'usa-storage' ? 'usa' : 'germany');
  if (reason === 'alternative-fuel') state.players.p2!.plants[0]!.stored.oil = 2;
  if (reason === 'alternative-market') state.resourceMarket.oil[0]!.filled = 2;
  if (reason === 'already-bought') state.players.p2!.phaseStatus = 'acted';
  if (reason === 'earlier-player') state.playerOrder = ['p1', 'p2', 'p3'];
  if (reason === 'not-empty') state.resourceMarket.coal[0]!.filled = 3;
  if (reason === 'usa-storage') state.usaCoalStorage = 2;
  if (reason === 'legacy') state.version = 2;
  applyBuyResources(state, 1, 'p1', [{ resource: 'coal', count: 2 }]);
  state.phase = 'gameOver';
  expect(ids(state)).not.toContain('asshole');
  if (reason === 'legacy') expect(state.log[state.log.length - 1]!.data).not.toHaveProperty('blockedResourceBuyers');
});
