/**
 * Bot policy — quality of play, not merely legality.
 *
 * `autoplay.test.ts` pins the safety property (nothing ever deadlocks). This
 * suite pins the thing that makes a bot an opponent rather than an obstacle: it
 * plans a whole round at once, so the money it commits in Phase 2 still covers
 * the fuel of Phase 3 and the houses of Phase 4, and it never connects a city it
 * cannot light.
 */

import { describe, expect, it } from 'vitest';
import type { GameAction, GameState, PlayerId } from '../../types.js';
import {
  applyAction,
  bestSupply,
  defaultActionFor,
  endGameThreshold,
  humanPlayers,
  legalActions,
  minimumBid,
  operableCombinations,
  validateAction,
} from '../index.js';
import { NOW, enterPhase, fresh, grantPlant } from './helpers.js';
import { randomZone } from '../setup.js';

function started(opts: Parameters<typeof fresh>[0] = {}): GameState {
  const s = fresh(opts);
  return applyAction(s, s.hostId, { type: 'selectZone', areas: randomZone(s) }, NOW);
}

interface Trace {
  state: GameState;
  turns: number;
  actions: { playerId: PlayerId; action: GameAction }[];
  /** Builds taken beyond production capacity — only the §11 closing move. */
  darkHouses: number;
}

/**
 * Plays a whole game with nothing but bot moves, checking the invariants that
 * must hold at the moment each action is proposed.
 */
function play(state: GameState, maxTurns = 2000): Trace {
  let s = state;
  const actions: { playerId: PlayerId; action: GameAction }[] = [];
  let darkHouses = 0;
  let turns = 0;

  for (; turns < maxTurns; turns++) {
    if (s.phase === 'gameOver') break;
    const actor = s.activePlayerId!;
    const action = defaultActionFor(s, actor);
    if (!action) throw new Error(`no action for ${actor} in phase '${s.phase}'`);

    const verdict = validateAction(s, actor, action);
    if (!verdict.ok) throw new Error(`illegal bot action ${action.type}: ${verdict.reason}`);

    const player = s.players[actor]!;

    if (action.type === 'buildCity') {
      /* §8: a house that cannot be lit is money burnt. `operableCombinations`
         is sorted strongest first and is not capped by network size, so this is
         the production the new house has to fit inside. */
      const capacity = operableCombinations(s, actor)[0]?.capacity ?? 0;
      if (player.cities.length >= capacity) {
        darkHouses += 1;
        // The one exception: reaching the §11 threshold while already ahead on
        // supply wins outright, so the house buys the game rather than power.
        expect(player.cities.length).toBeLessThan(endGameThreshold(s));
        const mine = bestSupply(s, actor).cities;
        for (const rival of humanPlayers(s)) {
          if (rival.id === actor) continue;
          expect(bestSupply(s, rival.id).cities).toBeLessThanOrEqual(mine);
        }
      }
    }

    /* §6: sealed decisions open at the floor and never promise absent money. */
    if (action.type === 'submitBidRange') {
      const bidding = legalActions(s, actor).bidding!;
      expect(action.minBid).toBe(bidding.minimumRaise);
      expect(action.maxBid).toBeGreaterThanOrEqual(action.minBid);
      expect(action.maxBid).toBeLessThanOrEqual(player.money);
    }
    if (action.type === 'nominatePlant') {
      expect(action.bid).toBe(minimumBid(s, action.plantId));
      expect(action.maxBid ?? action.bid).toBeGreaterThanOrEqual(action.bid);
      expect(action.maxBid ?? action.bid).toBeLessThanOrEqual(player.money);
    }

    actions.push({ playerId: actor, action });
    s = applyAction(s, actor, action, NOW + turns);
  }

  return { state: s, turns, actions, darkHouses };
}

describe('bots play the game', () => {
  const trace = play(started({ playerCount: 4, seed: 'BOT-FULL' }));

  it('reaches the end of the game unaided', () => {
    expect(trace.state.phase).toBe('gameOver');
    expect(trace.state.winnerId).toBeTruthy();
    // A real game, not a stampede: §11's threshold takes several rounds to reach.
    expect(trace.state.round).toBeGreaterThan(6);
  });

  it('buys plants, buys fuel and connects cities', () => {
    const used = new Set(trace.actions.map((a) => a.action.type));
    expect(used.has('nominatePlant')).toBe(true);
    expect(used.has('buyResources')).toBe(true);
    expect(used.has('buildCity')).toBe(true);
  });

  it('contests auctions with sealed ranges instead of always passing', () => {
    const answers = trace.actions.filter(
      (a) => a.action.type === 'submitBidRange' || a.action.type === 'passBid',
    );
    const ranges = answers.filter((a) => a.action.type === 'submitBidRange');
    expect(ranges.length).toBeGreaterThan(answers.length / 2);
  });

  it('ends with every seat running a real network', () => {
    for (const player of humanPlayers(trace.state)) {
      expect(player.cities.length).toBeGreaterThan(8);
      expect(player.plants.length).toBeGreaterThan(0);
      expect(bestSupply(trace.state, player.id).cities).toBeGreaterThan(8);
    }
  });

  it('builds almost nothing it cannot power', () => {
    const builds = trace.actions.filter((a) => a.action.type === 'buildCity').length;
    expect(trace.darkHouses * 10).toBeLessThan(builds);
  });

  for (const playerCount of [2, 3, 5, 6]) {
    it(`finishes a ${playerCount}-player game`, () => {
      expect(play(started({ playerCount, seed: `BOT-${playerCount}` })).state.phase).toBe(
        'gameOver',
      );
    });
  }

  it('finishes the 2-player Against the Trust variant', () => {
    const t = play(started({ playerCount: 2, seed: 'BOT-TRUST', againstTheTrust: true }));
    expect(t.state.phase).toBe('gameOver');
  });

  it('finishes an experienced-start game on the USA map', () => {
    const t = play(started({ playerCount: 3, seed: 'BOT-USA', mapId: 'usa', experiencedStart: true }));
    expect(t.state.phase).toBe('gameOver');
  });

  it('is deterministic — the same seed produces the same game', () => {
    const a = play(started({ playerCount: 3, seed: 'BOT-DET' }));
    const b = play(started({ playerCount: 3, seed: 'BOT-DET' }));
    expect(a.turns).toBe(b.turns);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});

describe('the plan is rebuilt from the market it can actually see', () => {
  /**
   * §7: a hybrid burns coal and/or oil. The bot's fuel choice is not baked in —
   * it is re-derived from whatever the market still holds when its turn comes
   * round, which is the case that matters: the resource phase runs in reverse
   * player order, so what the bot planned for may already be gone.
   */
  function hybridInResources(seed: string, money?: number): GameState {
    const base = started({ playerCount: 3, seed });
    const actor = base.playerOrder[0]!;
    const s = enterPhase(base, 'resources', actor);
    grantPlant(s, actor, 5); // hybrid: burns 2 coal and/or oil, holds 4
    if (money !== undefined) s.players[actor]!.money = money;
    return s;
  }

  it('buys the cheaper of the two fuels a hybrid accepts, and fills the hold', () => {
    const s = hybridInResources('BOT-HYBRID-COAL');
    const actor = s.activePlayerId!;
    // Coal opens cheaper than oil (§1 initial market), and spare cash goes into
    // the second round's load rather than sitting idle while prices climb.
    expect(defaultActionFor(s, actor)).toEqual({
      type: 'buyResources',
      purchases: [{ resource: 'coal', count: 4 }],
    });
  });

  it('switches fuel when the one it would have bought is sold out', () => {
    const s = hybridInResources('BOT-HYBRID-OIL');
    for (const space of s.resourceMarket.coal) space.filled = 0;
    const actor = s.activePlayerId!;

    const action = defaultActionFor(s, actor)!;
    expect(validateAction(s, actor, action).ok).toBe(true);
    expect(action).toEqual({
      type: 'buyResources',
      purchases: [{ resource: 'oil', count: 4 }],
    });
  });

  it('stops at one load when the rest of the money is owed to a house', () => {
    // 12₤ buys either a full hold of coal or one operating load plus the 10₤
    // first house (§8). The house wins, because it is what gets powered.
    const s = hybridInResources('BOT-HYBRID-TIGHT', 12);
    const actor = s.activePlayerId!;
    expect(defaultActionFor(s, actor)).toEqual({
      type: 'buyResources',
      purchases: [{ resource: 'coal', count: 2 }],
    });
  });

  it('declines to buy fuel it has no plant for', () => {
    const base = started({ playerCount: 3, seed: 'BOT-NOPLANT' });
    const actor = base.playerOrder[0]!;
    const s = enterPhase(base, 'resources', actor);
    expect(defaultActionFor(s, actor)).toEqual({ type: 'passResources' });
  });
});

describe('houses are capped by what the plants can light', () => {
  /** One ecological plant powering exactly one city, and money to burn. §8, §9.1. */
  function oneCityOfCapacity(seed: string): { state: GameState; actor: PlayerId } {
    const base = started({ playerCount: 3, seed });
    const actor = base.playerOrder[0]!;
    const s = enterPhase(base, 'building', actor);
    grantPlant(s, actor, 13); // ecological: no fuel, powers 1 city
    s.players[actor]!.money = 200;
    return { state: s, actor };
  }

  it('connects exactly as many cities as it can power, then stops', () => {
    const { state, actor } = oneCityOfCapacity('BOT-CAP');

    const first = defaultActionFor(state, actor)!;
    expect(first.type).toBe('buildCity');

    const after = applyAction(state, actor, first, NOW);
    expect(after.players[actor]!.cities).toHaveLength(1);
    // Capacity is spent, so the second answer is to stop — with 190₤ unspent.
    expect(defaultActionFor(after, actor)).toEqual({ type: 'passBuilding' });
    expect(after.players[actor]!.money).toBeGreaterThan(150);
  });

  it('builds nothing at all with no plant to power the house', () => {
    const base = started({ playerCount: 3, seed: 'BOT-NOCAP' });
    const actor = base.playerOrder[0]!;
    const s = enterPhase(base, 'building', actor);
    s.players[actor]!.money = 200;
    expect(defaultActionFor(s, actor)).toEqual({ type: 'passBuilding' });
  });
});

describe('production takes the largest payment available', () => {
  it('powers every city it can', () => {
    const base = started({ playerCount: 3, seed: 'BOT-POWER' });
    const actor = base.playerOrder[0]!;
    const s = enterPhase(base, 'bureaucracy', actor);
    grantPlant(s, actor, 13); // ecological, 1 city
    grantPlant(s, actor, 4); // coal ×2, 1 city
    s.players[actor]!.plants.find((p) => p.plantId === 4)!.stored.coal = 2;
    for (const cityId of Object.keys(s.citySlots).slice(0, 2)) {
      s.citySlots[cityId]![0] = actor;
      s.players[actor]!.cities.push(cityId);
    }

    expect(defaultActionFor(s, actor)).toEqual({
      type: 'powerCities',
      decision: { operatePlantIds: [4, 13], citiesSupplied: 2 },
    });
  });
});
