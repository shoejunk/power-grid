import type { GameMap, MapId } from '../../types.js';
import { GERMANY_MAP } from './germany.js';
import { USA_MAP } from './usa.js';

export { GERMANY_MAP } from './germany.js';
export { USA_MAP } from './usa.js';

export const MAPS: Record<MapId, GameMap> = {
  germany: GERMANY_MAP,
  usa: USA_MAP,
};

export function getMap(id: MapId): GameMap {
  const m = MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}

/* ------------------------------------------------------------------ *
 * Map-derived helpers used by the engine and the renderer.
 * ------------------------------------------------------------------ */

export function cityById(map: GameMap, id: string) {
  const c = map.cities.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown city '${id}' on map '${map.id}'`);
  return c;
}

/** Adjacency list restricted to a set of areas (the playing zone). §1. */
export function buildAdjacency(
  map: GameMap,
  zone: readonly string[] | null,
): Map<string, { to: string; cost: number }[]> {
  const inZone = (cityId: string): boolean => {
    if (!zone) return true;
    const c = map.cities.find((x) => x.id === cityId);
    return !!c && zone.includes(c.area);
  };

  const adj = new Map<string, { to: string; cost: number }[]>();
  for (const c of map.cities) {
    if (inZone(c.id)) adj.set(c.id, []);
  }
  for (const conn of map.connections) {
    if (!inZone(conn.a) || !inZone(conn.b)) continue;
    adj.get(conn.a)!.push({ to: conn.b, cost: conn.cost });
    adj.get(conn.b)!.push({ to: conn.a, cost: conn.cost });
  }
  return adj;
}

/** True when every area in `zone` is reachable from every other. §1 contiguity. */
export function isZoneContiguous(map: GameMap, zone: readonly string[]): boolean {
  if (zone.length === 0) return false;
  const set = new Set(zone);
  const seen = new Set<string>([zone[0]!]);
  const queue = [zone[0]!];
  while (queue.length) {
    const cur = queue.shift()!;
    const area = map.areas.find((a) => a.id === cur);
    if (!area) return false;
    for (const nb of area.adjacentAreas) {
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen.size === set.size;
}
