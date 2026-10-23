import type { ResourceType } from '../types.js';

export interface Facility {
  id: number;
  name: string;
  resource: ResourceType;
  size: 'small' | 'medium' | 'large';
  output: number;
  /** Minimum auction bid; there is no placement or additional construction cost. */
  cost: number;
}

export const FACILITIES: readonly Facility[] = [
  { id: 101, name: 'Small Coal Mine', resource: 'coal', size: 'small', output: 1, cost: 8 },
  { id: 102, name: 'Medium Coal Mine', resource: 'coal', size: 'medium', output: 2, cost: 18 },
  { id: 103, name: 'Large Coal Mine', resource: 'coal', size: 'large', output: 3, cost: 30 },
  { id: 104, name: 'Small Oil Refinery', resource: 'oil', size: 'small', output: 1, cost: 10 },
  { id: 105, name: 'Medium Oil Refinery', resource: 'oil', size: 'medium', output: 2, cost: 22 },
  { id: 106, name: 'Large Oil Refinery', resource: 'oil', size: 'large', output: 3, cost: 36 },
  { id: 107, name: 'Small Recycling Facility', resource: 'garbage', size: 'small', output: 1, cost: 12 },
  { id: 108, name: 'Medium Recycling Facility', resource: 'garbage', size: 'medium', output: 2, cost: 24 },
  { id: 109, name: 'Large Recycling Facility', resource: 'garbage', size: 'large', output: 3, cost: 40 },
  { id: 110, name: 'Small Uranium Mine', resource: 'uranium', size: 'small', output: 1, cost: 18 },
  { id: 111, name: 'Medium Uranium Mine', resource: 'uranium', size: 'medium', output: 2, cost: 36 },
  { id: 112, name: 'Large Uranium Mine', resource: 'uranium', size: 'large', output: 3, cost: 54 },
];

export const findFacility = (id: number): Facility | undefined => FACILITIES.find(f => f.id === id);
export function getFacility(id: number): Facility {
  const facility = findFacility(id);
  if (!facility) throw new Error(`Unknown facility: ${id}`);
  return facility;
}
export const cardName = (id: number): string => findFacility(id)?.name ?? `plant ${id}`;

/** Printed number sorts cards; stable IDs break equal-cost ties (plants first). */
export const cardNumber = (id: number): number => findFacility(id)?.cost ?? id;
export const compareMarketCards = (a: number, b: number): number => cardNumber(a) - cardNumber(b) || a - b;
