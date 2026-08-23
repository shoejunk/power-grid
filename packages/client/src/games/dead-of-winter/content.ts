/**
 * Card ids → things a person can read.
 *
 * The state the server sends is all identifiers: `it-baseball-bat`,
 * `sv-loretta-clay`, `i7`. The names, symbols, thresholds and rules text live
 * in the content pack, which the client imports directly — it is static data
 * compiled into the game package, not a secret, and §22 pins the match to a
 * pack version so the two cannot drift apart inside a game.
 *
 * Every lookup here tolerates a miss. A redacted view is *full* of ids the
 * viewer is not allowed to resolve (`hidden:hand:p2:0`), and the correct answer
 * for those is "a card", not a crash.
 */

import {
  ACTIVE_PACK,
  ALL_LOCATIONS,
  type CardId,
  type CardInstanceId,
  type GameState,
  type ItemCardDefinition,
  type ItemSymbol,
  type LocationId,
  type MainObjectiveSide,
  type SecretObjectiveDefinition,
  type SurvivorCardDefinition,
  type SurvivorInstanceId,
} from '@game/dead-of-winter';

/** A placeholder minted by `redactStateFor` for something the viewer may not see. */
export const isHidden = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith('hidden:');

/**
 * The pack this match was created against.
 *
 * The client ships exactly one pack, so this is a check rather than a lookup:
 * a state naming a different pack would render with the wrong card text, and
 * silence is the wrong answer to that.
 */
export function packMatches(state: GameState): boolean {
  return (
    state.contentPackId === ACTIVE_PACK.pack.id && state.contentVersion === ACTIVE_PACK.pack.version
  );
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

export function itemDef(state: GameState, iid: CardInstanceId): ItemCardDefinition | undefined {
  const instance = state.items[iid];
  return instance ? ACTIVE_PACK.items.get(instance.cardId) : undefined;
}

export function itemName(state: GameState, iid: CardInstanceId): string {
  return itemDef(state, iid)?.name ?? 'Face-down card';
}

export function itemSymbols(state: GameState, iid: CardInstanceId): ItemSymbol[] {
  return itemDef(state, iid)?.symbols ?? [];
}

/** The one glyph per item symbol used everywhere a card is drawn. */
export const SYMBOL_GLYPH: Record<ItemSymbol, string> = {
  weapon: '⚔',
  fuel: '⛽',
  education: '🎓',
  food: '🥫',
  medicine: '✚',
  tool: '🔧',
  survivor: '🧍',
};

export const SYMBOL_LABEL: Record<ItemSymbol, string> = {
  weapon: 'Weapon',
  fuel: 'Fuel',
  education: 'Education',
  food: 'Food',
  medicine: 'Medicine',
  tool: 'Tool',
  survivor: 'Survivor',
};

/* ------------------------------------------------------------------ *
 * Survivors
 * ------------------------------------------------------------------ */

export function survivorDef(
  state: GameState,
  survivorId: SurvivorInstanceId,
): SurvivorCardDefinition | undefined {
  const survivor = state.survivors[survivorId];
  return survivor ? ACTIVE_PACK.survivors.get(survivor.cardId) : undefined;
}

export function survivorName(state: GameState, survivorId: SurvivorInstanceId): string {
  return survivorDef(state, survivorId)?.name ?? 'Survivor';
}

export const survivorCard = (cardId: CardId): SurvivorCardDefinition | undefined =>
  ACTIVE_PACK.survivors.get(cardId);

/** Public portrait asset for every survivor card in the active pack. */
export function survivorArtPath(cardId: CardId): string {
  return `/games/dead-of-winter/survivors/${cardId}.png`;
}

/** An ability the UI can offer, whether it is printed on the survivor or on their kit. */
export interface OfferedAbility {
  abilityId: string;
  text: string;
  dieThreshold: number | null;
  location: string;
  usage: string;
  /** Set when the ability comes from an equipped card (§7.7). */
  itemIid?: CardInstanceId;
  source: string;
}

/**
 * Every ability this survivor could activate.
 *
 * Triggered abilities are excluded: they carry a `trigger` and fire on their
 * own timing, so offering them as a button would invite a player to spend a die
 * on something that was never theirs to activate (§7.7).
 */
export function abilitiesOf(state: GameState, survivorId: SurvivorInstanceId): OfferedAbility[] {
  const survivor = state.survivors[survivorId];
  if (!survivor) return [];
  const out: OfferedAbility[] = [];

  const own = survivorDef(state, survivorId)?.ability;
  if (own && !own.trigger) {
    out.push({
      abilityId: own.id,
      text: own.text,
      dieThreshold: own.dieThreshold,
      location: own.location,
      usage: own.usage,
      source: survivorName(state, survivorId),
    });
  }

  for (const iid of survivor.equipped) {
    const def = itemDef(state, iid);
    for (const ability of def?.equippedAbilities ?? []) {
      if (ability.trigger) continue;
      out.push({
        abilityId: ability.id,
        text: ability.text,
        dieThreshold: ability.dieThreshold,
        location: ability.location,
        usage: ability.usage,
        itemIid: iid,
        source: def?.name ?? 'Equipment',
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Locations
 * ------------------------------------------------------------------ */

const TITLE_CASE = (id: string): string =>
  id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function locationName(id: LocationId): string {
  if (id === 'colony') return 'The Colony';
  return ACTIVE_PACK.locations.get(id)?.name ?? TITLE_CASE(id);
}

export const locationIds: readonly LocationId[] = ALL_LOCATIONS;

/* ------------------------------------------------------------------ *
 * Objectives and crises
 * ------------------------------------------------------------------ */

export function mainObjectiveSide(state: GameState): MainObjectiveSide | undefined {
  const card = ACTIVE_PACK.mainObjectives.get(state.mainObjective.cardId);
  if (!card) return undefined;
  return state.mainObjective.side === 'hardcore' ? card.hardcore : card.standard;
}

export function mainObjectiveName(state: GameState): string {
  return ACTIVE_PACK.mainObjectives.get(state.mainObjective.cardId)?.name ?? 'Main objective';
}

export function crisisCard(state: GameState) {
  return state.crisis.cardId ? ACTIVE_PACK.crises.get(state.crisis.cardId) : undefined;
}

export function crossroadsCard(cardId: CardId | null) {
  if (!cardId || isHidden(cardId)) return undefined;
  return ACTIVE_PACK.crossroads.get(cardId);
}

export function secretObjective(cardId: CardId | null): SecretObjectiveDefinition | undefined {
  if (!cardId || isHidden(cardId)) return undefined;
  return ACTIVE_PACK.secretObjectives.get(cardId);
}
