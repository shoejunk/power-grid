import { describe, expect, it } from 'vitest';
import { facilitiesForVersion, compareMarketCards, findFacility } from '../../data/facilities.js';
import { STEP3_PLANT_ID, type GameAction, type GameState } from '../../types.js';
import { acquirePlant, applyAction, botActionFor, checkEndGameTrigger, createGame, defaultActionFor,
  endGameReached, endGameThreshold, finalStandings, legalActions, validateAction } from '../index.js';
import { buryHighestFuture, drawReplacement, minimumBid, placeDiscountToken,
  removeLowestCurrent, resolveUnsoldDiscountPlant, sortMarket } from '../plantMarket.js';
import { jevContext } from '../jev.js';
import { ownedCardIds } from '../industry.js';
import { NOW, finishCombinedTurn, grantPlant, seats, settingsFor } from './helpers.js';

function industry(count = 2, seed = 'mixed-market', version = 6): GameState {
  const s = createGame({ ...settingsFor({ playerCount: count, seed }), rulesMode: 'industry' }, seats(count), 'p1', 'MIX001', { now: NOW, version });
  return applyAction(s, s.hostId, { type: 'selectZone', areas: [] }, NOW);
}

function market(s: GameState, current = [101, 10, 107, 13], future = [18, 102, 110, 112], stack = [104, 24, STEP3_PLANT_ID]) {
  Object.assign(s.plantMarket, { current, future, stack, discountPlantId: null, discountReplacementRuleArmed: false });
  sortMarket(s);
}

describe('Industry shared deck and market', () => {
  it.each([6, 7, 8, 9].flatMap(version => [2, 3, 4, 5, 6].map(count => [version, count] as const)))('shuffles version %i facilities for %i players', (version, count) => {
    const s = industry(count, 'mixed-market', version);
    expect(s.version).toBe(version);
    expect(s.facilityMarket).toBeUndefined();
    const m = s.plantMarket;
    const all = [...m.current, ...m.future, ...m.stack, ...m.removed];
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter(id => findFacility(id)).sort()).toEqual(facilitiesForVersion(version).map(f => f.id).sort());
    expect(m.current).toHaveLength(4);
    expect(m.future).toHaveLength(4);
    expect([...m.current, ...m.future]).toEqual([...m.current, ...m.future].sort((a, b) => compareMarketCards(a, b, version)));
    expect(m.stack.at(-1)).toBe(STEP3_PLANT_ID);
    expect(industry(count, 'mixed-market', version).plantMarket).toEqual(m);
    expect(industry(count, 'different', version).plantMarket).not.toEqual(m);
    const samples = Array.from({ length: 20 }, (_, i) => industry(count, `sample-${i}`, version).plantMarket);
    expect(samples.some(m => m.current.some(id => findFacility(id)))).toBe(true);
    expect(samples.some(m => m.future.some(id => findFacility(id)))).toBe(true);
  });

  it('sorts by printed cost with stable ties and permits only current cards', () => {
    const s = industry(); market(s, [110, 101, 18, 104], [13, 102, 8, 112]);
    expect(s.plantMarket.current).toEqual([8, 101, 104, 13]);
    expect(s.plantMarket.future).toEqual([18, 102, 110, 112]);
    expect(minimumBid(s, 101)).toBe(8);
    expect(legalActions(s, s.activePlayerId!).nominatablePlants.map(p => p.plantId)).toEqual([8, 101, 104, 13]);
    expect(validateAction(s, s.activePlayerId!, { type: 'nominatePlant', plantId: 110, bid: 18 }).ok).toBe(false);
    const context = jevContext(s, s.activePlayerId!);
    expect(context.tables.endGameCityThreshold).toBe(endGameThreshold(s));
    expect(context.rules.objective).not.toContain('moneyTarget');
    expect(context.plants.every(p => !findFacility(p.id))).toBe(true);
  });

  it('discounts a facility to 1, clears the token on purchase, and draws a replacement', () => {
    const s = industry(); market(s); placeDiscountToken(s, NOW);
    expect(s.plantMarket.discountPlantId).toBe(101);
    expect(minimumBid(s, 101)).toBe(1);
    expect(legalActions(s, s.activePlayerId!).nominatablePlants.find(p => p.plantId === 101)?.discounted).toBe(true);
    const player = s.players[s.activePlayerId!]!;
    acquirePlant(s, NOW, player.id, 101, { price: 1, via: 'auction' });
    expect(player.money).toBe(49);
    expect(player.facilities).toEqual([101]);
    expect(player.plants).toEqual([]);
    expect(s.plantMarket.discountPlantId).toBeNull();
    expect(s.plantMarket.current).toEqual([10, 104, 107, 13]);
    expect(s.plantMarket.stack).toEqual([24, STEP3_PLANT_ID]);
    expect(s.facilityMarket).toBeUndefined();
  });

  it.each([[101, 13], [8, 107]])('discards a cheaper replacement %i below discounted card %i', (drawn, discounted) => {
    const s = industry(); market(s, [discounted, 18, 102, 110], [], [drawn, 24]);
    placeDiscountToken(s, NOW);
    expect(drawReplacement(s, NOW, 'test')).toEqual({ kind: 'placed', plantId: 24 });
    expect(s.plantMarket.removed).toContain(drawn);
    expect(s.plantMarket.discountPlantId).toBeNull();
  });

  it('does not discard an equal-cost replacement even when its tie-break ID is lower', () => {
    const s = industry(); market(s, [102, 110, 24, 112], [], [18]);
    placeDiscountToken(s, NOW);
    expect(drawReplacement(s, NOW, 'test')).toEqual({ kind: 'placed', plantId: 18 });
    expect(s.plantMarket.discountPlantId).toBe(102);
  });

  it('removes unsold discounted facilities and applies high/low market updates by cost', () => {
    const s = industry(); market(s); placeDiscountToken(s, NOW);
    resolveUnsoldDiscountPlant(s, NOW);
    expect(s.plantMarket.removed).toContain(101);
    expect(s.plantMarket.current).toContain(104);
    expect(s.plantMarket.discountPlantId).toBeNull();
    expect(buryHighestFuture(s, NOW)).toBe(112);
    expect(s.plantMarket.stack.at(-1)).toBe(112);
    market(s, [110, 101, 18, 13], [], []);
    expect(removeLowestCurrent(s, NOW, 'step2')).toBe(101);
    s.step = 3; market(s, [110, 104, 24], [112, 18, 13], []);
    expect(s.plantMarket.future).toEqual([]);
    expect(removeLowestCurrent(s, NOW, 'step3')).toBe(104);
  });

  it('defers a Step 3 card drawn after facility acquisition until the auction ends', () => {
    const s = industry(); market(s, undefined, undefined, [STEP3_PLANT_ID, 24]);
    acquirePlant(s, NOW, s.activePlayerId!, 101, { price: 8, via: 'auction' });
    expect(s.pendingStep3).toBe('phase2');
    expect(s.step).toBe(1);
    expect(s.plantMarket.future.at(-1)).toBe(STEP3_PLANT_ID);
  });

  it.each([3, 104, 101])('allows scrapping card %i after a sixth mixed-market purchase', scrap => {
    let s = industry(); market(s);
    const id = s.activePlayerId!;
    for (const plant of [3, 4, 5]) grantPlant(s, id, plant);
    s.players[id]!.facilities = [104, 107];
    s.passedThisPhase = s.playerOrder.filter(p => p !== id);
    s = applyAction(s, id, { type: 'nominatePlant', plantId: 101, bid: 8 }, NOW);
    expect(legalActions(s, id).scrappablePlants).toHaveLength(6);
    s = applyAction(s, id, { type: 'scrapPlant', plantId: scrap }, NOW);
    expect(ownedCardIds(s.players[id]!)).toHaveLength(5);
    expect(s.plantMarket.removed).toContain(scrap);
  });
});

describe('Industry city victory', () => {
  it('ignores cash thresholds and uses classic final evaluation without either income stream', () => {
    let s = industry();
    s.players.p1!.money = 2000;
    checkEndGameTrigger(s, NOW);
    expect(endGameReached(s)).toBe(false);
    expect(s.endGameTriggered).toBe(false);
    s.playerOrder = ['p1', 'p2']; s.phase = 'building'; s.activePlayerId = 'p2';
    s.players.p1!.phaseStatus = 'eligible'; s.players.p2!.phaseStatus = 'acting';
    s.players.p1!.facilities = [103, 112];
    s.players.p1!.cities = Array(endGameThreshold(s)).fill('test-city');
    s.players.p2!.cities = ['city-a', 'city-b']; s.players.p2!.money = 20;
    grantPlant(s, 'p1', 13); grantPlant(s, 'p2', 4);
    s.players.p2!.plants[0]!.stored.coal = 2;
    const before = structuredClone(s);
    s = finishCombinedTurn(s, 'p2', { operatePlantIds: [4], citiesSupplied: 1 });
    s = finishCombinedTurn(s, 'p1', { operatePlantIds: [13], citiesSupplied: 1 });
    expect(s.phase).toBe('gameOver');
    expect(s.players.p1!.money).toBe(2000);
    expect(s.players.p2!.money).toBe(20);
    expect(s.players.p2!.plants).toEqual(before.players.p2!.plants);
    expect(s.resourceMarket).toEqual(before.resourceMarket);
    expect(s.log.some(e => ['citiesPowered', 'facilityIncome'].includes(String(e.data?.event)))).toBe(false);
    expect(finalStandings(s)[0]?.playerId).toBe('p1'); // equal power, cash tie breaker
  });

  it('ranks powerable cities above cash or who triggered the end', () => {
    let s = industry();
    s.playerOrder = ['p1', 'p2']; s.phase = 'building'; s.activePlayerId = 'p2';
    s.players.p1!.phaseStatus = 'eligible'; s.players.p2!.phaseStatus = 'acting';
    s.players.p1!.cities = Array(endGameThreshold(s)).fill('test-city');
    s.players.p1!.money = 2000; s.players.p1!.facilities = [112];
    s.players.p2!.cities = ['a', 'b', 'c']; s.players.p2!.money = 0;
    grantPlant(s, 'p1', 13); grantPlant(s, 'p2', 18);
    s = finishCombinedTurn(s, 'p2'); s = finishCombinedTurn(s, 'p1');
    expect(s.winnerId).toBe('p2');
    expect(finalStandings(s).map(r => r.citiesSupplied)).toEqual([2, 1]);
  });

  it.each([2, 3, 4, 5, 6])('completes and exactly replays a legal %i-player game', count => {
    let s = industry(count, 'mixed-market', 9); const initial = structuredClone(s);
    const actions: { id: string; action: GameAction }[] = [];
    for (let i = 0; i < 2500 && s.phase !== 'gameOver'; i++) {
      const id = s.activePlayerId!;
      // Calling directly prevents the default-action fallback from hiding planner errors.
      expect(() => botActionFor(s, id, legalActions(s, id))).not.toThrow();
      const action = defaultActionFor(s, id)!;
      expect(action).not.toBeNull(); expect(validateAction(s, id, action).ok).toBe(true);
      actions.push({ id, action }); s = applyAction(s, id, action, NOW);
      for (const p of Object.values(s.players)) {
        expect(p.money).toBeGreaterThanOrEqual(0);
        expect(ownedCardIds(p).length).toBeLessThanOrEqual(s.pendingScrap?.playerId === p.id ? 6 : 5);
      }
    }
    expect(s.phase).toBe('gameOver'); expect(s.endGameTriggered).toBe(true);
    expect(s.log.some(e => e.data?.event === 'facilityAcquired')).toBe(true);
    expect(Math.max(...Object.values(s.players).map(p => p.cities.length))).toBeGreaterThanOrEqual(endGameThreshold(s));
    let replay = JSON.parse(JSON.stringify(initial)) as GameState;
    for (const { id, action } of actions) replay = applyAction(replay, id, action, NOW);
    expect(replay).toEqual(s);
    expect(finalStandings(s)[0]?.playerId).toBe(s.winnerId);
  }, 60000);
});
