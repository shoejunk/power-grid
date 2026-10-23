import { PLANTS } from './plants.js';
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

export const LEGACY_FACILITIES: readonly Facility[] = [
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

/** Each physical card needs its own ID for auctions, discounts and scrapping. */
const VERSION_6_FACILITIES: readonly Facility[] = [0, 100].flatMap(offset =>
  LEGACY_FACILITIES.map(f => ({ ...f, id: f.id + offset, output: { small: 1, medium: 3, large: 5 }[f.size] })));

/** Facility placement anchors interleave output upgrades with the original plant order.
 * The combined deck is then numbered consecutively, so every printed cost is unique.
 * IDs stay independent of costs for saved actions, art and resource storage.
 */
const FACILITY_TIERS: { resource: ResourceType; name: string; firstId: number; outputs: number[]; anchors: number[] }[] = [
  { resource: 'coal', name: 'Coal Mine', firstId: 301, outputs: [1, 2, 3, 4, 5, 6], anchors: [8, 13, 18, 24, 30, 36] },
  { resource: 'oil', name: 'Oil Refinery', firstId: 311, outputs: [1, 2, 3, 4, 5, 6], anchors: [10, 16, 22, 29, 36, 43] },
  { resource: 'garbage', name: 'Recycling Facility', firstId: 321, outputs: [2, 3, 4, 5], anchors: [12, 18, 24, 30] },
  { resource: 'uranium', name: 'Uranium Mine', firstId: 331, outputs: [1, 2, 3], anchors: [18, 27, 36] },
];
const facilitySpecs = FACILITY_TIERS.flatMap(tier => tier.outputs.map((output, i) => ({
  id: tier.firstId + i, name: `${tier.name} (${output})`, resource: tier.resource, output,
  size: (i === 0 ? 'small' : i === tier.outputs.length - 1 ? 'large' : 'medium') as Facility['size'],
  anchor: tier.anchors[i]!,
})));
const pricedDeck = [...PLANTS.filter(p => !p.isStep3).map(p => ({ id: p.id, anchor: p.id })), ...facilitySpecs]
  .sort((a, b) => a.anchor - b.anchor || a.id - b.id);
const INDUSTRY_CARD_COSTS = new Map(pricedDeck.map((card, i) => [card.id, i + 3]));
const VERSION_7_FACILITIES: readonly Facility[] = facilitySpecs.map(({ anchor: _anchor, ...facility }) =>
  ({ ...facility, cost: INDUSTRY_CARD_COSTS.get(facility.id)! }));

// Higher output keeps every physical card ID, price and market position unchanged.
export const FACILITIES: readonly Facility[] = VERSION_7_FACILITIES.map(f => {
  const output = f.output + ({ coal: 2, oil: 1, garbage: 0, uranium: 1 }[f.resource]);
  return { ...f, output, name: f.name.replace(/\(\d+\)$/, `(${output})`) };
});

// Versionless lookups identify historical cards too. Production and deck membership
// must use the saved game's version; names and costs of historical cards stay intact.
const ALL_FACILITIES = [...FACILITIES, ...VERSION_6_FACILITIES];

/** Preserve the deck and production used by existing audited games. */
export const facilitiesForVersion = (version: number): readonly Facility[] => version < 6 ? LEGACY_FACILITIES : version === 6 ? VERSION_6_FACILITIES : version === 7 ? VERSION_7_FACILITIES : FACILITIES;
export const findFacility = (id: number, version?: number): Facility | undefined => (version === undefined ? ALL_FACILITIES : facilitiesForVersion(version)).find(f => f.id === id);
export function getFacility(id: number, version = 8): Facility {
  const facility = findFacility(id, version);
  if (!facility) throw new Error(`Unknown facility: ${id}`);
  return facility;
}
export const cardName = (id: number, version = 3): string => (findFacility(id, version) ?? findFacility(id))?.name ?? `plant ${cardNumber(id, version)}`;

/** Printed number sorts cards; stable IDs break equal-cost ties (plants first). */
export const cardNumber = (id: number, version = 3): number =>
  version >= 7 ? INDUSTRY_CARD_COSTS.get(id) ?? id : findFacility(id)?.cost ?? id;
const facilityTypeId = (id: number): number => id >= 201 && id <= 212 ? id - 100 : id;
export const compareMarketCards = (a: number, b: number, version = 3): number =>
  cardNumber(a, version) - cardNumber(b, version) || facilityTypeId(a) - facilityTypeId(b) || a - b;
