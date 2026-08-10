/**
 * The primitive vocabulary shared by the content schema and the rules engine.
 *
 * These names are part of the published content contract: a catalog authored
 * against this package refers to locations and symbols by these exact strings,
 * so renaming one is a breaking change to every card ever written.
 *
 * Rule references in comments point at sections of
 * `dead-of-winter-gameplay-requirements.md`.
 */

/* ------------------------------------------------------------------ *
 * Locations (§2.1)
 * ------------------------------------------------------------------ */

export type LocationId =
  | 'colony'
  | 'police-station'
  | 'grocery-store'
  | 'school'
  | 'gas-station'
  | 'library'
  | 'hospital';

export type NonColonyLocationId = Exclude<LocationId, 'colony'>;

export const COLONY = 'colony' as const;

/**
 * The six non-colony locations in the canonical order §2.1 demands.
 *
 * The source "calls for resolving several effects in location order but does
 * not enumerate that order in text". This array *is* that enumeration; a
 * content pack may override it per location through `LocationDefinition.order`
 * (see `policy.locationOrder`), which is the seam §24 asks for.
 */
export const NON_COLONY_LOCATIONS: readonly NonColonyLocationId[] = [
  'police-station',
  'grocery-store',
  'school',
  'gas-station',
  'library',
  'hospital',
] as const;

export const ALL_LOCATIONS: readonly LocationId[] = [COLONY, ...NON_COLONY_LOCATIONS] as const;

export const isColony = (id: LocationId): id is 'colony' => id === COLONY;

/** §2.1: the colony has six numbered entrances cycled 1→6. */
export const COLONY_ENTRANCE_COUNT = 6;

/* ------------------------------------------------------------------ *
 * Item symbols (§2.4)
 * ------------------------------------------------------------------ */

export type ItemSymbol =
  | 'weapon'
  | 'fuel'
  | 'education'
  | 'food'
  | 'medicine'
  | 'tool'
  | 'survivor';

export const ITEM_SYMBOLS: readonly ItemSymbol[] = [
  'weapon',
  'fuel',
  'education',
  'food',
  'medicine',
  'tool',
  'survivor',
] as const;

/* ------------------------------------------------------------------ *
 * Dice (§2.5)
 * ------------------------------------------------------------------ */

/**
 * The four exposure-die outcomes. §9.1 gives each one its meaning; the *face
 * distribution* is content data (`ContentPack.exposureDie`) because it is
 * printed on the physical die rather than stated in the rules text.
 */
export type ExposureFace = 'blank' | 'wound' | 'frostbite' | 'bitten';

export const EXPOSURE_FACES: readonly ExposureFace[] = [
  'blank',
  'wound',
  'frostbite',
  'bitten',
] as const;

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

/** A card *definition* id, unique within a content pack. */
export type CardId = string;

/**
 * A card *instance* id. Two copies of the same item are two instances of one
 * definition, and §18.5 requires once-per-round state to live on the instance,
 * so the engine can never collapse them.
 */
export type CardInstanceId = string;

/** A survivor standee on the board — one instance of a survivor card. */
export type SurvivorInstanceId = string;

/** An ability id, unique within its owning card. */
export type AbilityId = string;
