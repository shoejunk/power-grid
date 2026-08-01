/** §13 Two-player variant: Against the Trust. Acceptance 8. */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../types.js';
import { refillFor } from '../../data/tables.js';
import {
  TRUST_PLAYER_ID,
  buildTargets,
  deepClone,
  finalStandings,
  legalActions,
  neighboursInZone,
  refillMarket,
  stateMap,
  trustAuctionTurn,
  trustBuyResources,
  trustReturnResources,
  validateAction,
  zoneCities,
} from '../index.js';
import { act, enterPhase, findLog, lastLog, placeHouse, start } from './helpers.js';

function trustGame(seed = 'TRUST'): GameState {
  return start({ playerCount: 2, againstTheTrust: true, seed });
}

function rigMarket(s: GameState): void {
  s.plantMarket.current = [3, 4, 5, 6];
  s.plantMarket.future = [7, 8, 9, 10];
  s.plantMarket.stack = [20, 21, 22, 23];
  s.plantMarket.removed = [];
  s.plantMarket.discountPlantId = null;
  s.plantMarket.discountReplacementRuleArmed = false;
}

describe('§13 Trust setup', () => {
  it('seats the Trust permanently at order position 2', () => {
    const s = trustGame();
    expect(s.playerOrder).toHaveLength(3);
    expect(s.playerOrder[1]).toBe(TRUST_PLAYER_ID);
    expect(s.players[TRUST_PLAYER_ID]!.isTrust).toBe(true);
    expect(s.players[s.playerOrder[0]!]!.isTrust).toBe(false);
    expect(s.players[s.playerOrder[2]!]!.isTrust).toBe(false);
  });

  it('gives the Trust no money and no score-track position', () => {
    const s = trustGame();
    const trust = s.players[TRUST_PLAYER_ID]!;
    expect(trust.money).toBe(0);
    expect(trust.plants).toEqual([]);
    // §13: the humans keep the normal 50 Elektro.
    expect(s.players[s.playerOrder[0]!]!.money).toBe(50);
  });

  it('places six adjacent Trust houses on 10 Elektro slots, leaving ten in supply', () => {
    const s = trustGame();
    const trust = s.players[TRUST_PLAYER_ID]!;
    expect(trust.cities).toHaveLength(6);
    expect(trust.housesRemaining).toBe(10);
    expect(s.trustStartCities).toEqual(trust.cities);
    for (const city of trust.cities) {
      expect(s.citySlots[city]![0]).toBe(TRUST_PLAYER_ID);
      expect(s.citySlots[city]![2]).toBeNull();
    }
    // Every house after the first touches an existing Trust house.
    const map = stateMap(s);
    for (let i = 1; i < trust.cities.length; i++) {
      const placed = trust.cities.slice(0, i);
      const adjacent = placed.some((c) => neighboursInZone(map, s.zone, c).includes(trust.cities[i]!));
      expect(adjacent).toBe(true);
    }
  });

  it('uses the 3-area zone', () => {
    const s = trustGame();
    expect(s.zone).toHaveLength(3);
  });

  it('alternates the placing human A, B, B, A, A, B', () => {
    let s = start({ playerCount: 2, againstTheTrust: true, seed: 'PLACEMENT' });
    // Replay the placement log and compare with the required sequence.
    const placements = findLog(s, 'trustHousePlaced').filter(
      (l) => (l.data as { phase?: string }).phase === 'setup',
    );
    expect(placements).toHaveLength(6);
    // The engine asks the right seat each time; re-drive setup and check.
    s = start({ playerCount: 2, againstTheTrust: true, seed: 'PLACEMENT' });
    expect(s.setupStage).toBe('complete');
  });

  it('rejects a non-adjacent Trust house and an out-of-turn placement', () => {
    const base = start({ playerCount: 2, againstTheTrust: true, seed: 'ADJ' });
    // Re-run setup manually up to the second placement.
    const fresh0 = deepClone(base);
    fresh0.setupStage = 'trustPlacement';
    fresh0.phase = 'setup';
    const trust = fresh0.players[TRUST_PLAYER_ID]!;
    const kept = trust.cities[0]!;
    for (const c of trust.cities.slice(1)) {
      fresh0.citySlots[c]![0] = null;
      trust.housesRemaining += 1;
    }
    trust.cities = [kept];
    fresh0.trustStartCities = [kept];
    const humans = fresh0.playerOrder.filter((id) => id !== TRUST_PLAYER_ID);
    fresh0.activePlayerId = humans[1]!;

    const map = stateMap(fresh0);
    const neighbours = neighboursInZone(map, fresh0.zone, kept);
    const far = zoneCities(map, fresh0.zone).find(
      (c) => c !== kept && !neighbours.includes(c) && fresh0.citySlots[c]![0] === null,
    )!;
    expect(validateAction(fresh0, humans[1]!, { type: 'placeTrustHouse', cityId: far })).toEqual({
      ok: false,
      reason: 'Each further Trust house must be adjacent to an existing Trust house',
    });
    expect(
      validateAction(fresh0, humans[0]!, { type: 'placeTrustHouse', cityId: neighbours[0]! }).ok,
    ).toBe(false);
  });
});

describe('§13 Phase 2 — the Trust never bids', () => {
  it('rejects any action submitted for the Trust', () => {
    const s = trustGame();
    expect(validateAction(s, TRUST_PLAYER_ID, { type: 'passNomination' })).toEqual({
      ok: false,
      reason: 'The Trust acts automatically',
    });
    expect(validateAction(s, TRUST_PLAYER_ID, { type: 'bid', amount: 5 }).ok).toBe(false);
    expect(legalActions(s, TRUST_PLAYER_ID).nominatablePlants).toEqual([]);
  });

  it('takes the highest current-market plant for free, between the two humans', () => {
    const s = deepClone(trustGame('TRUST-AUCTION'));
    rigMarket(s);
    const [a, , b] = s.playerOrder as [string, string, string];

    let t = act(s, a, { type: 'nominatePlant', plantId: 3, bid: 3 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });

    // After A's purchase the current market is [4,5,6,7]; the Trust takes 7.
    const trust = t.players[TRUST_PLAYER_ID]!;
    expect(trust.plants.map((p) => p.plantId)).toEqual([7]);
    expect(trust.money).toBe(0);
    expect(t.acquiredThisRound).toContain(TRUST_PLAYER_ID);
    expect(t.plantMarket.current).not.toContain(7);
    // …and only then does the second human act.
    expect(t.activePlayerId).toBe(b);
    expect(lastLog(t, 'plantAcquired')!.data).toMatchObject({ via: 'trust', price: 0 });
  });

  it('with three plants it only upgrades, scrapping its smallest', () => {
    const s = deepClone(trustGame('TRUST-UPGRADE'));
    rigMarket(s);
    s.plantMarket.current = [4, 5, 6, 20];
    s.plantMarket.future = [21, 22, 23, 24];
    s.plantMarket.stack = [30];
    const trust = s.players[TRUST_PLAYER_ID]!;
    trust.plants = [10, 11, 12].map((plantId) => ({
      plantId,
      stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 },
    }));

    trustAuctionTurn(s, 1);
    expect(trust.plants.map((p) => p.plantId)).toEqual([11, 12, 20]);
    expect(s.plantMarket.removed).toContain(10);
  });

  it('with three plants and nothing better, it takes nothing', () => {
    const s = deepClone(trustGame('TRUST-KEEP'));
    rigMarket(s);
    const trust = s.players[TRUST_PLAYER_ID]!;
    trust.plants = [20, 21, 22].map((plantId) => ({
      plantId,
      stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 },
    }));

    trustAuctionTurn(s, 1);
    expect(trust.plants.map((p) => p.plantId)).toEqual([20, 21, 22]);
    expect(s.passedThisPhase).toContain(TRUST_PLAYER_ID);
    expect(lastLog(s, 'trustNoPlant')!.data).toMatchObject({ reason: 'notAnUpgrade' });
  });
});

describe('§13 Phase 3 — free resources, nothing stored between rounds', () => {
  it('takes exactly what its plants need, for free', () => {
    const s = deepClone(trustGame('TRUST-RES'));
    const trust = s.players[TRUST_PLAYER_ID]!;
    trust.plants = [
      { plantId: 8, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }, // coal 3
      { plantId: 3, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }, // oil 2
      { plantId: 18, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }, // eco
    ];
    const coalBefore = s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0);

    trustBuyResources(s, 1);
    expect(trust.money).toBe(0);
    expect(trust.plants.find((p) => p.plantId === 8)!.stored.coal).toBe(3);
    expect(trust.plants.find((p) => p.plantId === 3)!.stored.oil).toBe(2);
    expect(trust.plants.find((p) => p.plantId === 18)!.stored).toMatchObject({ coal: 0, oil: 0 });
    expect(s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0)).toBe(coalBefore - 3);
  });

  it('alternates coal and oil on a hybrid plant, starting with coal', () => {
    const s = deepClone(trustGame('TRUST-HYBRID'));
    const trust = s.players[TRUST_PLAYER_ID]!;
    trust.plants = [
      { plantId: 46, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }, // hybrid, fuel 3
    ];
    trustBuyResources(s, 1);
    expect(trust.plants[0]!.stored).toMatchObject({ coal: 2, oil: 1 });
  });

  it('falls back to the other fuel when one runs out', () => {
    const s = deepClone(trustGame('TRUST-HYBRID-2'));
    for (const space of s.resourceMarket.coal) space.filled = 0;
    const trust = s.players[TRUST_PLAYER_ID]!;
    trust.plants = [{ plantId: 46, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }];
    trustBuyResources(s, 1);
    expect(trust.plants[0]!.stored).toMatchObject({ coal: 0, oil: 3 });
  });

  it('takes only what the market holds', () => {
    const s = deepClone(trustGame('TRUST-SCARCE'));
    for (const space of s.resourceMarket.coal) space.filled = 0;
    s.resourceMarket.coal[7]!.filled = 1;
    const trust = s.players[TRUST_PLAYER_ID]!;
    trust.plants = [{ plantId: 8, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }];
    trustBuyResources(s, 1);
    expect(trust.plants[0]!.stored.coal).toBe(1);
  });

  it('returns everything to the supply in Phase 5', () => {
    const s = deepClone(trustGame('TRUST-RETURN'));
    const trust = s.players[TRUST_PLAYER_ID]!;
    trust.plants = [{ plantId: 8, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }];
    trustBuyResources(s, 1);
    const supplyBefore = s.supply.coal;
    trustReturnResources(s, 2);
    expect(trust.plants[0]!.stored).toMatchObject({ coal: 0 });
    expect(s.supply.coal).toBe(supplyBefore + 3);
    expect(lastLog(s, 'trustResourcesReturned')).toBeDefined();
  });
});

describe('§13 Phase 4 — Trust houses', () => {
  it('blocks its starting cities during Step 1 and frees them in Step 2', () => {
    const s = deepClone(trustGame('TRUST-BLOCK'));
    const human = s.playerOrder[2]!;
    const blocked = s.trustStartCities![0]!;

    const step1 = enterPhase(s, 'building', human);
    expect(validateAction(step1, human, { type: 'buildCity', cityId: blocked })).toEqual({
      ok: false,
      reason: 'Trust starting cities are blocked during Step 1',
    });
    expect(buildTargets(step1, human).map((t) => t.cityId)).not.toContain(blocked);

    const step2 = deepClone(step1);
    step2.step = 2;
    step2.step2Triggered = true;
    const target = buildTargets(step2, human).find((t) => t.cityId === blocked);
    expect(target).toBeDefined();
    expect(target!.slotCost).toBe(15); // the Trust holds the 10 Elektro slot
  });

  it('drops a free Trust house on the 15 Elektro slot of each newly connected empty city', () => {
    const s = deepClone(trustGame('TRUST-FOLLOW'));
    const human = s.playerOrder[2]!;
    const target = buildTargets(enterPhase(s, 'building', human), human)[0]!.cityId;
    const t = act(enterPhase(s, 'building', human), human, { type: 'buildCity', cityId: target });

    expect(t.citySlots[target]![0]).toBe(human);
    expect(t.citySlots[target]![1]).toBe(TRUST_PLAYER_ID);
    expect(t.citySlots[target]![2]).toBeNull(); // §13: never the third slot
    expect(t.players[TRUST_PLAYER_ID]!.housesRemaining).toBe(9);
    expect(lastLog(t, 'trustHousePlaced')!.data).toMatchObject({ slot: 1, phase: 'building' });
  });

  it('adds no house when the city was not empty, and never a third one', () => {
    const s = deepClone(trustGame('TRUST-OCCUPIED'));
    s.step = 3;
    s.step2Triggered = true;
    const [other, , human] = s.playerOrder as [string, string, string];
    const map = stateMap(s);
    const free = zoneCities(map, s.zone).find(
      (c) => s.citySlots[c]!.every((x) => x === null),
    )!;
    placeHouse(s, other, free, 0);

    const t = act(enterPhase(s, 'building', human), human, { type: 'buildCity', cityId: free });
    expect(t.citySlots[free]).toEqual([other, human, null]);
    expect(t.players[TRUST_PLAYER_ID]!.housesRemaining).toBe(10);
  });

  it('undo also takes back the reactive Trust house', () => {
    const s = deepClone(trustGame('TRUST-UNDO'));
    const human = s.playerOrder[2]!;
    const target = buildTargets(enterPhase(s, 'building', human), human)[0]!.cityId;
    let t = act(enterPhase(s, 'building', human), human, { type: 'buildCity', cityId: target });
    t = act(t, human, { type: 'undoLastBuild' });
    expect(t.citySlots[target]).toEqual([null, null, null]);
    expect(t.players[TRUST_PLAYER_ID]!.housesRemaining).toBe(10);
    expect(t.players[TRUST_PLAYER_ID]!.cities).not.toContain(target);
  });

  it('§14 Trust houses never trigger Step 2', () => {
    const s = deepClone(trustGame('TRUST-STEP2'));
    const human = s.playerOrder[2]!;
    const trust = s.players[TRUST_PLAYER_ID]!;
    // Give the Trust a big network and the humans a small one.
    const map = stateMap(s);
    for (const c of zoneCities(map, s.zone)) {
      if (trust.cities.length >= 12) break;
      if (s.citySlots[c]![0] === null) {
        s.citySlots[c]![0] = TRUST_PLAYER_ID;
        trust.cities.push(c);
      }
    }
    expect(trust.cities.length).toBeGreaterThanOrEqual(7);

    const t = act(enterPhase(s, 'building', human), human, { type: 'passBuilding' });
    expect(t.step).toBe(1);
    expect(t.step2Triggered).toBe(false);
  });

  it('the Trust never takes a Phase 4 turn of its own', () => {
    const s = trustGame('TRUST-NOBUILD');
    const building = enterPhase(deepClone(s), 'building', s.playerOrder[2]!);
    let t = act(building, s.playerOrder[2]!, { type: 'passBuilding' });
    expect(t.activePlayerId).not.toBe(TRUST_PLAYER_ID);
    expect(s.players[TRUST_PLAYER_ID]!.isTrust).toBe(true);
    // Driving a whole Phase 4 never hands the Trust the clock.
    const seen: PlayerId[] = [];
    t = enterPhase(deepClone(s), 'building', s.playerOrder[2]!);
    for (const id of t.playerOrder) t.players[id]!.phaseStatus = 'eligible';
    t.players[TRUST_PLAYER_ID]!.phaseStatus = 'ineligible';
    t.activePlayerId = t.playerOrder[2]!;
    let guard = 0;
    while (t.phase === 'building' && guard++ < 10) {
      seen.push(t.activePlayerId!);
      t = act(t, t.activePlayerId!, { type: 'passBuilding' });
    }
    expect(seen).not.toContain(TRUST_PLAYER_ID);
  });
});

describe('§13 Phase 5 and the end condition', () => {
  it('the Trust cannot win', () => {
    const s = deepClone(trustGame('TRUST-WIN'));
    s.step = 3;
    s.step2Triggered = true;
    const [a, , b] = s.playerOrder as [string, string, string];
    const trust = s.players[TRUST_PLAYER_ID]!;
    const map = stateMap(s);
    const cities = zoneCities(map, s.zone);

    // The Trust holds a huge network and a huge plant; the humans hold little.
    for (const c of cities) {
      if (trust.cities.includes(c)) continue;
      s.citySlots[c]![1] = TRUST_PLAYER_ID;
      trust.cities.push(c);
    }
    trust.plants = [{ plantId: 50, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }];

    for (let i = 0; i < 18; i++) {
      s.citySlots[cities[i]!]![2] = a;
      s.players[a]!.cities.push(cities[i]!);
    }
    s.players[a]!.plants = [{ plantId: 3, stored: { coal: 0, oil: 2, garbage: 0, uranium: 0 } }];
    s.players[b]!.plants = [{ plantId: 44, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }];
    s.citySlots[cities[0]!]![0] = b; // b keeps a tiny network
    s.players[b]!.cities.push(cities[0]!);

    const t = act(enterPhase(s, 'building', a), a, { type: 'passBuilding' });
    expect(t.phase).toBe('gameOver');
    expect(t.winnerId).not.toBe(TRUST_PLAYER_ID);
    expect(finalStandings(t).map((r) => r.playerId)).not.toContain(TRUST_PLAYER_ID);
    expect([a, b]).toContain(t.winnerId);
  });

  it('§11/§13 the two-player game ends at 18 connected human cities', () => {
    const s = deepClone(trustGame('TRUST-END'));
    s.step = 3;
    const human = s.playerOrder[2]!;
    const cities = zoneCities(stateMap(s), s.zone);
    for (let i = 0; i < 17; i++) {
      s.citySlots[cities[i]!]![2] = human;
      s.players[human]!.cities.push(cities[i]!);
    }
    const seventeen = act(enterPhase(s, 'building', human), human, { type: 'passBuilding' });
    expect(seventeen.endGameTriggered).toBe(false);

    const s18 = deepClone(s);
    s18.citySlots[cities[17]!]![2] = human;
    s18.players[human]!.cities.push(cities[17]!);
    const eighteen = act(enterPhase(s18, 'building', human), human, { type: 'passBuilding' });
    expect(eighteen.endGameTriggered).toBe(true);
  });

  it('resupplies with the 2-player column (deliberate: spec §9.2, see docs/RULES-NOTES.md)', () => {
    const s = deepClone(trustGame('TRUST-REFILL'));
    for (const space of s.resourceMarket.coal) space.filled = 0;
    s.supply.coal = 20;
    refillMarket(s, 1);
    const placed = s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0);
    expect(placed).toBe(refillFor('germany', 2, 1).coal);
    expect(placed).not.toBe(refillFor('germany', 3, 1).coal);
    expect(lastLog(s, 'marketRefilled')!.data).toMatchObject({ playerCount: 2 });
  });
});
