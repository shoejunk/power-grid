import { describe, expect, it } from 'vitest';
import { FACILITIES } from '../../data/facilities.js';
import { powerGrid } from '../../plugin.js';
import { RESOURCE_TYPES, type GameState } from '../../types.js';
import { acquirePlant, applyAction, botActionFor, checkEndGameTrigger, createGame, defaultActionFor,
  finalStandings, legalActions, refillMarket, validateAction, validatePowerCities } from '../index.js';
import { cardLimit, industryBaseRefill, industryMoneyTarget, ownedCardIds } from '../industry.js';
import { NOW, enterPhase, finishCombinedTurn, grantPlant, seats, settingsFor, start } from './helpers.js';

function industry(count = 2, mapId: 'germany' | 'usa' = 'germany'): GameState {
  const s = createGame({ ...settingsFor({ playerCount: count, mapId }), rulesMode: 'industry' }, seats(count), 'p1', 'IND001', { now: NOW, gameId: 'industry-test', version: 4 });
  return applyAction(s, s.hostId, { type: 'selectZone', areas: [] }, NOW);
}

function marketForThirteen(s: GameState): void {
  for (const space of s.resourceMarket.coal) {
    space.filled = space.capacity - (space.price === 8 ? 2 : space.price === 6 ? 1 : space.price === 5 ? 2 : 0);
  }
  // Two-player baseline is one coal: leave one extra 8-price slot filled.
  if (industryBaseRefill(s).coal === 1) s.resourceMarket.coal.find(sp => sp.price === 8)!.filled++;
  s.supply.coal = 10;
}

describe('Industry configuration and auctions', () => {
  it('defines exactly three single-resource sizes for each resource', () => {
    expect(FACILITIES).toHaveLength(12);
    expect(new Set(FACILITIES.map(f => f.id)).size).toBe(12);
    for (const resource of RESOURCE_TYPES) {
      const cards = FACILITIES.filter(f => f.resource === resource);
      expect(cards.map(f => f.size)).toEqual(['small', 'medium', 'large']);
      expect(cards.map(f => f.output)).toEqual([1, 2, 3]);
      expect(cards.every(f => f.cost > 0)).toBe(true);
    }
  });

  it('defaults to classic and validates opt-in settings and cash targets', () => {
    expect(powerGrid.defaultSettings().rulesMode).toBeUndefined();
    expect(powerGrid.parseSettingsPatch({ rulesMode: 'industry', moneyTarget: 300 })).toEqual({ rulesMode: 'industry', moneyTarget: 300 });
    for (const moneyTarget of [0, 50, 99, 250.5, 2001, '250', NaN]) expect(powerGrid.parseSettingsPatch({ moneyTarget })).toBeNull();
    expect(powerGrid.parseSettingsPatch({ rulesMode: 'typo' })).toBeNull();
    expect(powerGrid.validateSettings({ ...settingsFor({ playerCount: 2, againstTheTrust: true }), rulesMode: 'industry' }, 2).ok).toBe(false);
    for (const playerCount of [2, 3, 4, 5, 6]) expect(industryMoneyTarget(settingsFor({ playerCount }))).toBe(250);
    expect(industryMoneyTarget({ ...settingsFor(), moneyTarget: 300 })).toBe(300);
  });

  it('offers small facilities alongside plants using cost rather than facility ID', () => {
    const s = industry();
    expect(s.version).toBe(4);
    expect(s.facilityMarket).toEqual([101, 104, 107, 110]);
    const id = s.activePlayerId!;
    const options = legalActions(s, id).nominatablePlants;
    expect(options.find(o => o.plantId === 101)?.minimumBid).toBe(8);
    expect(validateAction(s, id, { type: 'nominatePlant', plantId: 102, bid: 18 }).ok).toBe(false);
    expect(validateAction(s, id, { type: 'nominatePlant', plantId: 101, bid: 7 }).ok).toBe(false);
    const before = structuredClone(s.plantMarket);
    const citySlots = structuredClone(s.citySlots);
    let next = applyAction(s, id, { type: 'nominatePlant', plantId: 101, bid: 8, maxBid: 12 }, NOW);
    expect(next.auction).not.toBeNull();
    const rival = next.activePlayerId!;
    const view = powerGrid.redactStateFor(next, rival);
    expect(view.auction!.commitments[id]).toEqual({ status: 'submitted' });
    next = applyAction(next, rival, { type: 'passBid' }, NOW);
    expect(next.players[id]!.facilities).toEqual([101]);
    expect(next.players[id]!.money).toBe(42);
    expect(next.players[id]!.plants).toEqual([]);
    expect(next.citySlots).toEqual(citySlots);
    expect(next.plantMarket).toEqual(before);
    expect(next.facilityMarket).toEqual([102, 104, 107, 110]);
    expect(legalActions(next, id).nominatablePlants).toEqual([]);
    expect(legalActions(next, id).bidding).toBeNull();
  });

  it('advances all tiers without reintroducing scrapped facilities', () => {
    const s = industry();
    for (const id of [101, 102, 103]) acquirePlant(s, NOW, 'p1', id, { price: 0, via: 'auction' });
    expect(s.facilityMarket).toEqual([104, 107, 110]);
    expect(s.players.p1!.facilities).toEqual([101, 102, 103]);
  });

  it.each(['plant', 'facility', 'new'] as const)('allows any combination of five cards and scrapping a %s on the sixth', kind => {
    const s = industry();
    const playerId = s.activePlayerId!;
    for (const id of [3, 4, 5]) grantPlant(s, playerId, id);
    s.players[playerId]!.facilities = [104, 107];
    s.players[playerId]!.money = 100;
    expect(cardLimit(s)).toBe(5);
    expect(ownedCardIds(s.players[playerId]!)).toHaveLength(5);
    s.players[playerId]!.plants.find(p => p.plantId === 3)!.stored.oil = 4;
    s.passedThisPhase = s.playerOrder.filter(id => id !== playerId);
    let next = applyAction(s, playerId, { type: 'nominatePlant', plantId: 101, bid: 8 }, NOW);
    expect(next.pendingScrap?.playerId).toBe(playerId);
    expect(legalActions(next, playerId).scrappablePlants).toHaveLength(6);
    const scrap = kind === 'plant' ? 3 : kind === 'facility' ? 104 : 101;
    next = applyAction(next, playerId, { type: 'scrapPlant', plantId: scrap }, NOW);
    expect(ownedCardIds(next.players[playerId]!)).toHaveLength(5);
    expect(ownedCardIds(next.players[playerId]!)).not.toContain(scrap);
    if (scrap === 3) expect(next.players[playerId]!.plants.find(p => p.plantId === 5)!.stored.oil).toBe(4);
    else expect(next.scrappedFacilities).toContain(scrap);
  });

  it('supports five actual power plants and never operates a facility as a plant', () => {
    const s = industry();
    const id = s.activePlayerId!;
    for (const plant of [13, 18, 22, 27, 33]) grantPlant(s, id, plant);
    s.phase = 'building'; s.players[id]!.phaseStatus = 'passed';
    expect(legalActions(s, id).powerOptions).toHaveLength(32);
    expect(validatePowerCities(s, id, { operatePlantIds: [101], citiesSupplied: 0 }).ok).toBe(false);
  });

  it('keeps classic at three plants and rejects facility nomination even with an injected offer', () => {
    const s = start({ playerCount: 2 });
    expect(cardLimit(s)).toBe(3);
    expect(s.facilityMarket).toBeUndefined();
    s.facilityMarket = [101];
    expect(validateAction(s, s.activePlayerId!, { type: 'nominatePlant', plantId: 101, bid: 8 }).ok).toBe(false);
    expect(legalActions(s, s.activePlayerId!).nominatablePlants.some(p => p.plantId === 101)).toBe(false);
  });
});

describe('Industry automatic resource sales', () => {
  it('pays 13 for the 6,5,5 shipment after baseline and handling; all Steps are identical', () => {
    for (const step of [1, 2, 3] as const) {
      const s = industry(); s.step = step;
      marketForThirteen(s);
      s.players.p1!.facilities = [103];
      const money = s.players.p1!.money;
      const total = s.supply.coal + s.resourceMarket.coal.reduce((sum, sp) => sum + sp.filled, 0);
      refillMarket(s, NOW);
      expect(s.players.p1!.money - money).toBe(13);
      expect(s.supply.coal + s.resourceMarket.coal.reduce((sum, sp) => sum + sp.filled, 0)).toBe(total);
      expect(s.log.find(e => e.data?.event === 'industryBaseRefill')?.data?.requested).toEqual({ coal: 1, oil: 1, garbage: 1, uranium: 0 });
    }
  });

  it('shares slot proceeds proportionally, without turn-order advantage', () => {
    const s = industry(); marketForThirteen(s);
    s.players.p1!.facilities = [101]; s.players.p2!.facilities = [102];
    const reverse = structuredClone(s); reverse.playerOrder.reverse();
    refillMarket(s, NOW); refillMarket(reverse, NOW);
    expect(s.players.p1!.money).toBe(54);
    expect(s.players.p2!.money).toBe(59);
    expect(reverse.players.p1!.money).toBe(s.players.p1!.money);
    expect(reverse.players.p2!.money).toBe(s.players.p2!.money);
  });

  it('pays nothing for full markets, empty reserves, or 1-Elektro slots', () => {
    for (const condition of ['full', 'empty', 'cheap']) {
      const s = industry();
      s.players.p1!.facilities = [103];
      for (const sp of s.resourceMarket.coal) sp.filled = sp.capacity;
      if (condition !== 'full') s.resourceMarket.coal[0]!.filled = 0;
      s.supply.coal = condition === 'empty' ? 0 : 10;
      refillMarket(s, NOW);
      expect(s.players.p1!.money).toBe(50);
      expect(s.supply.coal).toBeGreaterThanOrEqual(0);
    }
  });

  it('limits output to reserves and available spaces, and charges handling only on delivery', () => {
    const s = industry(); marketForThirteen(s);
    s.players.p1!.facilities = [103]; s.supply.coal = 2;
    refillMarket(s, NOW);
    expect(s.players.p1!.money).toBe(55); // baseline 1, then one token at 6 minus 1
    expect(s.supply.coal).toBe(0);
    expect(s.log.find(e => e.data?.event === 'facilityIncome')?.data?.delivered).toBe(1);
  });

  it('uses USA coal storage and does not phase out Industry uranium', () => {
    const usa = industry(2, 'usa'); marketForThirteen(usa);
    usa.supply.coal = 0; usa.usaCoalStorage = 4; usa.players.p1!.facilities = [103];
    refillMarket(usa, NOW);
    expect(usa.players.p1!.money).toBe(63); expect(usa.usaCoalStorage).toBe(0);
    const germany = industry();
    germany.plantMarket.current = [39];
    acquirePlant(germany, NOW, 'p1', 39, { price: 0, via: 'auction' });
    expect(germany.uraniumPhaseOut).toBe(false);
    germany.players.p1!.facilities = [110];
    const before = germany.players.p1!.money;
    refillMarket(germany, NOW);
    expect(germany.players.p1!.money).toBeGreaterThan(before);
  });
});

describe('Industry cash victory and deterministic automation', () => {
  it('pays every player on the final round and lets a pure resource seller win', () => {
    let s = industry();
    s.playerOrder = ['p1', 'p2'];
    s.phase = 'building'; s.activePlayerId = 'p2';
    for (const p of Object.values(s.players)) p.phaseStatus = 'eligible';
    s.players.p2!.phaseStatus = 'acting';
    grantPlant(s, 'p1', 13); s.players.p1!.cities = ['test-city'];
    s.players.p1!.money = 230; // +22 for one city = 252
    s.players.p2!.money = 240; s.players.p2!.facilities = [103]; // +10 +13 = 263
    marketForThirteen(s);
    s = finishCombinedTurn(s, 'p2');
    expect(s.phase).toBe('building'); expect(s.players.p2!.money).toBe(240);
    s = finishCombinedTurn(s, 'p1', { operatePlantIds: [13], citiesSupplied: 1 });
    expect(s.phase).toBe('gameOver'); expect(s.round).toBe(1);
    expect(s.players.p1!.money).toBe(252); expect(s.players.p2!.money).toBe(263);
    expect(s.winnerId).toBe('p2'); expect(s.players.p2!.cities).toEqual([]);
    expect(s.log.filter(e => e.data?.event === 'citiesPowered')).toHaveLength(2);
    expect(finalStandings(s).map(r => r.playerId)).toEqual(['p2', 'p1']);
  });

  it('ignores city victory, honors custom targets and shares cash ties', () => {
    let s = industry(); s.settings.moneyTarget = 300;
    s.players.p1!.cities = Array(22).fill('test-city');
    checkEndGameTrigger(s, NOW); expect(s.endGameTriggered).toBe(false);
    s = enterPhase(s, 'building', 'p1');
    for (const p of Object.values(s.players)) p.money = 240;
    s = finishCombinedTurn(s, 'p1');
    expect(s.phase).not.toBe('gameOver');
    s = enterPhase(s, 'building', 'p1');
    for (const p of Object.values(s.players)) p.money = 290;
    s = finishCombinedTurn(s, 'p1');
    expect(s.phase).toBe('gameOver');
    expect(s.winnerIds?.slice().sort()).toEqual(['p1', 'p2']);
  });

  it.each([2, 3, 4, 5, 6])('plays a legal %i-player Industry game to cash victory and replays it exactly', count => {
    let state = industry(count);
    const initial = structuredClone(state);
    const actions: { id: string; action: ReturnType<typeof defaultActionFor> }[] = [];
    for (let i = 0; i < 2200 && state.phase !== 'gameOver'; i++) {
      const id = state.activePlayerId!;
      const legal = legalActions(state, id);
      // Exercise the planner directly too: fallback must not hide facility lookup errors.
      expect(() => botActionFor(state, id, legal)).not.toThrow();
      const action = defaultActionFor(state, id);
      expect(action).not.toBeNull();
      expect(validateAction(state, id, action!).ok).toBe(true);
      actions.push({ id, action });
      state = applyAction(state, id, action!, NOW);
      for (const p of Object.values(state.players)) {
        expect(p.money).toBeGreaterThanOrEqual(0);
        expect(ownedCardIds(p).length).toBeLessThanOrEqual(state.pendingScrap?.playerId === p.id ? 6 : 5);
      }
    }
    expect(state.phase).toBe('gameOver');
    expect(state.log.some(e => e.data?.event === 'facilityAcquired')).toBe(true);
    expect(Math.max(...Object.values(state.players).map(p => p.money))).toBeGreaterThanOrEqual(250);
    let replay = JSON.parse(JSON.stringify(initial)) as GameState;
    for (const { id, action } of actions) replay = applyAction(replay, id, action!, NOW);
    expect(replay).toEqual(state);
  }, 60000);
});
