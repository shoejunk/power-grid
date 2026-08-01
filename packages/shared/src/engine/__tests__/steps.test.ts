/** §10 Game Steps and transitions. Acceptance 6. */

import { describe, expect, it } from 'vitest';
import type { GameState } from '../../types.js';
import { STEP3_PLANT_ID } from '../../types.js';
import { STEP2_THRESHOLD } from '../../data/tables.js';
import {
  deepClone,
  legalActions,
  stateMap,
  updatePlantMarket,
  zoneCities,
} from '../index.js';
import { act, enterPhase, findLog, lastLog, placeHouse, start } from './helpers.js';

const ZONE = ['west', 'southwest', 'east'];

function rigMarket(s: GameState): void {
  s.plantMarket.current = [3, 4, 5, 6];
  s.plantMarket.future = [7, 8, 9, 10];
  s.plantMarket.stack = [20, 21, 22, 23];
  s.plantMarket.removed = [];
  s.plantMarket.discountPlantId = null;
  s.plantMarket.discountReplacementRuleArmed = false;
}

describe('§10 Step 2', () => {
  it('begins at the start of Phase 5, not during Phase 4', () => {
    const base = start({ playerCount: 3, seed: 'STEP2', zone: ZONE });
    const s = deepClone(base);
    rigMarket(s);
    const actor = s.playerOrder[2]!;
    const cities = zoneCities(stateMap(s), s.zone);
    for (let i = 0; i < 6; i++) placeHouse(s, actor, cities[i]!);
    s.players[actor]!.money = 500;

    let t = enterPhase(s, 'building', actor);
    expect(STEP2_THRESHOLD[3]).toBe(7);

    // Connecting the 7th city does not change the Step mid-phase.
    const seventh = legalActions(t, actor).buildableCities[0]!.cityId;
    t = act(t, actor, { type: 'buildCity', cityId: seventh });
    expect(t.players[actor]!.cities).toHaveLength(7);
    expect(t.phase).toBe('building');
    expect(t.step).toBe(1);

    // Ending Phase 4 starts Phase 5, which starts Step 2.
    t = act(t, actor, { type: 'passBuilding' });
    expect(t.step).toBe(2);
    expect(t.step2Triggered).toBe(true);
    expect(lastLog(t, 'stepChange')!.data).toMatchObject({ step: 2, reason: 'cityThreshold' });
  });

  it('removes the lowest current plant and replaces it exactly once', () => {
    const base = start({ playerCount: 3, seed: 'STEP2-MKT', zone: ZONE });
    const s = deepClone(base);
    rigMarket(s);
    const actor = s.playerOrder[2]!;
    const cities = zoneCities(stateMap(s), s.zone);
    for (let i = 0; i < 7; i++) placeHouse(s, actor, cities[i]!);

    const t = act(enterPhase(s, 'building', actor), actor, { type: 'passBuilding' });
    expect(t.plantMarket.removed).toContain(3);
    // 8 plants before, 8 after: one removed, one drawn.
    expect([...t.plantMarket.current, ...t.plantMarket.future]).toHaveLength(8);
    expect([...t.plantMarket.current, ...t.plantMarket.future]).toContain(20);
  });

  it('the 6-player threshold is 6 cities', () => {
    expect(STEP2_THRESHOLD[6]).toBe(6);
    const base = start({ playerCount: 6, seed: 'STEP2-6P' });
    const s = deepClone(base);
    const actor = s.playerOrder[5]!;
    const cities = zoneCities(stateMap(s), s.zone);
    for (let i = 0; i < 6; i++) placeHouse(s, actor, cities[i]!);
    const t = act(enterPhase(s, 'building', actor), actor, { type: 'passBuilding' });
    expect(t.step).toBe(2);
  });
});

describe('§10 Step 3 drawn during Phase 2', () => {
  function drawStep3InAuction() {
    const base = start({ playerCount: 3, seed: 'STEP3-P2', zone: ZONE });
    const s = deepClone(base);
    rigMarket(s);
    s.round = 2;
    s.plantMarket.stack = [STEP3_PLANT_ID, 20, 21, 22, 23];
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 4, bid: 4 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    return { state: t, a };
  }

  it('places the card at the end of the future market and reshuffles the stack', () => {
    const { state } = drawStep3InAuction();
    expect(state.phase).toBe('auction');
    expect(state.step).toBe(1); // not yet
    expect(state.plantMarket.step3CardRevealed).toBe(true);
    expect(state.plantMarket.future[state.plantMarket.future.length - 1]).toBe(STEP3_PLANT_ID);
    expect(state.plantMarket.current).toEqual([3, 5, 6, 7]);
    expect(state.pendingStep3).toBe('phase2');
    expect(findLog(state, 'step3CardDrawn')).toHaveLength(1);
  });

  it('lets the remaining players finish the phase, but the card is not biddable', () => {
    const { state } = drawStep3InAuction();
    const next = state.activePlayerId!;
    const legal = legalActions(state, next);
    expect(legal.nominatablePlants.map((p) => p.plantId)).toEqual([3, 5, 6, 7]);
    expect(legal.nominatablePlants.map((p) => p.plantId)).not.toContain(STEP3_PLANT_ID);
  });

  it('at the end of Phase 2 removes the lowest current plant and the Step 3 card, then starts Step 3', () => {
    const { state } = drawStep3InAuction();
    let t = state;
    while (t.phase === 'auction') t = act(t, t.activePlayerId!, { type: 'passNomination' });

    // §10: Step 3 begins at Phase 3 of the same round.
    expect(t.phase).toBe('resources');
    expect(t.step).toBe(3);
    expect(t.pendingStep3).toBeNull();

    // Six current plants, no future market.
    expect(t.plantMarket.current).toHaveLength(6);
    expect(t.plantMarket.future).toEqual([]);
    expect(t.plantMarket.current).not.toContain(STEP3_PLANT_ID);
    expect(t.plantMarket.stack).not.toContain(STEP3_PLANT_ID);

    // §10: "If Step 3 begins before Step 2, apply all Step 2 changes first."
    expect(t.step2Triggered).toBe(true);
    expect(t.plantMarket.removed).toContain(3); // Step 2 removal
    expect(t.plantMarket.removed).toContain(5); // Step 3 removal
    expect(lastLog(t, 'stepChange')!.data).toMatchObject({ step: 3 });
  });

  it('reshuffles the remaining stack (the RNG cursor advances)', () => {
    const base = start({ playerCount: 3, seed: 'STEP3-SHUFFLE', zone: ZONE });
    const s = deepClone(base);
    rigMarket(s);
    s.round = 2;
    s.plantMarket.stack = [STEP3_PLANT_ID, 20, 21, 22, 23, 24, 25];
    const before = s.rngCursor;
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 4, bid: 4 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.rngCursor).toBeGreaterThan(before);
  });
});

describe('§10 Step 3 drawn during Phase 5', () => {
  function bureaucracyDraw(step: 1 | 2) {
    const base = start({ playerCount: 3, seed: 'STEP3-P5', zone: ZONE });
    const s = deepClone(base);
    rigMarket(s);
    s.step = step;
    s.step2Triggered = step === 2;
    s.plantMarket.stack = [STEP3_PLANT_ID, 20, 21];
    const actor = s.playerOrder[0]!;
    const t = act(enterPhase(s, 'bureaucracy', actor), actor, {
      type: 'powerCities',
      decision: { operatePlantIds: [], citiesSupplied: 0 },
    });
    return t;
  }

  it('removes the card and the lowest current plant, and starts Step 3 next round', () => {
    const t = bureaucracyDraw(2);
    // finishBureaucracy ran, so we are already in the next round's Phase 2.
    expect(t.round).toBe(2);
    expect(t.step).toBe(3);
    expect(t.plantMarket.current).toHaveLength(6);
    expect(t.plantMarket.future).toEqual([]);
    expect(t.plantMarket.stack).not.toContain(STEP3_PLANT_ID);
    expect(t.pendingStep3).toBeNull();
  });

  it('uses the Step 2 refill values one final time', () => {
    const t = bureaucracyDraw(2);
    const refills = findLog(t, 'marketRefilled');
    expect(refills).toHaveLength(1);
    expect(refills[0]!.data).toMatchObject({ step: 2 });
    // The Step 3 removals happened after the refill, in the market update.
    const order = t.log.map((l) => (l.data as { event?: string } | undefined)?.event);
    expect(order.indexOf('marketRefilled')).toBeLessThan(order.indexOf('step3CardDrawn'));
  });

  it('applies the Step 2 changes first when Step 3 arrives before Step 2', () => {
    const t = bureaucracyDraw(1);
    expect(t.step2Triggered).toBe(true);
    expect(t.step).toBe(3);
    // Two plants left the game — one for Step 2, one for Step 3 — plus the
    // Step 3 card itself, which is recorded so no card goes unaccounted for.
    expect(t.plantMarket.removed).toEqual([3, 4, STEP3_PLANT_ID]);
    expect(t.plantMarket.current).toHaveLength(6);
    const steps = findLog(t, 'stepChange').map((l) => (l.data as { step: number }).step);
    expect(steps).toEqual([2, 3]);
  });

  it('draws no replacement for the Step 3 removals', () => {
    const t = bureaucracyDraw(2);
    // Market update: bury 10, draw Step 3 → no replacement for either removal.
    // Started with 8 plants; ends with 6.
    expect([...t.plantMarket.current, ...t.plantMarket.future]).toHaveLength(6);
  });
});

describe('§10 Step 3 market shape', () => {
  it('keeps six current plants and no future row across market updates', () => {
    const base = start({ playerCount: 3, seed: 'STEP3-SHAPE' });
    const s = deepClone(base);
    s.step = 3;
    s.step2Triggered = true;
    s.plantMarket.current = [11, 12, 13, 14, 15, 16];
    s.plantMarket.future = [];
    s.plantMarket.stack = [40, 42, 44];
    s.plantMarket.removed = [];
    s.plantMarket.discountPlantId = null;
    s.plantMarket.discountReplacementRuleArmed = false;

    updatePlantMarket(s, 1);
    expect(s.plantMarket.current).toHaveLength(6);
    expect(s.plantMarket.future).toEqual([]);
    updatePlantMarket(s, 2);
    expect(s.plantMarket.current).toEqual([13, 14, 15, 16, 40, 42]);
    expect(s.plantMarket.removed).toEqual([11, 12]);
  });
});
