import type { GameState, Player, ResourceType } from '../types.js';
import { RESOURCE_TYPES } from '../types.js';

export interface PlayerScore {
  elektro: number;
  cities: number;
  plants: number;
  resources: number;
  total: number;
}

/** The price of the next token of this type in the current market. */
export function currentResourcePrice(state: GameState, type: ResourceType): number {
  const spaces = state.resourceMarket[type];
  const available = spaces.find((space) => space.filled > 0);
  // A sold-out market still has a printed price track. Use its highest price
  // until the next refill; USA coal storage also sells at this price.
  return available?.price ?? spaces[spaces.length - 1]?.price ?? 0;
}

/** Visible score from Elektro and the player's cities, plants, and fuel. */
export function scorePlayer(state: GameState, player: Player): PlayerScore {
  const elektro = player.money;
  const cities = player.cities.length * 20;
  const plants = player.plants.reduce((total, plant) => total + plant.plantId, 0);
  const prices = Object.fromEntries(
    RESOURCE_TYPES.map((type) => [type, currentResourcePrice(state, type)]),
  ) as Record<ResourceType, number>;
  const resources = player.plants.reduce(
    (total, plant) => total + RESOURCE_TYPES.reduce(
      (stored, type) => stored + (plant.stored[type] ?? 0) * prices[type],
      0,
    ),
    0,
  );
  return { elektro, cities, plants, resources, total: elektro + cities + plants + resources };
}
