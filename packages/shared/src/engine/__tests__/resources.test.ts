/** §7 Phase 3 — Buy Resources, §1 storage rules, §12 USA coal. Acceptance 3. */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../types.js';
import {
  deepClone,
  freeStorage,
  legalActions,
  purchaseCost,
  returnResource,
  storedPool,
  validateAction,
} from '../index.js';
import { act, enterPhase, grantPlant, start } from './helpers.js';

/** A Phase 3 state where `plants` belong to the player on the clock. */
function shopping(plants: number[], opts: { mapId?: 'germany' | 'usa'; money?: number } = {}) {
  const base = start({ playerCount: 3, seed: 'RES', mapId: opts.mapId ?? 'germany' });
  const s = deepClone(base);
  const actor = s.playerOrder[2]!; // Phase 3 starts with the last player. §4.
  for (const id of plants) grantPlant(s, actor, id);
  if (opts.money !== undefined) s.players[actor]!.money = opts.money;
  return { state: enterPhase(s, 'resources', actor), actor };
}

const buy = (resource: string, count: number) =>
  ({ type: 'buyResources', purchases: [{ resource, count }] }) as never;

describe('§1 storage capacity', () => {
  it('a plant stores at most twice its fuel requirement', () => {
    const { state, actor } = shopping([8]); // coal, fuel 3 → capacity 6
    expect(validateAction(state, actor, buy('coal', 6)).ok).toBe(true);
    expect(validateAction(state, actor, buy('coal', 7))).toEqual({
      ok: false,
      reason: 'Your plants cannot store that many tokens',
    });
    expect(freeStorage(state, actor).coal).toBe(6);
  });

  it('a hybrid plant shares one limit across coal AND oil, not one per type', () => {
    const { state, actor } = shopping([5]); // hybrid coal/oil, fuel 2 → capacity 4 total
    expect(freeStorage(state, actor).coal).toBe(4);
    expect(freeStorage(state, actor).oil).toBe(4);

    // 4 coal fills it completely — no room for a single extra oil.
    const full = act(state, actor, buy('coal', 4));
    expect(storedPool(full, actor)).toMatchObject({ coal: 4, oil: 0 });
    expect(validateAction(full, actor, buy('oil', 1)).ok).toBe(false);

    // A 2+2 split is legal, 3+2 is not.
    expect(
      validateAction(state, actor, {
        type: 'buyResources',
        purchases: [
          { resource: 'coal', count: 2 },
          { resource: 'oil', count: 2 },
        ],
      }).ok,
    ).toBe(true);
    expect(
      validateAction(state, actor, {
        type: 'buyResources',
        purchases: [
          { resource: 'coal', count: 3 },
          { resource: 'oil', count: 2 },
        ],
      }).ok,
    ).toBe(false);
  });

  it('an ecological plant stores nothing at all', () => {
    const { state, actor } = shopping([13]); // eco, fuel 0
    for (const r of ['coal', 'oil', 'garbage', 'uranium'] as const) {
      expect(validateAction(state, actor, buy(r, 1)).ok).toBe(false);
      expect(freeStorage(state, actor)[r]).toBe(0);
    }
    expect(legalActions(state, actor).resourceOptions.every((o) => o.maxCount === 0)).toBe(true);
  });

  it('two plants pool their capacity but keep their type restrictions', () => {
    const { state, actor } = shopping([8, 14]); // coal cap 6, garbage cap 4
    expect(freeStorage(state, actor).coal).toBe(6);
    expect(freeStorage(state, actor).garbage).toBe(4);
    expect(freeStorage(state, actor).oil).toBe(0);
    const t = act(state, actor, buy('coal', 6));
    expect(t.players[actor]!.plants.find((p) => p.plantId === 8)!.stored.coal).toBe(6);
  });
});

describe('§7 purchase legality', () => {
  it('§14 refuses resources no owned plant can burn', () => {
    const { state, actor } = shopping([8]);
    expect(validateAction(state, actor, buy('uranium', 1))).toEqual({
      ok: false,
      reason: 'None of your plants can burn uranium',
    });
  });

  it('charges the printed price of each market space, cheapest first', () => {
    const { state, actor } = shopping([31]); // coal, fuel 3 → capacity 6
    expect(purchaseCost(state, 'coal', 3)).toBe(3); // 3 × price 1
    expect(purchaseCost(state, 'coal', 4)).toBe(5); // + price 2
    expect(purchaseCost(state, 'coal', 6)).toBe(9); // 3×1 + 3×2
    const t = act(state, actor, buy('coal', 4));
    expect(t.players[actor]!.money).toBe(45);
    expect(t.resourceMarket.coal[0]!.filled).toBe(0);
    expect(t.resourceMarket.coal[1]!.filled).toBe(2);
  });

  it('prices uranium off its own ladder', () => {
    const { state } = shopping([39]);
    expect(purchaseCost(state, 'uranium', 1)).toBe(14);
    expect(purchaseCost(state, 'uranium', 2)).toBe(30);
    expect(purchaseCost(state, 'uranium', 3)).toBeNull();
  });

  it('refuses a purchase the player cannot afford', () => {
    const { state, actor } = shopping([39], { money: 13 });
    expect(validateAction(state, actor, buy('uranium', 1)).ok).toBe(false);
    expect(legalActions(state, actor).resourceOptions.find((o) => o.resource === 'uranium')!.maxCount).toBe(0);
  });

  it('§14 refuses a depleted market resource', () => {
    const { state, actor } = shopping([8]);
    const dry = deepClone(state);
    for (const space of dry.resourceMarket.coal) space.filled = 0;
    expect(validateAction(dry, actor, buy('coal', 1))).toEqual({
      ok: false,
      reason: 'coal is sold out until the next resupply',
    });
    expect(legalActions(dry, actor).resourceOptions.find((o) => o.resource === 'coal')!.blockedReason)
      .toBe('coal is sold out until the next resupply');
  });

  it('caps a purchase at what the market actually holds', () => {
    const { state, actor } = shopping([36]); // coal, fuel 3 → capacity 6
    const scarce = deepClone(state);
    for (const space of scarce.resourceMarket.coal) space.filled = 0;
    scarce.resourceMarket.coal[7]!.filled = 2;
    expect(validateAction(scarce, actor, buy('coal', 3))).toEqual({
      ok: false,
      reason: 'Only 2 coal available',
    });
    expect(validateAction(scarce, actor, buy('coal', 2)).ok).toBe(true);
  });
});

describe('§12 USA separate coal storage', () => {
  it('sells storage coal at 8 Elektro once the market is dry, and never before', () => {
    const { state, actor } = shopping([36], { mapId: 'usa' });
    const s = deepClone(state);
    // While market coal remains, storage is not reachable.
    s.usaCoalStorage = 5;
    expect(purchaseCost(s, 'coal', 1)).toBe(1);

    for (const space of s.resourceMarket.coal) space.filled = 0;
    expect(purchaseCost(s, 'coal', 1)).toBe(8);
    expect(purchaseCost(s, 'coal', 5)).toBe(40);
    expect(purchaseCost(s, 'coal', 6)).toBeNull();

    const t = act(s, actor, buy('coal', 3));
    expect(t.usaCoalStorage).toBe(2);
    expect(t.players[actor]!.money).toBe(50 - 24);
    expect(
      legalActions(t, actor).resourceOptions.find((o) => o.resource === 'coal')!.fromUsaCoalStorage,
    ).toBe(true);
  });

  it('burnt coal goes into storage on the USA map and into the supply on Germany', () => {
    const usa = deepClone(start({ playerCount: 3, seed: 'USA-BURN', mapId: 'usa' }));
    returnResource(usa, 'coal', 4);
    expect(usa.usaCoalStorage).toBe(4);
    expect(usa.supply.coal).toBe(0);

    const de = deepClone(start({ playerCount: 3, seed: 'DE-BURN' }));
    returnResource(de, 'coal', 4);
    expect(de.usaCoalStorage).toBe(0);
    expect(de.supply.coal).toBe(4);
  });
});

describe('§7 rearranging stored tokens', () => {
  it('accepts a legal reassignment and rejects one that breaks a limit', () => {
    const { state, actor } = shopping([5, 8]); // hybrid cap 4, coal cap 6
    const t = act(state, actor, buy('coal', 6));
    const total = storedPool(t, actor).coal;
    expect(total).toBe(6);

    const legalAssignment = {
      type: 'redistributeResources',
      assignment: [
        { plantId: 5, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } },
        { plantId: 8, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } },
      ],
    } as never;
    expect(validateAction(t, actor, legalAssignment).ok).toBe(true);

    const overflowing = {
      type: 'redistributeResources',
      assignment: [
        { plantId: 5, stored: { coal: 6, oil: 0, garbage: 0, uranium: 0 } },
        { plantId: 8, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } },
      ],
    } as never;
    expect(validateAction(t, actor, overflowing)).toEqual({
      ok: false,
      reason: 'Plant 5 can only store 4 tokens',
    });

    const losingTokens = {
      type: 'redistributeResources',
      assignment: [
        { plantId: 5, stored: { coal: 1, oil: 0, garbage: 0, uranium: 0 } },
        { plantId: 8, stored: { coal: 1, oil: 0, garbage: 0, uranium: 0 } },
      ],
    } as never;
    expect(validateAction(t, actor, losingTokens).ok).toBe(false);
  });
});

describe('§7 turn handling', () => {
  it('a player may buy repeatedly before passing', () => {
    const { state, actor } = shopping([31]);
    let t = act(state, actor, buy('coal', 2));
    t = act(t, actor, buy('coal', 2));
    expect(storedPool(t, actor).coal).toBe(4);
    expect(t.activePlayerId).toBe(actor);
    t = act(t, actor, { type: 'passResources' });
    expect(t.phase).toBe('building');
  });

  it('a player who is not on the clock cannot buy', () => {
    const { state, actor } = shopping([31]);
    const other = state.playerOrder.find((id: PlayerId) => id !== actor)!;
    expect(validateAction(state, other, buy('coal', 1)).ok).toBe(false);
  });
});
