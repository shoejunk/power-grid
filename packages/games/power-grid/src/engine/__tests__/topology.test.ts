/**
 * §8 topology rules that the two shipped boards cannot exercise.
 *
 * NOTE: neither the Germany nor the USA map has metropolis city pairs (see
 * docs/RULES-NOTES.md), so the §8 metropolis restriction has no data path in
 * production. It is still required by the spec and supported by `MapCity`, so
 * this suite registers a SYNTHETIC map to prove the rule works — and to prove
 * that a strictly cheaper route through an out-of-zone city is never used.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameMap, GameState, PlayerId } from '../../types.js';
import {
  buildCost,
  buildTargets,
  deepClone,
  registerMap,
  unregisterMap,
  validateAction,
} from '../index.js';
import { act, enterPhase, placeHouse, start } from './helpers.js';

const AREAS = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'] as const;
const city = (area: string, i: number) => `${area}-${i}`;

/**
 * Six areas of seven cities in a ring. Inside each area the cities form a chain
 * 1-2-3-4-5-6-7 costing 5, 5, 0, 5, 5, 5 — so `-3`/`-4` is a zero-cost link.
 * Neighbouring areas join `-7` to `-1` for 20.
 *
 * z1-1 and z1-2 are a metropolis pair.
 * A deliberate cheap shortcut z1-7 → z4-1 → z3-1 (1 + 1) exists but leaves the
 * z1/z2/z3 zone, so the engine must never price a route through it.
 */
function syntheticMap(): GameMap {
  const cities = AREAS.flatMap((a, ai) =>
    Array.from({ length: 7 }, (_, i) => ({
      id: city(a, i + 1),
      name: `${a.toUpperCase()}-${i + 1}`,
      area: a,
      x: (ai + 1) / 8,
      y: (i + 1) / 8,
      ...(a === 'z1' && i === 0 ? { metropolisPartner: city('z1', 2) } : {}),
      ...(a === 'z1' && i === 1 ? { metropolisPartner: city('z1', 1) } : {}),
    })),
  );

  const innerCosts = [5, 5, 0, 5, 5, 5];
  const connections = AREAS.flatMap((a) =>
    innerCosts.map((cost, i) => ({ a: city(a, i + 1), b: city(a, i + 2), cost })),
  );
  AREAS.forEach((a, i) => {
    const next = AREAS[(i + 1) % AREAS.length]!;
    connections.push({ a: city(a, 7), b: city(next, 1), cost: 20 });
  });
  connections.push({ a: city('z1', 7), b: city('z4', 1), cost: 1 });
  connections.push({ a: city('z4', 1), b: city('z3', 1), cost: 1 });

  const adjacency = new Map<string, Set<string>>(AREAS.map((a) => [a, new Set<string>()]));
  for (const c of connections) {
    const areaA = cities.find((x) => x.id === c.a)!.area;
    const areaB = cities.find((x) => x.id === c.b)!.area;
    if (areaA !== areaB) {
      adjacency.get(areaA)!.add(areaB);
      adjacency.get(areaB)!.add(areaA);
    }
  }

  return {
    id: 'germany',
    name: 'Synthetic',
    aspectRatio: 1,
    rules: {},
    areas: AREAS.map((a) => ({
      id: a,
      name: a,
      color: '#888888',
      adjacentAreas: [...adjacency.get(a)!].sort(),
    })),
    cities,
    connections,
  };
}

const ZONE = ['z1', 'z2', 'z3'];

function builder(mutate: (s: GameState, actor: PlayerId) => void = () => {}) {
  const base = start({ playerCount: 3, seed: 'SYNTH', zone: ZONE });
  const s = deepClone(base);
  const actor = s.playerOrder[2]!;
  mutate(s, actor);
  return { state: enterPhase(s, 'building', actor), actor };
}

describe('synthetic topology', () => {
  beforeEach(() => registerMap(syntheticMap()));
  afterEach(() => unregisterMap('germany'));

  it('§8 a player may not hold houses in both halves of a metropolis', () => {
    const { state, actor } = builder();
    const t = act(state, actor, { type: 'buildCity', cityId: city('z1', 1) });
    expect(validateAction(t, actor, { type: 'buildCity', cityId: city('z1', 2) })).toEqual({
      ok: false,
      reason: 'You already have a house in the other half of that metropolis',
    });
    expect(buildTargets(t, actor).map((x) => x.cityId)).not.toContain(city('z1', 2));
  });

  it('§8 the metropolis restriction is per player, not per city pair', () => {
    const { state, actor } = builder((s) => {
      placeHouse(s, s.playerOrder[0]!, city('z1', 1));
      s.step = 2;
      s.step2Triggered = true;
    });
    // A different player may still take the other half.
    expect(validateAction(state, actor, { type: 'buildCity', cityId: city('z1', 2) }).ok).toBe(true);
  });

  it('§8 zero-cost connections are free', () => {
    const { state, actor } = builder((s, a) => placeHouse(s, a, city('z1', 3)));
    expect(buildCost(state, actor, city('z1', 4))).toEqual({
      routeCost: 0,
      slot: 0,
      slotCost: 10,
      total: 10,
    });
  });

  it('§14 never routes through a city outside the playing zone, even when cheaper', () => {
    const { state, actor } = builder((s, a) => placeHouse(s, a, city('z1', 1)));
    // Out-of-zone shortcut would cost 25 + 1 + 1 = 27; the legal in-zone route is 90.
    expect(buildCost(state, actor, city('z3', 1))!.routeCost).toBe(90);
    expect(buildTargets(state, actor).map((x) => x.cityId)).not.toContain(city('z4', 1));
  });

  it('the playing zone is exactly three areas of seven cities', () => {
    const { state, actor } = builder();
    expect(buildTargets(state, actor)).toHaveLength(21);
  });
});
