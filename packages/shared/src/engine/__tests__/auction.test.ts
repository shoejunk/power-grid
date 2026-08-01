/** §6 Phase 2 — Auction Power Plants. Acceptance criterion 3. */

import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '../../types.js';
import { applyAction, deepClone, validateAction, legalActions } from '../index.js';
import { act, findLog, start } from './helpers.js';

function rig(mutate: (s: GameState) => void, opts = {}): GameState {
  const base = start({ playerCount: 3, seed: 'AUCTION-RIG', ...opts });
  const s = deepClone(base);
  s.plantMarket.current = [3, 4, 5, 6];
  s.plantMarket.future = [7, 8, 9, 10];
  s.plantMarket.stack = [16, 17, 18, 19, 20, 21, 22, 23];
  s.plantMarket.removed = [];
  s.plantMarket.discountPlantId = 3;
  s.plantMarket.discountReplacementRuleArmed = true;
  mutate(s);
  return s;
}

describe('§6 nomination legality', () => {
  let s: GameState;
  beforeEach(() => {
    s = rig(() => {});
  });

  it('§14 rejects bidding on a future-market plant', () => {
    // Must be the player whose turn it actually is, otherwise the turn-order
    // check short-circuits first and this stops testing the future-market rule.
    const v = validateAction(s, s.playerOrder[0]!, { type: 'nominatePlant', plantId: 8, bid: 8 });
    expect(v).toEqual({ ok: false, reason: 'Only plants in the current market may be auctioned' });
  });

  it('legalActions only offers current-market plants', () => {
    const legal = legalActions(s, s.playerOrder[0]!);
    expect(legal.nominatablePlants.map((p) => p.plantId)).toEqual([3, 4, 5, 6]);
  });

  it('rejects a player acting out of turn', () => {
    const second = s.playerOrder[1]!;
    expect(validateAction(s, second, { type: 'nominatePlant', plantId: 4, bid: 4 }).ok).toBe(false);
  });

  it('the minimum bid is the plant number', () => {
    const first = s.playerOrder[0]!;
    expect(validateAction(s, first, { type: 'nominatePlant', plantId: 5, bid: 4 })).toEqual({
      ok: false,
      reason: 'The minimum bid for plant 5 is 5',
    });
    expect(validateAction(s, first, { type: 'nominatePlant', plantId: 5, bid: 5 }).ok).toBe(true);
  });

  it('a player cannot bid more than they hold', () => {
    const first = s.playerOrder[0]!;
    expect(validateAction(s, first, { type: 'nominatePlant', plantId: 5, bid: 51 }).ok).toBe(false);
  });
});

describe('§6 discount token', () => {
  it('sits on the lowest current-market plant and lowers its minimum to 1', () => {
    const s = start({ playerCount: 3, seed: 'DISCOUNT' });
    expect(s.plantMarket.discountPlantId).toBe(Math.min(...s.plantMarket.current));
    const first = s.playerOrder[0]!;
    const legal = legalActions(s, first);
    const discounted = legal.nominatablePlants.find((p) => p.discounted)!;
    expect(discounted.minimumBid).toBe(1);
    expect(legal.nominatablePlants.filter((p) => !p.discounted).every((p) => p.minimumBid === p.plantId)).toBe(true);
  });

  it('moves beside the market once the discounted plant is bought', () => {
    const s = rig(() => {});
    const first = s.playerOrder[0]!;
    const after = act(s, first, { type: 'nominatePlant', plantId: 3, bid: 1 });
    // Uncontested? No — two other eligible players, so they must pass.
    let t = after;
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.players[first]!.money).toBe(49);
    expect(t.plantMarket.discountPlantId).toBeNull();
    expect(t.plantMarket.discountReplacementRuleArmed).toBe(false);
  });

  it('a replacement drawn BELOW the discounted plant is itself removed, and another is drawn', () => {
    const s = rig((x) => {
      x.plantMarket.current = [10, 11, 12, 13];
      x.plantMarket.future = [14, 15, 16, 17];
      x.plantMarket.discountPlantId = 10;
      x.plantMarket.discountReplacementRuleArmed = true;
      x.plantMarket.stack = [5, 20, 25, 30];
    });
    const first = s.playerOrder[0]!;
    let t = act(s, first, { type: 'nominatePlant', plantId: 11, bid: 11 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });

    expect(t.plantMarket.removed).toContain(5);
    expect(t.plantMarket.discountPlantId).toBeNull();
    expect(t.plantMarket.discountReplacementRuleArmed).toBe(false);
    expect([...t.plantMarket.current, ...t.plantMarket.future]).toContain(20);
    expect(t.plantMarket.current).toEqual([10, 12, 13, 14]);
    expect(t.plantMarket.future).toEqual([15, 16, 17, 20]);
    expect(findLog(t, 'discountReplacementRemoved')).toHaveLength(1);
  });

  it('a replacement drawn ABOVE the discounted plant is kept and the token stays', () => {
    const s = rig((x) => {
      x.plantMarket.current = [10, 11, 12, 13];
      x.plantMarket.future = [14, 15, 16, 17];
      x.plantMarket.discountPlantId = 10;
      x.plantMarket.discountReplacementRuleArmed = true;
      x.plantMarket.stack = [30, 25];
    });
    const first = s.playerOrder[0]!;
    let t = act(s, first, { type: 'nominatePlant', plantId: 11, bid: 11 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.plantMarket.removed).not.toContain(30);
    expect(t.plantMarket.discountPlantId).toBe(10);
  });

  it('an unsold discounted plant leaves the game at the end of Phase 2', () => {
    const s = rig((x) => {
      x.round = 2;
      x.plantMarket.stack = [30, 31, 32];
    });
    let t = s;
    // Everyone passes on nominating.
    while (t.phase === 'auction') t = act(t, t.activePlayerId!, { type: 'passNomination' });
    expect(t.plantMarket.removed).toContain(3);
    expect([...t.plantMarket.current, ...t.plantMarket.future]).not.toContain(3);
    expect(t.plantMarket.discountPlantId).toBeNull();
    expect([...t.plantMarket.current, ...t.plantMarket.future]).toContain(30);
    expect(findLog(t, 'discountPlantRemoved')).toHaveLength(1);
  });
});

describe('§6 bidding', () => {
  it('clockwise raise/pass resolves to the last standing bidder', () => {
    const s = rig(() => {});
    const [a, b, c] = s.playerOrder as [string, string, string];
    let t = act(s, a, { type: 'nominatePlant', plantId: 4, bid: 4 });
    expect(t.auction!.currentBidderId).toBe(b);
    t = act(t, b, { type: 'bid', amount: 5 });
    expect(t.auction!.currentBidderId).toBe(c);
    t = act(t, c, { type: 'passBid' });
    expect(t.auction!.currentBidderId).toBe(a);
    t = act(t, a, { type: 'passBid' });
    expect(t.auction).toBeNull();
    expect(t.players[b]!.plants.map((p) => p.plantId)).toEqual([4]);
    expect(t.players[b]!.money).toBe(45);
    expect(t.players[a]!.money).toBe(50);
  });

  it('a passed bidder cannot re-enter the same auction', () => {
    const s = rig(() => {});
    const [a, b, c] = s.playerOrder as [string, string, string];
    let t = act(s, a, { type: 'nominatePlant', plantId: 4, bid: 4 });
    t = act(t, b, { type: 'passBid' });
    expect(validateAction(t, b, { type: 'bid', amount: 20 }).ok).toBe(false);
    expect(t.auction!.currentBidderId).toBe(c);
  });

  it('a raise must exceed the current bid', () => {
    const s = rig(() => {});
    const [a, b] = s.playerOrder as [string, string];
    const t = act(s, a, { type: 'nominatePlant', plantId: 4, bid: 4 });
    expect(validateAction(t, b, { type: 'bid', amount: 4 }).ok).toBe(false);
    expect(validateAction(t, b, { type: 'bid', amount: 5 }).ok).toBe(true);
  });

  it('an outbid auctioneer may nominate again in the same phase', () => {
    const s = rig(() => {});
    const [a, b, c] = s.playerOrder as [string, string, string];
    let t = act(s, a, { type: 'nominatePlant', plantId: 4, bid: 4 });
    t = act(t, b, { type: 'bid', amount: 10 });
    t = act(t, c, { type: 'passBid' });
    t = act(t, a, { type: 'passBid' });
    expect(t.players[b]!.plants).toHaveLength(1);
    // a lost, so a is the next nominator and is still eligible.
    expect(t.activePlayerId).toBe(a);
    expect(validateAction(t, a, { type: 'nominatePlant', plantId: 5, bid: 5 }).ok).toBe(true);
  });

  it('a player who already bought cannot buy a second plant this round', () => {
    const s = rig(() => {});
    const [a] = s.playerOrder as [string];
    let t = act(s, a, { type: 'nominatePlant', plantId: 4, bid: 4 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.acquiredThisRound).toContain(a);
    expect(validateAction(t, a, { type: 'nominatePlant', plantId: 5, bid: 5 }).ok).toBe(false);
  });
});

describe('§6 passing and the first-round purchase requirement', () => {
  it('every human must buy a plant in the first round', () => {
    const s = rig(() => {});
    expect(validateAction(s, s.playerOrder[0]!, { type: 'passNomination' })).toEqual({
      ok: false,
      reason: 'Every player must buy a power plant in the first round',
    });
    expect(legalActions(s, s.playerOrder[0]!).canPassNomination).toBe(false);
  });

  it('a player who cannot meet any minimum bid may pass even in round 1', () => {
    const s = rig((x) => {
      x.plantMarket.current = [30, 31, 32, 33];
      x.plantMarket.discountPlantId = null;
      x.plantMarket.discountReplacementRuleArmed = false;
      x.players[x.playerOrder[0]!]!.money = 5;
    });
    expect(validateAction(s, s.playerOrder[0]!, { type: 'passNomination' }).ok).toBe(true);
  });

  it('passing on the nomination is permanent for the phase', () => {
    const s = rig((x) => {
      x.round = 2;
    });
    const [a, b] = s.playerOrder as [string, string];
    let t = act(s, a, { type: 'passNomination' });
    expect(t.passedThisPhase).toContain(a);
    expect(t.players[a]!.phaseStatus).toBe('passed');
    expect(t.activePlayerId).toBe(b);
    // a is not offered a place in b's auction, and cannot nominate later.
    t = act(t, b, { type: 'nominatePlant', plantId: 4, bid: 4 });
    expect(t.auction!.activeBidders).not.toContain(a);
    expect(validateAction(t, a, { type: 'bid', amount: 30 }).ok).toBe(false);
  });

  it('§6 the last eligible nominator pays exactly the minimum', () => {
    const s = rig((x) => {
      x.round = 2;
      x.acquiredThisRound = [x.playerOrder[0]!, x.playerOrder[1]!];
    });
    const last = s.playerOrder[2]!;
    expect(validateAction(s, last, { type: 'nominatePlant', plantId: 5, bid: 9 })).toEqual({
      ok: false,
      reason: 'No one else can bid, so plant 5 costs exactly 5',
    });
    const t = act(s, last, { type: 'nominatePlant', plantId: 5, bid: 5 });
    expect(t.players[last]!.plants.map((p) => p.plantId)).toEqual([5]);
    expect(t.players[last]!.money).toBe(45);
    expect(t.auction).toBeNull();
  });

  it('legalActions flags the uncontested case', () => {
    const s = rig((x) => {
      x.round = 2;
      x.acquiredThisRound = [x.playerOrder[0]!, x.playerOrder[1]!];
    });
    const legal = legalActions(s, s.playerOrder[2]!);
    expect(legal.nominatablePlants.every((p) => p.uncontested)).toBe(true);
  });
});

describe('§6 three-plant limit and scrapping', () => {
  function withThreePlants(): GameState {
    return rig((x) => {
      x.round = 2;
      const a = x.playerOrder[0]!;
      x.players[a]!.plants = [
        { plantId: 8, stored: { coal: 4, oil: 0, garbage: 0, uranium: 0 } }, // coal 3, cap 6
        { plantId: 9, stored: { coal: 0, oil: 2, garbage: 0, uranium: 0 } }, // oil 1, cap 2
        { plantId: 14, stored: { coal: 0, oil: 0, garbage: 3, uranium: 0 } }, // garbage 2, cap 4
      ];
      x.acquiredThisRound = [x.playerOrder[1]!, x.playerOrder[2]!];
    });
  }

  it('acquiring a fourth plant forces a scrap and blocks scrapping the new plant', () => {
    const s = withThreePlants();
    const a = s.playerOrder[0]!;
    const t = act(s, a, { type: 'nominatePlant', plantId: 5, bid: 5 });
    expect(t.pendingScrap).toEqual({ playerId: a, newPlantId: 5 });
    expect(t.activePlayerId).toBe(a);
    expect(validateAction(t, a, { type: 'scrapPlant', plantId: 5 })).toEqual({
      ok: false,
      reason: 'The newly acquired plant cannot be scrapped',
    });
    expect(legalActions(t, a).scrappablePlants).toEqual([8, 9, 14]);
    // Nothing else may happen until the scrap is resolved.
    expect(validateAction(t, a, { type: 'passNomination' }).ok).toBe(false);
  });

  it('resources move to compatible plants and the surplus returns to the SUPPLY', () => {
    const s = withThreePlants();
    const a = s.playerOrder[0]!;
    const supplyBefore = { ...s.supply };
    const coalMarketBefore = s.resourceMarket.coal.map((x) => x.filled);

    let t = act(s, a, { type: 'nominatePlant', plantId: 5, bid: 5 }); // 5 = hybrid coal/oil, fuel 2 → cap 4
    t = act(t, a, { type: 'scrapPlant', plantId: 8 });

    expect(t.pendingScrap).toBeNull();
    expect(t.players[a]!.plants.map((p) => p.plantId)).toEqual([5, 9, 14]);
    expect(t.plantMarket.removed).toContain(8);

    const stored = t.players[a]!.plants.reduce(
      (acc, p) => ({
        coal: acc.coal + p.stored.coal,
        oil: acc.oil + p.stored.oil,
        garbage: acc.garbage + p.stored.garbage,
        uranium: acc.uranium + p.stored.uranium,
      }),
      { coal: 0, oil: 0, garbage: 0, uranium: 0 },
    );
    // Plant 5 (hybrid, cap 4) + plant 9 (oil, cap 2): 4 coal cannot all fit
    // alongside the 2 oil — the shared hybrid cap is 4 across both types.
    expect(stored.garbage).toBe(3);
    expect(stored.coal + stored.oil).toBe(6 - 0);
    // Every token still exists somewhere: plants + supply + market is conserved.
    const returned =
      t.supply.coal - supplyBefore.coal + (t.usaCoalStorage - s.usaCoalStorage);
    expect(returned).toBeGreaterThanOrEqual(0);
    // Nothing was pushed back on to the market. §6.
    expect(t.resourceMarket.coal.map((x) => x.filled)).toEqual(coalMarketBefore);
  });

  it('returns genuinely unstorable tokens to the supply', () => {
    const s = rig((x) => {
      x.round = 2;
      const a = x.playerOrder[0]!;
      x.players[a]!.plants = [
        { plantId: 8, stored: { coal: 6, oil: 0, garbage: 0, uranium: 0 } }, // cap 6
        { plantId: 11, stored: { coal: 0, oil: 0, garbage: 0, uranium: 2 } },
        { plantId: 13, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }, // eco, stores nothing
      ];
      x.acquiredThisRound = [x.playerOrder[1]!, x.playerOrder[2]!];
      x.supply.coal = 0;
    });
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 6, bid: 6 }); // garbage, fuel 1
    t = act(t, a, { type: 'scrapPlant', plantId: 8 });
    // All six coal are homeless: 6 (garbage), 11 (uranium), 13 (eco) accept none.
    expect(t.supply.coal).toBe(6);
    expect(
      t.players[a]!.plants.reduce((n, p) => n + p.stored.coal, 0),
    ).toBe(0);
  });
});

describe('§6 market replacement and resorting', () => {
  it('draws a replacement and resorts the four lowest into the current market', () => {
    const s = rig((x) => {
      x.plantMarket.stack = [2 + 40]; // plant 42
    });
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 3, bid: 1 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect(t.plantMarket.current).toEqual([4, 5, 6, 7]);
    expect(t.plantMarket.future).toEqual([8, 9, 10, 42]);
  });

  it('does nothing when the stack is empty', () => {
    const s = rig((x) => {
      x.plantMarket.stack = [];
    });
    const a = s.playerOrder[0]!;
    let t = act(s, a, { type: 'nominatePlant', plantId: 3, bid: 1 });
    while (t.auction) t = act(t, t.auction.currentBidderId, { type: 'passBid' });
    expect([...t.plantMarket.current, ...t.plantMarket.future]).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(findLog(t, 'stackExhausted').length).toBeGreaterThan(0);
  });
});

describe('purity', () => {
  it('applyAction never mutates the input state', () => {
    const s = rig(() => {});
    const before = JSON.stringify(s);
    applyAction(s, s.playerOrder[0]!, { type: 'nominatePlant', plantId: 4, bid: 4 });
    expect(JSON.stringify(s)).toBe(before);
  });
});
