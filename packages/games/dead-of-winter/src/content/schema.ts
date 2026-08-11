/**
 * The versioned content-pack schema — Dead of Winter's published contract with
 * whoever authors the licensed card catalog.
 *
 * Two consequences follow from "published":
 *
 *  1. Every field is documented here, because the catalog author has this file
 *     and nothing else. Where a field exists only to satisfy a specific rule,
 *     the rule is cited.
 *  2. The shape is additive-only in a patch release. §22 requires card scripts
 *     to be versioned with the match, so a pack that changes meaning must
 *     change `ContentPack.version` and an in-progress match keeps the old one.
 *
 * §1 is emphatic that card filters "must be data fields, not image recognition
 * performed at runtime", which is why `nonCooperative` and `matureContent` are
 * required booleans on every filterable family rather than optional hints.
 */

import type {
  AbilityDefinition,
  CardRequirement,
  Condition,
  Effect,
  EffectOption,
  TriggerSpec,
} from './effects.js';
import type {
  CardId,
  ExposureFace,
  ItemSymbol,
  LocationId,
  NonColonyLocationId,
} from './primitives.js';

/* ------------------------------------------------------------------ *
 * Board (§2.1)
 * ------------------------------------------------------------------ */

/**
 * A non-colony location's printed capacities.
 *
 * These are content rather than constants because §2.1 lists them as printed
 * per-location values, and because a later expansion board would supply
 * different ones without any engine change.
 */
export interface LocationDefinition {
  id: NonColonyLocationId;
  name: string;
  /** How many survivors (normal or otherwise) the location holds. */
  survivorCapacity: number;
  /** How many zombies/barricades its single entrance holds (§12). */
  entranceCapacity: number;
  /** §2.1: four noise spaces at every non-colony location. */
  noiseSpaces: number;
  /**
   * The likelihood order of item symbols shown to players (§2.1). Purely
   * informational — searching draws from the deck, never from this list.
   */
  itemSymbolOrder: ItemSymbol[];
  /**
   * Position in the stable non-colony order used by every automatic effect
   * (§2.1, §11.4). Lower resolves first. Ties fall back to the engine default
   * documented in `policy.locationOrder`.
   */
  order: number;
}

/** The colony's printed capacities (§2.1). */
export interface ColonyDefinition {
  /** Six, in the base game; cycled 1→6 during zombie placement (§12). */
  entranceCount: number;
  /** Zombie/barricade spaces at each numbered entrance. */
  spacesPerEntrance: number;
  /**
   * Colony survivor spaces, shared by normal and helpless survivors (§2.3).
   * The rulebook never prints this number in text, so it is content data; §13
   * and §9.4 both branch on the colony being full, so it must be finite.
   */
  survivorSpaces: number;
  /** Morale track maximum (§2.1: 0 through 10). */
  maxMorale: number;
}

/* ------------------------------------------------------------------ *
 * Survivors (§2.3)
 * ------------------------------------------------------------------ */

export interface SurvivorCardDefinition {
  id: CardId;
  name: string;
  /** Descriptive only — §2.3 says occupation has no general gameplay effect. */
  occupation: string;
  /** Used by casualty selection (§9.2, §12) and the initial first player (§4). */
  influence: number;
  /** Minimum die value to attack with this survivor (§7.1). */
  attackThreshold: number;
  /** Minimum die value to search with this survivor (§7.3). */
  searchThreshold: number;
  /**
   * The survivor's printed ability, if any.
   *
   * §18.1 is a live example of why the threshold is data: Loretta Clay's
   * ability is `4+`, not exactly `4`, and the errata exists precisely because
   * that was misread off the art.
   */
  ability?: AbilityDefinition;
  /**
   * §18.4 `Bev Russell`: a survivor may count towards zombie-generation totals
   * while present and still be ineligible as a casualty, because she "cannot be
   * killed and has no influence". Expressing that as a flag keeps the casualty
   * selectors from needing a card-id special case.
   */
  cannotBeKilled?: boolean;
  /** §19.1 removes every non-cooperative card in a cooperative game. */
  nonCooperative: boolean;
  /** §4.7 content filter. */
  matureContent: boolean;
}

/* ------------------------------------------------------------------ *
 * Items (§2.4)
 * ------------------------------------------------------------------ */

/**
 * Which deck an item belongs to.
 *
 * The distinction is load-bearing twice over: §4.8 deals starter cards as
 * opening hands, and §18.2 rules that starter cards never satisfy an objective
 * that asks for non-starter cards.
 */
export type ItemDeck = 'starter' | NonColonyLocationId;

/**
 * §2.4: cards with `EVENT` or `OUTSIDER` text drawn from a starter or location
 * deck are still item cards. Recording the flavour kind as data keeps §18.5's
 * ruling checkable instead of implicit.
 */
export type ItemTextKind = 'normal' | 'event' | 'outsider';

export interface ItemCardDefinition {
  id: CardId;
  name: string;
  text: string;
  /** Gameplay symbols; drives crisis scoring (§11.3) and objectives (§8.3). */
  symbols: ItemSymbol[];
  deck: ItemDeck;
  textKind: ItemTextKind;
  /**
   * `equip` stays attached to a survivor until handed off, contributed or
   * moved by death/card text (§8.1). `oneShot` resolves and goes to the waste
   * pile.
   */
  kind: 'equip' | 'oneShot';
  /** Resolved when the card is played (both kinds may have one). */
  onPlay?: Effect;
  /**
   * Lowers the die value this survivor's attacks require, while equipped.
   *
   * §18.5: "Switchblade modifies the required attack die and does not itself
   * replace the attack." A modifier is therefore not an ability and not a
   * replacement effect — it is a number the attack action reads, which is also
   * why §7.1 lets it combine with one replacement effect.
   */
  attackDieModifier?: number;
  /**
   * Abilities the card grants while equipped. Their usage limits live on the
   * card instance, never on its current holder (§18.5).
   */
  equippedAbilities?: AbilityDefinition[];
  /** §1: a data field, never inferred from the art. */
  nonCooperative: boolean;
  /** §1: likewise. */
  matureContent: boolean;
}

/* ------------------------------------------------------------------ *
 * Crisis (§11.3)
 * ------------------------------------------------------------------ */

export interface CrisisCardDefinition {
  id: CardId;
  name: string;
  text: string;
  /**
   * A contributed card scores +1 if it carries any of these symbols and −1 if
   * it carries none (§11.3). Each card scores once however many tokens its own
   * effect would have produced.
   */
  acceptedSymbols: ItemSymbol[];
  /** Executed when the contribution total falls short (§11.3 step 5). */
  failure: Effect;
  /**
   * The optional printed bonus for beating the requirement (§11.3 step 8).
   * Separate from the automatic +1 morale at two over, which is a general rule.
   */
  overContribution?: { text: string; effect: Effect };
  nonCooperative: boolean;
  matureContent: boolean;
}

/* ------------------------------------------------------------------ *
 * Crossroads (§10)
 * ------------------------------------------------------------------ */

export interface CrossroadsCardDefinition {
  id: CardId;
  name: string;
  /** Flavour read aloud on reveal; no gameplay effect. */
  story: string;
  trigger: TriggerSpec;
  /**
   * §10 and §18.4: all option text is revealed before the chooser decides, and
   * an option whose `requires` fails is illegal rather than a silent no-op.
   */
  options: EffectOption[];
  /**
   * Who chooses. §10 defaults to the active player; a card may hand the choice
   * to a vote (`Outbreak`) or another player.
   */
  chooser?: 'activePlayer' | 'vote' | 'firstPlayer';
  /** §4.7 filter — the reason this flag exists at all. */
  matureContent: boolean;
  nonCooperative: boolean;
  /**
   * §19.6 recommends removing crossroads content that depends on exiled
   * survivors when playing the Prisoner's Dilemma variant. Flagging it as data
   * keeps that toggle from becoming a hard-coded card-id list.
   */
  dependsOnExile?: boolean;
}

/* ------------------------------------------------------------------ *
 * Objectives (§16, §19)
 * ------------------------------------------------------------------ */

/**
 * One printed side of a dual-sided main objective.
 *
 * §19.1 and §19.4 both select the hardcore side, so the two sides are separate
 * records rather than a difficulty multiplier applied to one.
 */
export interface MainObjectiveSide {
  text: string;
  /** Morale the track starts on (§4.3). */
  startingMorale: number;
  /** Rounds the tracker starts on (§4.3). */
  startingRounds: number;
  /**
   * Executed once during setup, before survivors are placed, so a scenario may
   * seed the board with zombies (§4.3).
   */
  setup: Effect[];
  /** Evaluated only at the Check Main Objective step (§11.5, §18.2). */
  completion: Condition;
  /**
   * Run once per zombie killed, *before* that kill's exposure roll.
   *
   * §18.2 makes this ordering explicit for `We Need More Samples`: "after a
   * zombie is killed, roll its sample check before rolling exposure. The sample
   * check is mandatory." Expressing it as objective data rather than as a
   * special case in the combat code means the ordering holds for every kill
   * verb — attacks, abilities and card effects alike — and only for objectives
   * that actually ask for it. §7.1's kill/remove split still applies: a `remove`
   * never reaches here.
   */
  onZombieKilled?: Effect;
  /** What may be added face up to this objective (§8.3), if anything. */
  contribution?: {
    requirement: CardRequirement;
    /** §18.2 `Stockpile` explicitly allows several in one turn; absent = unlimited. */
    maxPerTurn?: number;
  };
  /** Named scenario counters, e.g. the sample count of `We Need More Samples`. */
  counters?: { id: string; label: string; start: number }[];
}

export interface MainObjectiveDefinition {
  id: CardId;
  name: string;
  standard: MainObjectiveSide;
  hardcore: MainObjectiveSide;
}

export type SecretObjectiveKind = 'nonBetrayal' | 'betrayal' | 'exiled';

export interface SecretObjectiveDefinition {
  id: CardId;
  name: string;
  text: string;
  kind: SecretObjectiveKind;
  /** Evaluated once, at game end (§16: never an early win trigger). */
  completion: Condition;
  /**
   * Exiled cards only. §14.1: a non-betrayer's exiled objective requires the
   * original secret objective to be revealed; a betrayer's does not.
   */
  revealsOriginalObjective?: boolean;
  /**
   * Exiled cards only. When true the exiled card *replaces* the original
   * completion test rather than adding to it.
   */
  replacesOriginalObjective?: boolean;
  nonCooperative: boolean;
  matureContent: boolean;
}

/* ------------------------------------------------------------------ *
 * The pack
 * ------------------------------------------------------------------ */

/**
 * The exposure die's printed face distribution (§2.5).
 *
 * An array of exactly six faces rather than a probability table, so a roll is
 * one `Rng.die(6)` and an index — replayable, and auditable against the
 * physical die.
 */
export type ExposureDieFaces = readonly [
  ExposureFace,
  ExposureFace,
  ExposureFace,
  ExposureFace,
  ExposureFace,
  ExposureFace,
];

export interface ContentPack {
  /** Stable identity, e.g. `dow-base`. */
  id: string;
  /** Semantic version. A match records this and never follows a later patch (§22). */
  version: string;
  /** Human name shown in the lobby. */
  name: string;
  /**
   * Which requirements document this pack was authored against, so a rules
   * change and a content change can be told apart in a bug report.
   */
  rulesVersion: string;

  colony: ColonyDefinition;
  locations: LocationDefinition[];
  exposureDie: ExposureDieFaces;

  survivors: SurvivorCardDefinition[];
  items: ItemCardDefinition[];
  crises: CrisisCardDefinition[];
  crossroads: CrossroadsCardDefinition[];
  mainObjectives: MainObjectiveDefinition[];
  secretObjectives: SecretObjectiveDefinition[];
}

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

/**
 * An indexed pack.
 *
 * Built once at `createGame` and rebuilt on load; never persisted, because the
 * maps are derived and §22 wants the persisted match to name a pack version
 * rather than embed a denormalised copy of it.
 */
export interface ContentIndex {
  pack: ContentPack;
  survivors: Map<CardId, SurvivorCardDefinition>;
  items: Map<CardId, ItemCardDefinition>;
  crises: Map<CardId, CrisisCardDefinition>;
  crossroads: Map<CardId, CrossroadsCardDefinition>;
  mainObjectives: Map<CardId, MainObjectiveDefinition>;
  secretObjectives: Map<CardId, SecretObjectiveDefinition>;
  locations: Map<LocationId, LocationDefinition>;
}

export function indexPack(pack: ContentPack): ContentIndex {
  const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> =>
    new Map(rows.map((r) => [r.id, r]));
  return {
    pack,
    survivors: byId(pack.survivors),
    items: byId(pack.items),
    crises: byId(pack.crises),
    crossroads: byId(pack.crossroads),
    mainObjectives: byId(pack.mainObjectives),
    secretObjectives: byId(pack.secretObjectives),
    locations: new Map(pack.locations.map((l) => [l.id as LocationId, l])),
  };
}
