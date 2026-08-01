/** §9 Phase 5 — Bureaucracy: payouts, finite price-ordered refill, market update. */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../types.js';
import { PAYMENT_TABLE, refillFor } from '../../data/tables.js';
import {
  applyPowerCities,
  bestSupply,
  canOperate,
  deepClone,
  legalActions,
  refillMarket,
  stateMap,
  updatePlantMarket,
  validateAction,
  zoneCities,
} from '../index.js';
import { act, enterPhase, findLog, lastLog, placeHouse, start } from './helpers.js';

function powering(
  build: (s: GameState, actor: PlayerId) => void,
  opts: { mapId?: 'germany' | 'usa'; playerCount?: number } = {},
) {
  const mapId = opts.mapId ?? 'germany';
  const base = start({
    playerCount: opts.playerCount ?? 3,
    seed: 'BUREAU',
    mapId,
    ...(mapId === 'germany' ? { zone: ['west', 'southwest', 'east'] } : {}),
  });
  const s = deepClone(base);
  const actor = s.playerOrder[0]!; // §4: Phase 5 starts with the first player.
  build(s, actor);
  return { state: enterPhase(s, 'bureaucracy', actor), actor };
}

/** Puts `n` free houses in the first cities of the current playing zone. */
function network(s: GameState, id: PlayerId, n: number): void {
  const cities = zoneCities(stateMap(s), s.zone);
  for (let i = 0; i < n; i++) placeHouse(s, id, cities[i]!);
}

describe('§9.1 earning cash', () => {
  it('pays the payment summary for the number of cities supplied', () => {
    const { state, actor } = powering((s, a) => {
      network(s, a, 3);
      s.players[a]!.plants = [
        { plantId: 8, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } }, // 3 coal → 2 cities
      ];
    });
    const t = act(state, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: [8], citiesSupplied: 2 },
    });
    expect(t.players[actor]!.money).toBe(50 + PAYMENT_TABLE[2]!);
    expect(PAYMENT_TABLE[2]).toBe(33);
  });

  it('a player supplying zero cities still receives the guaranteed 10', () => {
    const { state, actor } = powering((s, a) => network(s, a, 3));
    const t = act(state, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: [], citiesSupplied: 0 },
    });
    expect(t.players[actor]!.money).toBe(60);
    expect(PAYMENT_TABLE[0]).toBe(10);
  });

  it('§1 a plant cannot run on less than its exact fuel requirement', () => {
    const { state, actor } = powering((s, a) => {
      network(s, a, 3);
      s.players[a]!.plants = [
        { plantId: 8, stored: { coal: 2, oil: 0, garbage: 0, uranium: 0 } }, // needs 3
      ];
    });
    expect(canOperate(state, actor, [8])).toBe(false);
    expect(validateAction(state, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: [8], citiesSupplied: 1 },
    })).toEqual({ ok: false, reason: 'You do not have the exact fuel those plants require' });
    // §1: no half-fuel for half the cities.
    expect(bestSupply(state, actor).cities).toBe(0);
  });

  it('§1 surplus generation is wasted; a player may supply fewer cities than capacity', () => {
    const { state, actor } = powering((s, a) => {
      network(s, a, 1);
      s.players[a]!.plants = [
        { plantId: 20, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } }, // powers 5
      ];
    });
    // Capacity 5, network 1 → at most 1 city.
    expect(bestSupply(state, actor).cities).toBe(1);
    expect(validateAction(state, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: [20], citiesSupplied: 2 },
    })).toEqual({ ok: false, reason: 'You only have 1 cities in your network' });
    // Deliberately supplying fewer than possible is legal.
    const t = act(state, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: [20], citiesSupplied: 0 },
    });
    expect(t.players[actor]!.money).toBe(60);
  });

  it('rejects supplying more cities than the operated plants can power', () => {
    const { state, actor } = powering((s, a) => {
      network(s, a, 6);
      s.players[a]!.plants = [{ plantId: 8, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } }];
    });
    expect(validateAction(state, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: [8], citiesSupplied: 3 },
    })).toEqual({ ok: false, reason: 'Those plants only power 2 cities' });
  });

  it('§9.1 consumed fuel returns to the SUPPLY, never to the market', () => {
    const { state, actor } = powering((s, a) => {
      network(s, a, 5);
      s.players[a]!.plants = [
        { plantId: 8, stored: { coal: 6, oil: 0, garbage: 0, uranium: 0 } },
        { plantId: 14, stored: { coal: 0, oil: 0, garbage: 2, uranium: 0 } },
      ];
    });
    const s = deepClone(state);
    const marketBefore = s.resourceMarket.coal.map((x) => x.filled);
    const supplyBefore = { ...s.supply };
    applyPowerCities(s, 1, actor, { operatePlantIds: [8, 14], citiesSupplied: 4 });

    expect(s.supply.coal).toBe(supplyBefore.coal + 3);
    expect(s.supply.garbage).toBe(supplyBefore.garbage + 2);
    expect(s.resourceMarket.coal.map((x) => x.filled)).toEqual(marketBefore);
    // The unburnt 3 coal stay on the plant.
    expect(s.players[actor]!.plants.find((p) => p.plantId === 8)!.stored.coal).toBe(3);
    expect(s.players[actor]!.money).toBe(50 + PAYMENT_TABLE[4]!);
  });

  it('§12 burnt coal on the USA map lands in the coal-storage area', () => {
    const { state, actor } = powering(
      (s, a) => {
        network(s, a, 2);
        s.players[a]!.plants = [
          { plantId: 8, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } },
        ];
      },
      { mapId: 'usa' },
    );
    const s = deepClone(state);
    applyPowerCities(s, 1, actor, { operatePlantIds: [8], citiesSupplied: 2 });
    expect(s.usaCoalStorage).toBe(3);
    expect(s.supply.coal).toBe(0);
  });

  it('an ecological plant burns nothing', () => {
    const { state, actor } = powering((s, a) => {
      network(s, a, 2);
      s.players[a]!.plants = [{ plantId: 18, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }];
    });
    expect(canOperate(state, actor, [18])).toBe(true);
    const s = deepClone(state);
    applyPowerCities(s, 1, actor, { operatePlantIds: [18], citiesSupplied: 2 });
    expect(s.supply).toEqual(state.supply);
    expect(s.players[actor]!.money).toBe(50 + PAYMENT_TABLE[2]!);
  });

  it('a hybrid plant runs on any mix totalling its requirement', () => {
    const { state, actor } = powering((s, a) => {
      network(s, a, 4);
      s.players[a]!.plants = [
        { plantId: 21, stored: { coal: 1, oil: 1, garbage: 0, uranium: 0 } }, // hybrid, fuel 2
      ];
    });
    expect(canOperate(state, actor, [21])).toBe(true);
    const options = legalActions(state, actor).powerOptions;
    expect(options[0]!.maxCities).toBe(4);
  });
});

describe('§9.2 resupply', () => {
  function refillState(mutate: (s: GameState) => void, opts = {}) {
    const s = deepClone(start({ playerCount: 3, seed: 'REFILL', ...opts }));
    mutate(s);
    return s;
  }

  it('fills the most expensive empty spaces first', () => {
    const s = refillState((x) => {
      for (const space of x.resourceMarket.coal) space.filled = 0;
      x.supply.coal = 4;
    });
    expect(refillFor('germany', 3, 1).coal).toBe(4);
    refillMarket(s, 1);
    // prices 1..8 → the 8 space fills first (3), then one token on the 7 space.
    expect(s.resourceMarket.coal.map((x) => x.filled)).toEqual([0, 0, 0, 0, 0, 0, 1, 3]);
    expect(s.supply.coal).toBe(0);
  });

  it('uses the uranium ladder from the top down', () => {
    const s = refillState(() => {});
    const prices = s.resourceMarket.uranium.map((x) => x.price);
    expect(s.resourceMarket.uranium[prices.indexOf(12)]!.filled).toBe(0);
    refillMarket(s, 1);
    expect(s.resourceMarket.uranium[prices.indexOf(12)]!.filled).toBe(1);
    expect(s.resourceMarket.uranium[prices.indexOf(10)]!.filled).toBe(0);
  });

  it('is finite: a short supply only partially fills the market', () => {
    const s = refillState((x) => {
      for (const space of x.resourceMarket.oil) space.filled = 0;
      x.supply.oil = 1;
    });
    expect(refillFor('germany', 3, 1).oil).toBe(2);
    refillMarket(s, 1);
    expect(s.supply.oil).toBe(0);
    expect(s.resourceMarket.oil.reduce((a, b) => a + b.filled, 0)).toBe(1);
    expect(lastLog(s, 'marketRefilled')!.data).toMatchObject({ shortfall: { oil: 1 } });
  });

  it('never overflows a full market', () => {
    const s = refillState((x) => {
      x.supply.coal = 10;
    });
    refillMarket(s, 1);
    expect(s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0)).toBe(24);
    expect(s.supply.coal).toBe(10);
  });

  it('is Step-aware', () => {
    const rows = [1, 2, 3].map((step) => {
      const s = refillState((x) => {
        for (const space of x.resourceMarket.coal) space.filled = 0;
        x.supply.coal = 20;
        x.step = step as 1 | 2 | 3;
      });
      refillMarket(s, 1);
      return s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0);
    });
    expect(rows).toEqual([
      refillFor('germany', 3, 1).coal,
      refillFor('germany', 3, 2).coal,
      refillFor('germany', 3, 3).coal,
    ]);
    expect(new Set(rows).size).toBeGreaterThan(1);
  });

  it('is player-count aware', () => {
    const counts = [2, 4, 6].map((playerCount) => {
      const s = deepClone(start({ playerCount, seed: `RC-${playerCount}` }));
      for (const space of s.resourceMarket.garbage) space.filled = 0;
      s.supply.garbage = 20;
      refillMarket(s, 1);
      return s.resourceMarket.garbage.reduce((a, b) => a + b.filled, 0);
    });
    expect(counts).toEqual([
      refillFor('germany', 2, 1).garbage,
      refillFor('germany', 4, 1).garbage,
      refillFor('germany', 6, 1).garbage,
    ]);
  });

  it('§12 USA takes refill coal from the coal-storage area, not the supply', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'USA-REFILL', mapId: 'usa' }));
    for (const space of s.resourceMarket.coal) space.filled = 0;
    s.usaCoalStorage = 10;
    s.supply.coal = 0;
    refillMarket(s, 1);
    const placed = refillFor('usa', 3, 1).coal;
    expect(s.usaCoalStorage).toBe(10 - placed);
    expect(s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0)).toBe(placed);
  });

  it('§12 Germany stops resupplying uranium after the nuclear phase-out', () => {
    const s = deepClone(start({ playerCount: 3, seed: 'PHASEOUT' }));
    s.uraniumPhaseOut = true;
    const before = s.resourceMarket.uranium.map((x) => x.filled);
    refillMarket(s, 1);
    expect(s.resourceMarket.uranium.map((x) => x.filled)).toEqual(before);
    expect(lastLog(s, 'marketRefilled')!.data).toMatchObject({
      uraniumPhaseOut: true,
      shortfall: { uranium: refillFor('germany', 3, 1).uranium },
    });
  });
});

describe('§9.3 update the plant market', () => {
  function marketState(mutate: (s: GameState) => void) {
    const s = deepClone(start({ playerCount: 3, seed: 'MARKET' }));
    s.plantMarket.current = [3, 4, 5, 6];
    s.plantMarket.future = [7, 8, 9, 10];
    s.plantMarket.stack = [20, 21];
    s.plantMarket.removed = [];
    s.plantMarket.discountPlantId = null;
    s.plantMarket.discountReplacementRuleArmed = false;
    mutate(s);
    return s;
  }

  it('Steps 1-2 bury the highest future plant under the stack and draw a replacement', () => {
    const s = marketState(() => {});
    updatePlantMarket(s, 1);
    expect(s.plantMarket.current).toEqual([3, 4, 5, 6]);
    expect(s.plantMarket.future).toEqual([7, 8, 9, 20]);
    expect(s.plantMarket.stack).toEqual([21, 10]); // 10 is now the bottom card
    expect(s.plantMarket.removed).not.toContain(10);
  });

  it('Step 3 removes the smallest current plant from the game and keeps six', () => {
    const s = marketState((x) => {
      x.step = 3;
      x.step2Triggered = true;
      x.plantMarket.current = [10, 11, 12, 13, 14, 15];
      x.plantMarket.future = [];
      x.plantMarket.stack = [30];
    });
    updatePlantMarket(s, 1);
    expect(s.plantMarket.current).toEqual([11, 12, 13, 14, 15, 30]);
    expect(s.plantMarket.future).toEqual([]);
    expect(s.plantMarket.removed).toContain(10);
  });

  it('an exhausted stack removes the smallest plant and draws nothing', () => {
    const s = marketState((x) => {
      x.plantMarket.stack = [];
    });
    updatePlantMarket(s, 1);
    expect(s.plantMarket.removed).toEqual([3]);
    expect([...s.plantMarket.current, ...s.plantMarket.future]).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(findLog(s, 'lowestPlantRemoved')[0]!.data).toMatchObject({ reason: 'stackExhausted' });
  });

  it('the market keeps shrinking on later exhausted turns', () => {
    const s = marketState((x) => {
      x.plantMarket.stack = [];
    });
    updatePlantMarket(s, 1);
    updatePlantMarket(s, 2);
    updatePlantMarket(s, 3);
    expect(s.plantMarket.removed).toEqual([3, 4, 5]);
    expect([...s.plantMarket.current, ...s.plantMarket.future]).toEqual([6, 7, 8, 9, 10]);
  });
});
