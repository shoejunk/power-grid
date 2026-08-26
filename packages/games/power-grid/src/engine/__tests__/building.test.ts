/**
 * §8 Phase 4 — Build Houses, on the shipped Germany map. Acceptance 4.
 *
 * Zone: West + Southwest + East. Relevant printed costs used below:
 *   essen–duisburg 0, essen–duesseldorf 2, essen–dortmund 4, muenster–essen 6,
 *   duesseldorf–koeln 4, duesseldorf–aachen 9, aachen–koeln 7,
 *   wiesbaden–frankfurt-m 0, halle–leipzig 0.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../types.js';
import {
  buildCost,
  buildTargets,
  deepClone,
  hasUnclaimedStartCityMarker,
  legalActions,
  stateMap,
  validateAction,
} from '../index.js';
import { act, enterPhase, placeHouse, start } from './helpers.js';

const ZONE = ['west', 'southwest', 'east'];

function builder(mutate: (s: GameState, actor: PlayerId) => void = () => {}) {
  const base = start({ playerCount: 3, seed: 'BUILD', zone: ZONE });
  const s = deepClone(base);
  const actor = s.playerOrder[2]!;
  mutate(s, actor);
  return { state: enterPhase(s, 'building', actor), actor };
}

const build = (cityId: string) => ({ type: 'buildCity', cityId }) as never;

describe('§8 starting a network', () => {
  it('the first house costs 10 with no connection cost', () => {
    const { state, actor } = builder();
    expect(buildCost(state, actor, 'essen')).toEqual({
      routeCost: 0,
      slot: 0,
      slotCost: 10,
      total: 10,
    });
    const t = act(state, actor, build('essen'));
    expect(t.players[actor]!.money).toBe(40);
    expect(t.players[actor]!.cities).toEqual(['essen']);
    expect(t.players[actor]!.hasNetwork).toBe(true);
    expect(t.players[actor]!.housesRemaining).toBe(21);
    expect(t.citySlots.essen).toEqual([actor, null, null]);
  });

  it('every zone city is a legal opening move, and none outside it', () => {
    const { state, actor } = builder();
    const targets = buildTargets(state, actor);
    expect(targets).toHaveLength(21); // 3 areas × 7 cities
    expect(targets.every((t) => t.total === 10)).toBe(true);
    expect(targets.map((t) => t.cityId)).not.toContain('hamburg');
  });

  it('§14 rejects building outside the playing zone', () => {
    const { state, actor } = builder();
    expect(validateAction(state, actor, build('hannover'))).toEqual({
      ok: false,
      reason: 'That city is outside the playing zone',
    });
    expect(buildCost(state, actor, 'hannover')).toBeNull();
  });

  it('requires different first-city regions and keeps a network in its region during Step 1', () => {
    const { state, actor } = builder();
    let t = act(state, actor, build('essen'));

    expect(validateAction(t, actor, build('duisburg')).ok).toBe(true);
    expect(validateAction(t, actor, build('aachen'))).toEqual({
      ok: false,
      reason: 'During Step 1, you may only build in your starting region',
    });

    const next = deepClone(t);
    const nextPlayer = next.playerOrder[0]!;
    next.activePlayerId = nextPlayer;
    next.players[nextPlayer]!.phaseStatus = 'acting';
    expect(validateAction(next, nextPlayer, build('duisburg'))).toEqual({
      ok: false,
      reason: "Your first city must be in a different region from every other player's first city",
    });
    expect(validateAction(next, nextPlayer, build('aachen')).ok).toBe(true);

    next.step = 2;
    next.step2Triggered = true;
    expect(validateAction(next, nextPlayer, build('duisburg'))).toEqual({
      ok: false,
      reason: "Your first city must be in a different region from every other player's first city",
    });

    t = deepClone(t);
    t.step = 2;
    t.step2Triggered = true;
    expect(validateAction(t, actor, build('aachen')).ok).toBe(true);
  });
});

describe('§8 connection costs', () => {
  it('honours zero-cost connections', () => {
    const { state, actor } = builder((s, a) => placeHouse(s, a, 'essen'));
    expect(buildCost(state, actor, 'duisburg')!.routeCost).toBe(0);
    expect(buildCost(state, actor, 'duisburg')!.total).toBe(10);
    const t = act(state, actor, build('duisburg'));
    expect(t.players[actor]!.money).toBe(40);
  });

  it('finds the cheapest multi-hop route and may pass through unbuilt cities', () => {
    const { state, actor } = builder((s, a) => {
      s.step = 2;
      s.step2Triggered = true;
      placeHouse(s, a, 'essen');
    });
    // The rulebook's own example: Aachen for 10 + 9 + 2 via Düsseldorf.
    expect(buildCost(state, actor, 'aachen')).toEqual({
      routeCost: 11,
      slot: 0,
      slotCost: 10,
      total: 21,
    });
    const t = act(state, actor, build('aachen'));
    expect(t.players[actor]!.money).toBe(29);
    // Düsseldorf was only traversed, not occupied.
    expect(t.citySlots.duesseldorf).toEqual([null, null, null]);
    expect(t.players[actor]!.cities).toEqual(['essen', 'aachen']);
  });

  it('routes from every city in the network, not just the first', () => {
    const { state, actor } = builder((s, a) => {
      placeHouse(s, a, 'essen');
      placeHouse(s, a, 'aachen');
    });
    // Köln: 6 via Essen→Düsseldorf→Köln beats 7 direct from Aachen.
    expect(buildCost(state, actor, 'koeln')!.routeCost).toBe(6);
  });

  it('cities connected earlier in the same turn become new route origins', () => {
    const { state, actor } = builder((s) => {
      s.step = 2;
      s.step2Triggered = true;
    });
    let t = act(state, actor, build('essen')); // 10
    expect(buildCost(t, actor, 'aachen')!.total).toBe(21);
    t = act(t, actor, build('duesseldorf')); // 2 + 10 = 12
    // Düsseldorf is now an origin, so Aachen costs 9 + 10 instead of 11 + 10.
    expect(buildCost(t, actor, 'aachen')).toEqual({
      routeCost: 9,
      slot: 0,
      slotCost: 10,
      total: 19,
    });
    t = act(t, actor, build('aachen'));
    expect(t.players[actor]!.money).toBe(50 - 10 - 12 - 19);
  });

  it('§8 pays the route again in full even when an edge was already traversed', () => {
    const { state, actor } = builder((s, a) => {
      s.step = 2;
      s.step2Triggered = true;
      placeHouse(s, a, 'essen');
    });
    let t = act(state, actor, build('aachen')); // 11 + 10, traverses Essen–Düsseldorf
    expect(t.players[actor]!.money).toBe(29);
    t = act(t, actor, build('duesseldorf')); // pays the same edge again: 2 + 10
    expect(t.players[actor]!.money).toBe(17);
  });

  it('refuses a city the player cannot pay for', () => {
    const { state, actor } = builder((s, a) => {
      s.step = 2;
      s.step2Triggered = true;
      placeHouse(s, a, 'essen');
      s.players[a]!.money = 20;
    });
    expect(validateAction(state, actor, build('aachen'))).toEqual({
      ok: false,
      reason: 'Connecting aachen costs 21 Elektro; you have 20',
    });
    expect(legalActions(state, actor).buildableCities.find((c) => c.cityId === 'aachen')!.affordable)
      .toBe(false);
  });
});

describe('§8/§10 slot costs and Step capacity', () => {
  it('Step 1 allows only one house per city', () => {
    const { state, actor } = builder((s) => {
      const other = s.playerOrder[0]!;
      placeHouse(s, other, 'fulda');
      placeHouse(s, other, 'essen');
    });
    expect(state.step).toBe(1);
    expect(validateAction(state, actor, build('essen'))).toEqual({
      ok: false,
      reason: 'That city has no empty slot at the current Step',
    });
    expect(buildTargets(state, actor).map((t) => t.cityId)).not.toContain('essen');
  });

  it('Step 2 opens the 15 Elektro slot', () => {
    const { state, actor } = builder((s) => {
      s.step = 2;
      s.step2Triggered = true;
      placeHouse(s, s.playerOrder[0]!, 'fulda');
      placeHouse(s, s.playerOrder[0]!, 'essen');
    });
    expect(buildCost(state, actor, 'essen')).toEqual({
      routeCost: 0,
      slot: 1,
      slotCost: 15,
      total: 15,
    });
    const t = act(state, actor, build('essen'));
    expect(t.players[actor]!.money).toBe(35);
    expect(t.citySlots.essen![1]).toBe(actor);
  });

  it('Step 3 opens the 20 Elektro slot and Step 2 rules still price slots 1 and 2', () => {
    const { state, actor } = builder((s) => {
      s.step = 3;
      s.step2Triggered = true;
      placeHouse(s, s.playerOrder[0]!, 'fulda');
      placeHouse(s, s.playerOrder[0]!, 'essen', 0);
      placeHouse(s, s.playerOrder[1]!, 'aachen');
      placeHouse(s, s.playerOrder[1]!, 'essen', 1);
    });
    expect(buildCost(state, actor, 'essen')!.slotCost).toBe(20);
    const t = act(state, actor, build('essen'));
    expect(t.players[actor]!.money).toBe(30);
    expect(t.citySlots.essen).toEqual([s0(state), s1(state), actor]);
  });

  it('a full city is rejected even in Step 3', () => {
    const { state, actor } = builder((s) => {
      s.step = 3;
      placeHouse(s, s.playerOrder[0]!, 'essen', 0);
      placeHouse(s, s.playerOrder[1]!, 'essen', 1);
      s.citySlots.essen![2] = s.playerOrder[1]!;
    });
    expect(validateAction(state, actor, build('essen')).ok).toBe(false);
  });

  it('§14 rejects building twice in the same city', () => {
    const { state, actor } = builder((s, a) => {
      s.step = 3;
      placeHouse(s, a, 'essen', 0);
    });
    expect(validateAction(state, actor, build('essen'))).toEqual({
      ok: false,
      reason: 'You already have a house in that city',
    });
  });

  it('refuses to build with no houses left', () => {
    const { state, actor } = builder((s, a) => {
      placeHouse(s, a, 'essen');
      s.players[a]!.housesRemaining = 0;
    });
    expect(validateAction(state, actor, build('duisburg'))).toEqual({
      ok: false,
      reason: 'You have no houses left',
    });
  });
});

describe('§8 turn flow and undo', () => {
  it('a player builds any number of cities, then the next player acts', () => {
    const base = start({ playerCount: 3, seed: 'BUILD-FLOW', zone: ZONE });
    const s = enterPhase(deepClone(base), 'building', base.playerOrder[2]!);
    const first = s.activePlayerId!;
    let t = act(s, first, build('essen'));
    t = act(t, first, build('duisburg'));
    expect(t.activePlayerId).toBe(first);
    t = act(t, first, { type: 'passBuilding' });
    expect(t.phase).toBe('bureaucracy');
    expect(t.players[first]!.cities).toEqual(['essen', 'duisburg']);
  });

  it('undo returns the house, the money and the network count', () => {
    const { state, actor } = builder((s) => {
      s.step = 2;
      s.step2Triggered = true;
    });
    let t = act(state, actor, build('essen'));
    t = act(t, actor, build('aachen'));
    expect(t.players[actor]!.money).toBe(19);
    t = act(t, actor, { type: 'undoLastBuild' });
    expect(t.players[actor]!.money).toBe(40);
    expect(t.players[actor]!.cities).toEqual(['essen']);
    expect(t.citySlots.aachen).toEqual([null, null, null]);
    t = act(t, actor, { type: 'undoLastBuild' });
    expect(t.players[actor]!.money).toBe(50);
    expect(t.players[actor]!.hasNetwork).toBe(false);
    expect(validateAction(t, actor, { type: 'undoLastBuild' }).ok).toBe(false);
  });
});

describe('§2 experienced-player starting cities', () => {
  it('lets a player claim any unoccupied marked city, while protecting the rest in Step 1', () => {
    const base = start({ playerCount: 3, seed: 'MARKED', zone: ZONE, experiencedStart: true });
    const s = deepClone(base);
    const actor = s.playerOrder[2]!;
    const other = s.playerOrder[0]!;
    const mine = s.players[actor]!.markedStartCity!;
    const theirs = s.players[other]!.markedStartCity!;
    const t = enterPhase(s, 'building', actor);
    const marked = s.playerOrder.map((id) => s.players[id]!.markedStartCity!).sort();
    const unmarked = stateMap(s).cities.find(
      (city) => s.zone.includes(city.area) && !marked.includes(city.id),
    )!.id;

    const targets = buildTargets(t, actor).map((x) => x.cityId);
    expect(targets).toEqual(marked);
    expect(hasUnclaimedStartCityMarker(t, theirs)).toBe(true);
    expect(validateAction(t, actor, build(unmarked))).toEqual({
      ok: false,
      reason: 'Your first city must be an unoccupied marked starting city',
    });

    // Claiming another player's setup choice consumes its neutral marker.
    const started = act(t, actor, build(theirs));
    expect(started.players[actor]!.cities).toEqual([theirs]);
    expect(hasUnclaimedStartCityMarker(started, theirs)).toBe(false);
    expect(hasUnclaimedStartCityMarker(started, mine)).toBe(true);

    // Once started, every remaining unclaimed marker is still blocked in Step 1.
    expect(
      buildTargets(started, actor).map((x) => x.cityId),
    ).not.toContain(mine);
  });

  it('keeps a marker available when the Trust occupies its 15-Elektro slot', () => {
    const trustZone = ['west', 'southwest'];
    const s = deepClone(
      start({
        playerCount: 2,
        seed: 'MARKED-TRUST',
        zone: trustZone,
        experiencedStart: true,
        againstTheTrust: true,
      }),
    );
    const actor = s.playerOrder.find((id) => !s.players[id]!.isTrust)!;
    const other = s.playerOrder.find((id) => id !== actor && !s.players[id]!.isTrust)!;
    const marked = [s.players[actor]!.markedStartCity!, s.players[other]!.markedStartCity!].sort();
    const t = enterPhase(s, 'building', actor);

    expect(marked.every((cityId) => hasUnclaimedStartCityMarker(t, cityId))).toBe(true);
    expect(buildTargets(t, actor).map((x) => x.cityId)).toEqual(marked);

    const claimed = act(t, actor, build(s.players[other]!.markedStartCity!));
    expect(claimed.citySlots[s.players[other]!.markedStartCity!]![0]).toBe(actor);
    expect(hasUnclaimedStartCityMarker(claimed, s.players[other]!.markedStartCity!)).toBe(false);
  });
});

function s0(state: GameState): PlayerId {
  return state.playerOrder[0]!;
}
function s1(state: GameState): PlayerId {
  return state.playerOrder[1]!;
}
