/**
 * Presentation vocabulary for the match screen.
 *
 * Rule paraphrases live here (never inline in JSX) so the same sentence appears
 * in the phase panel, the tooltip and the rules sheet without drifting — and so
 * every claim carries its § citation (quality bar U8).
 */

import type {
  LogCategory,
  Phase,
  PhaseStatus,
  PowerPlant,
  ResourceType,
} from '@pg/shared';
import { getPlant, isEcological, isHybrid } from '@pg/shared';
import { plantArt, type PlantArt } from '@/art';

/* ------------------------------------------------------------------ *
 * Resources
 * ------------------------------------------------------------------ */

export interface ResourceMeta {
  label: string;
  /** Single-letter mark stamped on the token, so colour is never the only cue. */
  mark: string;
  /** CSS custom property holding the token fill. */
  cssVar: string;
}

export const RESOURCE_META: Record<ResourceType, ResourceMeta> = {
  coal: { label: 'Coal', mark: 'C', cssVar: '--pg-res-coal' },
  oil: { label: 'Oil', mark: 'O', cssVar: '--pg-res-oil' },
  garbage: { label: 'Garbage', mark: 'G', cssVar: '--pg-res-garbage' },
  uranium: { label: 'Uranium', mark: 'U', cssVar: '--pg-res-uranium' },
};

export const RESOURCE_ORDER: readonly ResourceType[] = ['coal', 'oil', 'garbage', 'uranium'];

/* ------------------------------------------------------------------ *
 * Plants
 * ------------------------------------------------------------------ */

const artCache = new Map<number, PlantArt>();

/** `plantArt()` builds a canvas per call; the match screen renders plants constantly. */
export function plantArtFor(plant: PowerPlant): PlantArt {
  const hit = artCache.get(plant.id);
  if (hit) return hit;
  const art = plantArt(plant);
  artCache.set(plant.id, art);
  return art;
}

export type PlantKind = 'coal' | 'oil' | 'garbage' | 'uranium' | 'hybrid' | 'eco';

export function plantKind(plant: PowerPlant): PlantKind {
  if (isEcological(plant)) return 'eco';
  if (isHybrid(plant)) return 'hybrid';
  return plant.accepts[0] as PlantKind;
}

/** "3 coal", "2 coal and/or oil", "no fuel". §1. */
export function fuelText(plant: PowerPlant): string {
  if (isEcological(plant)) return 'No fuel';
  if (isHybrid(plant)) return `${plant.fuel} coal and/or oil`;
  return `${plant.fuel} ${RESOURCE_META[plant.accepts[0] as ResourceType].label.toLowerCase()}`;
}

export function citiesText(plant: PowerPlant): string {
  return plant.cities === 1 ? '1 city' : `${plant.cities} cities`;
}

/** The full rules sentence for one plant, used in every plant tooltip. §1. */
export function plantRuleText(plant: PowerPlant): string {
  if (isEcological(plant)) {
    return `Ecological plant. Burns nothing and stores nothing, and supplies up to ${citiesText(
      plant,
    )} every round.`;
  }
  const store = plant.fuel * 2;
  if (isHybrid(plant)) {
    return `Hybrid plant. Operating it burns exactly ${plant.fuel} tokens in any mix of coal and oil, and supplies ${citiesText(
      plant,
    )}. It can store ${store} tokens in total across both types — not ${store} of each.`;
  }
  return `Operating it burns exactly ${fuelText(plant)} and supplies ${citiesText(
    plant,
  )}. It can store ${store} tokens, twice its requirement.`;
}

export function plantStorage(plantId: number): number {
  return getPlant(plantId).fuel * 2;
}

/* ------------------------------------------------------------------ *
 * Phases
 * ------------------------------------------------------------------ */

export interface PhaseMeta {
  index: number;
  name: string;
  /** Turn direction for the phase. §4. */
  order: string;
  rule: string;
  summary: string;
}

export const PHASE_META: Record<Phase, PhaseMeta> = {
  setup: {
    index: 0,
    name: 'Setup',
    order: 'Host first',
    rule: '§2 Setup requirements',
    summary: 'Choose the contiguous playing zone before the first round begins.',
  },
  order: {
    index: 1,
    name: 'Player Order',
    order: 'Automatic',
    rule: '§5 Determine Player Order',
    summary: 'Most connected cities goes first; the largest owned plant breaks ties.',
  },
  auction: {
    index: 2,
    name: 'Auction Plants',
    order: 'Player order',
    rule: '§6 Auction Power Plants',
    summary: 'One plant per player per round. Only the current market is biddable.',
  },
  resources: {
    index: 3,
    name: 'Buy Resources',
    order: 'Reverse order',
    rule: '§7 Buy Resources',
    summary: 'Buy only what your plants can burn and store. Cheapest space first.',
  },
  building: {
    index: 4,
    name: 'Build Houses',
    order: 'Reverse order',
    rule: '§8 Build Houses',
    summary: 'Pay the cheapest route from your network plus the lowest empty city slot.',
  },
  bureaucracy: {
    index: 5,
    name: 'Bureaucracy',
    order: 'Player order',
    rule: '§9 Bureaucracy',
    summary: 'Operate plants for income, resupply the market, then age the plant market.',
  },
  gameOver: {
    index: 5,
    name: 'Final Evaluation',
    order: 'All players',
    rule: '§11 End of game and winner',
    summary: 'No cash is paid. The player who can supply the most cities wins.',
  },
};

/* ------------------------------------------------------------------ *
 * Phase status (§4)
 * ------------------------------------------------------------------ */

export interface StatusMeta {
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
  note: string;
}

export const STATUS_META: Record<PhaseStatus, StatusMeta> = {
  eligible: { label: 'Eligible', tone: 'neutral', note: 'Waiting for their turn in this phase.' },
  acting: { label: 'Acting', tone: 'accent', note: 'The game is waiting on this player right now.' },
  purchased: { label: 'Purchased', tone: 'success', note: 'Has acquired a plant this round.' },
  passed: { label: 'Passed', tone: 'warning', note: 'Out of this phase for the rest of the round.' },
  acted: { label: 'Done', tone: 'info', note: 'Has finished their turn in this phase.' },
  ineligible: { label: 'Sits out', tone: 'neutral', note: 'Does not act in this phase.' },
};

/* ------------------------------------------------------------------ *
 * Rules log (§14, U7)
 * ------------------------------------------------------------------ */

export type LogFilter = 'all' | 'players' | 'market' | 'automatic';

export const LOG_FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'players', label: 'Players' },
  { value: 'market', label: 'Markets' },
  { value: 'automatic', label: 'Rules' },
];

const PLAYER_CATEGORIES: readonly LogCategory[] = [
  'auction',
  'bid',
  'payment',
  'resource',
  'build',
  'power',
];
const MARKET_CATEGORIES: readonly LogCategory[] = ['market', 'resource'];
const AUTOMATIC_CATEGORIES: readonly LogCategory[] = [
  'setup',
  'order',
  'market',
  'step',
  'trust',
  'endgame',
  'system',
];

export function matchesFilter(category: LogCategory, filter: LogFilter): boolean {
  switch (filter) {
    case 'players':
      return PLAYER_CATEGORIES.includes(category);
    case 'market':
      return MARKET_CATEGORIES.includes(category);
    case 'automatic':
      return AUTOMATIC_CATEGORIES.includes(category);
    case 'all':
    default:
      return true;
  }
}

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  setup: 'Setup',
  order: 'Order',
  auction: 'Auction',
  bid: 'Bid',
  payment: 'Payment',
  resource: 'Resource',
  build: 'Build',
  power: 'Power',
  market: 'Market',
  step: 'Step',
  trust: 'Trust',
  endgame: 'Endgame',
  system: 'Round',
};

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
