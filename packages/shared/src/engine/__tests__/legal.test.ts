/**
 * §14 "Legal-action validation" — `legalActions` is the UI's source of truth for
 * greying out illegal choices, so it must agree with `validateAction` exactly.
 * These are oracle tests: enumerate every candidate and compare the two.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId, ResourceType } from '../../types.js';
import { RESOURCE_TYPES } from '../../types.js';
import {
  buildCost,
  canOperate,
  deepClone,
  legalActions,
  purchaseCost,
  stateMap,
  validateAction,
  zoneCities,
} from '../index.js';
import { act, enterPhase, grantPlant, placeHouse, start } from './helpers.js';

const ZONE = ['west', 'southwest', 'east'];

describe('§14 auction enumeration', () => {
  it('offers exactly the plants validateAction accepts', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'LEGAL-AUCTION' }));
    const actor = s.playerOrder[0]!;
    const legal = legalActions(s, actor);
    const offered = new Set(legal.nominatablePlants.map((p) => p.plantId));

    for (const plantId of [...s.plantMarket.current, ...s.plantMarket.future]) {
      const min = plantId === s.plantMarket.discountPlantId ? 1 : plantId;
      const accepted = validateAction(s, actor, { type: 'nominatePlant', plantId, bid: min }).ok;
      expect(offered.has(plantId), `plant ${plantId}`).toBe(accepted);
    }
  });

  it('quotes a minimum bid that validateAction accepts, and rejects one Elektro less', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'LEGAL-MIN' }));
    const actor = s.playerOrder[0]!;
    for (const p of legalActions(s, actor).nominatablePlants) {
      expect(validateAction(s, actor, { type: 'nominatePlant', plantId: p.plantId, bid: p.minimumBid }).ok)
        .toBe(true);
      expect(
        validateAction(s, actor, { type: 'nominatePlant', plantId: p.plantId, bid: p.minimumBid - 1 }).ok,
      ).toBe(false);
    }
  });

  it('reports the legal bid window inside a running auction', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'LEGAL-BID' }));
    const a = s.playerOrder[0]!;
    const plant = legalActions(s, a).nominatablePlants[0]!;
    const t = act(s, a, { type: 'nominatePlant', plantId: plant.plantId, bid: plant.minimumBid });
    const bidder = t.auction!.currentBidderId;
    const bidding = legalActions(t, bidder).bidding!;

    expect(bidding.plantId).toBe(plant.plantId);
    expect(validateAction(t, bidder, { type: 'bid', amount: bidding.minimumRaise }).ok).toBe(true);
    expect(validateAction(t, bidder, { type: 'bid', amount: bidding.currentBid }).ok).toBe(false);
    expect(validateAction(t, bidder, { type: 'bid', amount: bidding.maximumBid + 1 }).ok).toBe(false);
    // Every still-pending eligible player may answer simultaneously.
    const idle = t.playerOrder.find((id: PlayerId) => id !== bidder && id !== a)!;
    expect(legalActions(t, idle).bidding).not.toBeNull();
    expect(legalActions(t, idle).isActive).toBe(true);
    // The auctioneer already submitted their range with the nomination.
    expect(legalActions(t, a).bidding).toBeNull();
  });
});

describe('§14 resource enumeration', () => {
  function shopper(plants: number[]) {
    const s = deepClone(start({ playerCount: 3, seed: 'LEGAL-RES' }));
    const actor = s.playerOrder[2]!;
    for (const id of plants) grantPlant(s, actor, id);
    return { state: enterPhase(s, 'resources', actor), actor };
  }

  it('maxCount is exactly the largest legal purchase', () => {
    const { state, actor } = shopper([5, 8, 14]);
    for (const opt of legalActions(state, actor).resourceOptions) {
      const at = (count: number) =>
        validateAction(state, actor, {
          type: 'buyResources',
          purchases: [{ resource: opt.resource, count }],
        }).ok;
      if (opt.maxCount > 0) {
        expect(at(opt.maxCount), `${opt.resource} @ max`).toBe(true);
      }
      expect(at(opt.maxCount + 1), `${opt.resource} @ max+1`).toBe(false);
    }
  });

  it('costFor matches the market price ladder', () => {
    const { state, actor } = shopper([31]);
    const opt = legalActions(state, actor).resourceOptions.find((o) => o.resource === 'coal')!;
    for (let n = 1; n <= opt.maxCount; n++) {
      expect(opt.costFor[n]).toBe(purchaseCost(state, 'coal', n));
    }
  });

  it('explains why a resource is unavailable', () => {
    const { state, actor } = shopper([13]); // ecological only
    for (const opt of legalActions(state, actor).resourceOptions) {
      expect(opt.maxCount).toBe(0);
      expect(opt.blockedReason).toBe('None of your plants can burn that resource');
    }
  });

  it('offers nothing to a player who is not on the clock', () => {
    const { state, actor } = shopper([31]);
    const idle = state.playerOrder.find((id: PlayerId) => id !== actor)!;
    expect(legalActions(state, idle).resourceOptions).toEqual([]);
    expect(legalActions(state, idle).canPassResources).toBe(false);
  });
});

describe('§14 build enumeration', () => {
  function builder(mutate: (s: GameState, actor: PlayerId) => void = () => {}) {
    const s = deepClone(start({ playerCount: 3, seed: 'LEGAL-BUILD', zone: ZONE }));
    const actor = s.playerOrder[2]!;
    mutate(s, actor);
    return { state: enterPhase(s, 'building', actor), actor };
  }

  it('lists exactly the cities validateAction accepts, with matching totals', () => {
    const { state, actor } = builder((s, a) => {
      placeHouse(s, a, 'essen');
      placeHouse(s, s.playerOrder[0]!, 'koeln');
      s.players[a]!.money = 25;
    });
    const legal = legalActions(state, actor);
    const listed = new Map(legal.buildableCities.map((c) => [c.cityId, c]));

    for (const cityId of zoneCities(stateMap(state), state.zone)) {
      const accepted = validateAction(state, actor, { type: 'buildCity', cityId }).ok;
      const entry = listed.get(cityId);
      // Unaffordable cities are still listed, flagged `affordable: false`.
      expect(entry !== undefined && entry.affordable).toBe(accepted);
      if (entry) {
        expect(entry.total).toBe(buildCost(state, actor, cityId)!.total);
        expect(entry.total).toBe(entry.routeCost + entry.slotCost);
      }
    }
    // Cities outside the zone never appear.
    expect(legal.buildableCities.map((c) => c.cityId)).not.toContain('hamburg');
  });

  it('tracks undo availability across a turn', () => {
    const { state, actor } = builder();
    expect(legalActions(state, actor).canUndoBuild).toBe(false);
    const t = act(state, actor, { type: 'buildCity', cityId: 'essen' });
    expect(legalActions(t, actor).canUndoBuild).toBe(true);
    const u = act(t, actor, { type: 'undoLastBuild' });
    expect(legalActions(u, actor).canUndoBuild).toBe(false);
  });
});

describe('§14 power enumeration', () => {
  it('every listed combination is operable and every payout is right', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'LEGAL-POWER', zone: ZONE }));
    const actor = s.playerOrder[0]!;
    for (const city of ['essen', 'duisburg', 'dortmund', 'muenster']) placeHouse(s, actor, city);
    s.players[actor]!.plants = [
      { plantId: 8, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } }, // 2 cities
      { plantId: 14, stored: { coal: 0, oil: 0, garbage: 2, uranium: 0 } }, // 2 cities
      { plantId: 3, stored: { coal: 0, oil: 1, garbage: 0, uranium: 0 } }, // needs 2 oil
    ];
    const state = enterPhase(s, 'bureaucracy', actor);
    const options = legalActions(state, actor).powerOptions;

    expect(options.length).toBeGreaterThan(0);
    for (const opt of options) {
      expect(canOperate(state, actor, opt.plantIds)).toBe(true);
      expect(
        validateAction(state, actor, {
          type: 'powerCities',
          decision: { operatePlantIds: opt.plantIds, citiesSupplied: opt.maxCities },
        }).ok,
      ).toBe(true);
      expect(
        validateAction(state, actor, {
          type: 'powerCities',
          decision: { operatePlantIds: opt.plantIds, citiesSupplied: opt.maxCities + 1 },
        }).ok,
      ).toBe(false);
    }
    // Plant 3 is one oil short, so it never appears in an operable set.
    expect(options.every((o) => !o.plantIds.includes(3))).toBe(true);
    // The best option burns both fuelled plants for 4 cities.
    expect(options[0]!.plantIds).toEqual([8, 14]);
    expect(options[0]!.maxCities).toBe(4);
  });
});

describe('§14 setup enumeration', () => {
  it('asks only the host for the zone', () => {
    const s = start({ playerCount: 3, seed: 'LEGAL-SETUP' });
    // start() has already completed setup; rewind to the zone stage.
    const rewound = deepClone(s);
    rewound.phase = 'setup';
    rewound.setupStage = 'zoneSelection';
    rewound.zone = [];
    expect(legalActions(rewound, rewound.hostId).zoneRequired).toBe(true);
    const other = rewound.playerOrder.find((id: PlayerId) => id !== rewound.hostId)!;
    expect(legalActions(rewound, other).zoneRequired).toBe(false);
  });

  it('offers legal Trust-house cities only to the seat whose turn it is', () => {
    const s = deepClone(start({ playerCount: 2, againstTheTrust: true, seed: 'LEGAL-TRUST' }));
    s.phase = 'setup';
    s.setupStage = 'trustPlacement';
    const trust = s.players.trust!;
    const kept = trust.cities[0]!;
    for (const c of trust.cities.slice(1)) {
      s.citySlots[c]![0] = null;
      trust.housesRemaining += 1;
    }
    trust.cities = [kept];
    s.trustStartCities = [kept];

    const humans = s.playerOrder.filter((id: PlayerId) => id !== 'trust');
    const seated = legalActions(s, humans[1]!);
    expect(seated.trustHouseCities.length).toBeGreaterThan(0);
    for (const cityId of seated.trustHouseCities) {
      expect(validateAction(s, humans[1]!, { type: 'placeTrustHouse', cityId }).ok).toBe(true);
    }
    expect(legalActions(s, humans[0]!).trustHouseCities).toEqual([]);
  });
});

describe('§14 the enumeration is empty once the game is over', () => {
  it('returns nothing for a finished game', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'LEGAL-OVER' }));
    s.phase = 'gameOver';
    const legal = legalActions(s, s.playerOrder[0]!);
    expect(legal.nominatablePlants).toEqual([]);
    expect(legal.buildableCities).toEqual([]);
    expect(legal.resourceOptions).toEqual([]);
    expect(legal.powerOptions).toEqual([]);
    for (const r of RESOURCE_TYPES as readonly ResourceType[]) {
      expect(legal.resourceOptions.find((o) => o.resource === r)).toBeUndefined();
    }
  });
});
