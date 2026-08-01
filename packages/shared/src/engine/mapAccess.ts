/**
 * Map access for the engine.
 *
 * Everything the rules need about topology comes through here so that map data
 * stays data-driven (§ "Source and scope": "Map topology, city names,
 * connection costs ... should be data-driven rather than hard-coded into phase
 * logic"). Tests may register synthetic maps to exercise topology edge cases
 * (zero-cost connections, metropolis pairs) that the shipped maps may not have.
 */

import type { CityId, GameMap, GameState, MapCity, MapId } from '../types.js';
import { getMap as getDataMap, buildAdjacency } from '../data/maps/index.js';

const overrides = new Map<string, GameMap>();

/** Test hook: replace the data-file map for a given id. */
export function registerMap(map: GameMap): void {
  overrides.set(map.id, map);
}

export function unregisterMap(id: string): void {
  overrides.delete(id);
}

export function resolveMap(id: MapId): GameMap {
  return overrides.get(id) ?? getDataMap(id);
}

export function stateMap(state: GameState): GameMap {
  return resolveMap(state.settings.mapId);
}

export function findCity(map: GameMap, id: CityId): MapCity | undefined {
  return map.cities.find((c) => c.id === id);
}

export function cityInZone(map: GameMap, zone: readonly string[], id: CityId): boolean {
  const c = findCity(map, id);
  return !!c && zone.includes(c.area);
}

/** All city ids inside the playing zone. §1. */
export function zoneCities(map: GameMap, zone: readonly string[]): CityId[] {
  return map.cities.filter((c) => zone.includes(c.area)).map((c) => c.id);
}

/**
 * Dijkstra from a set of source cities across the zone graph.
 * Returns the cheapest connection cost to every reachable city. §8.
 *
 * Routes may pass through cities without building, so occupancy is irrelevant
 * here; only zone membership constrains the graph.
 */
export function cheapestRoutes(
  map: GameMap,
  zone: readonly string[],
  sources: readonly CityId[],
): Map<CityId, number> {
  const adj = buildAdjacency(map, zone as string[]);
  const dist = new Map<CityId, number>();
  // Deterministic ordering: sources sorted, ties broken by city id.
  const queue: { id: CityId; d: number }[] = [];
  for (const s of [...sources].sort()) {
    if (!adj.has(s)) continue;
    if (!dist.has(s)) {
      dist.set(s, 0);
      queue.push({ id: s, d: 0 });
    }
  }
  while (queue.length > 0) {
    queue.sort((a, b) => (a.d - b.d) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const cur = queue.shift()!;
    if (cur.d > (dist.get(cur.id) ?? Infinity)) continue;
    for (const edge of adj.get(cur.id) ?? []) {
      const nd = cur.d + edge.cost;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        queue.push({ id: edge.to, d: nd });
      }
    }
  }
  return dist;
}

/** Cities directly connected to `city` inside the zone. */
export function neighboursInZone(
  map: GameMap,
  zone: readonly string[],
  city: CityId,
): CityId[] {
  const adj = buildAdjacency(map, zone as string[]);
  return (adj.get(city) ?? []).map((e) => e.to).sort();
}
