/**
 * Board view-model.
 *
 * Every interactive decision on the board comes from `legalActions()` in
 * `@pg/shared` — the board never re-implements a rule and never mutates state.
 * When a city is not clickable, the reason shown in the tooltip is the engine's
 * own sentence from `buildBlockReason`, which is the same string the server
 * would reject the action with (QUALITY-BAR U2).
 */

import {
  HOUSE_SLOT_COSTS,
  SLOTS_OPEN_AT_STEP,
  buildAdjacency,
  buildBlockReason,
  cheapestRoutes,
  hasUnclaimedStartCityMarker,
  legalActions,
  type BuildTarget,
  type CityId,
  type GameMap,
  type GameState,
  type Player,
  type PlayerId,
} from '@pg/shared';

import { pairKey } from './layout';

export type BoardMode = 'idle' | 'building' | 'startCity' | 'trustPlacement';

export interface SlotView {
  index: number;
  /** 10 / 15 / 20. */
  cost: number;
  /** Open at the current Step (§10). */
  open: boolean;
  occupant: Player | null;
}

export interface CityView {
  id: CityId;
  inZone: boolean;
  slots: SlotView[];
  /** Build target from `legalActions`, when this city is legal right now. */
  target: BuildTarget | null;
  /** Engine sentence explaining why it is not legal, when it is not. */
  blockedReason: string | null;
  /** True when the reason is purely "you cannot afford it". */
  unaffordable: boolean;
  ownedByMe: boolean;
  /** Neutral experienced-start marker, until a player claims the city. */
  startingCityMarked: boolean;
}

export interface BoardModel {
  mode: BoardMode;
  myPlayerId: PlayerId | null;
  /** Interactive city ids for the current mode. */
  interactive: Set<CityId>;
  cities: Map<CityId, CityView>;
  /** Ids of connections whose endpoints are both inside the playing zone. */
  liveRoutes: Set<string>;
  zone: Set<string>;
  step: number;
}

export function buildModel(state: GameState, map: GameMap, myPlayerId: PlayerId | null): BoardModel {
  const zone = new Set(state.zone);
  const slotsOpen = SLOTS_OPEN_AT_STEP[state.step] ?? 1;

  const me = myPlayerId ? state.players[myPlayerId] : undefined;
  const legal = me && !me.isTrust ? legalActions(state, me.id) : null;

  const targets = new Map<CityId, BuildTarget>();
  for (const t of legal?.buildableCities ?? []) targets.set(t.cityId, t);

  let mode: BoardMode = 'idle';
  const interactive = new Set<CityId>();
  if (legal) {
    if (state.phase === 'building' && legal.isActive) {
      mode = 'building';
      for (const t of legal.buildableCities) if (t.affordable) interactive.add(t.cityId);
    } else if (legal.startCityChoices.length > 0) {
      mode = 'startCity';
      for (const id of legal.startCityChoices) interactive.add(id);
    } else if (legal.trustHouseCities.length > 0) {
      mode = 'trustPlacement';
      for (const id of legal.trustHouseCities) interactive.add(id);
    }
  }

  const cities = new Map<CityId, CityView>();
  for (const city of map.cities) {
    const inZone = zone.has(city.area);
    const raw = state.citySlots[city.id] ?? [];
    const slots: SlotView[] = HOUSE_SLOT_COSTS.map((cost, index) => {
      const owner = raw[index] ?? null;
      return {
        index,
        cost,
        open: index < slotsOpen,
        occupant: owner ? (state.players[owner] ?? null) : null,
      };
    });

    const target = targets.get(city.id) ?? null;
    let blockedReason: string | null = null;
    let unaffordable = false;

    if (mode === 'building' && me) {
      if (target) {
        if (!target.affordable) {
          unaffordable = true;
          blockedReason = `Connecting ${city.name} costs ${target.total} Elektro; you have ${me.money}`;
        }
      } else if (!inZone) {
        blockedReason = 'That city is outside the playing zone';
      } else {
        blockedReason = safeBlockReason(state, me.id, city.id);
      }
    } else if (!inZone) {
      blockedReason = 'That city is outside the playing zone';
    }

    cities.set(city.id, {
      id: city.id,
      inZone,
      slots,
      target,
      blockedReason,
      unaffordable,
      ownedByMe: !!me && me.cities.includes(city.id),
      startingCityMarked: hasUnclaimedStartCityMarker(state, city.id),
    });
  }

  const liveRoutes = new Set<string>();
  const areaOf = new Map(map.cities.map((c) => [c.id, c.area] as const));
  for (const conn of map.connections) {
    const aa = areaOf.get(conn.a);
    const bb = areaOf.get(conn.b);
    if (aa && bb && zone.has(aa) && zone.has(bb)) liveRoutes.add(pairKey(conn.a, conn.b));
  }

  return { mode, myPlayerId: myPlayerId ?? null, interactive, cities, liveRoutes, zone, step: state.step };
}

/** `buildBlockReason` throws on an unknown player; never let that reach React. */
function safeBlockReason(state: GameState, playerId: PlayerId, cityId: CityId): string | null {
  try {
    return buildBlockReason(state, playerId, cityId);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Winning-route reconstruction (QUALITY-BAR U3)
 * ------------------------------------------------------------------ */

/**
 * The exact edges of the cheapest route from the player's network to `target`.
 *
 * The *cost* still comes from `legalActions` — this only recovers which edges
 * the engine's Dijkstra actually used, by walking the distance map backwards
 * with `cheapestRoutes()` from `@pg/shared`. Neighbours are visited in id order
 * so the highlighted path is deterministic and matches on every client.
 */
export function winningRouteEdges(
  state: GameState,
  map: GameMap,
  playerId: PlayerId,
  target: CityId,
): string[] {
  const player = state.players[playerId];
  if (!player || !player.hasNetwork || player.cities.length === 0) return [];

  const distances = cheapestRoutes(map, state.zone, player.cities);
  const adjacency = buildAdjacency(map, state.zone);
  const edges: string[] = [];

  let cursor = target;
  for (let guard = 0; guard < 256; guard++) {
    const here = distances.get(cursor);
    if (here === undefined || here === 0) break;
    const neighbours = (adjacency.get(cursor) ?? [])
      .slice()
      .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    let step: { to: CityId; cost: number } | null = null;
    for (const edge of neighbours) {
      const there = distances.get(edge.to);
      if (there !== undefined && Math.abs(there + edge.cost - here) < 1e-9) {
        step = edge;
        break;
      }
    }
    if (!step) break;
    edges.push(pairKey(cursor, step.to));
    cursor = step.to;
  }

  return edges;
}
