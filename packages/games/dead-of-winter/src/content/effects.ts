/**
 * The card-effect data language (§17).
 *
 * Everything in this file is *data*: authored card text compiled into typed
 * trees. Nothing here executes — the interpreter lives in
 * `engine/effects/runner.ts`. The split matters because §22 requires card
 * scripts to be versioned with the match, and only data can be versioned that
 * way; a function pointer in a content pack could not survive persistence.
 *
 * Design rules the language obeys, all of them straight out of §17:
 *
 *  - kill and remove are different verbs, never aliases (§7.1);
 *  - an attack is a kind of kill, not the only kind (§7.1);
 *  - a `sequence` is atomic — ordinary item play cannot wedge into it (§8.1);
 *  - a choice carries its own legality predicate, so an option the chooser
 *    cannot satisfy is refused rather than silently no-oped (§10);
 *  - "if able" is an explicit wrapper, because §10 makes it a distinct
 *    failure mode from an illegal option.
 */

import type { AbilityId, CardId, ItemSymbol, LocationId, NonColonyLocationId } from './primitives.js';

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

/**
 * Which player an effect is about.
 *
 * `effectController` and `activePlayer` differ: a crisis failure effect runs
 * with no controller during the colony phase, and an ability handed to another
 * player through Request (§8.6) executes for the *requester*.
 */
export type PlayerSelector =
  /**
   * Engine-internal binding. A content pack never authors this: it is what a
   * `chosen` selector becomes once the chooser has answered, so the resumed
   * effect names a concrete player instead of re-asking (§20).
   */
  | { kind: 'ref'; id: string }
  | { kind: 'activePlayer' }
  | { kind: 'effectController' }
  | { kind: 'firstPlayer' }
  | { kind: 'allPlayers' }
  | { kind: 'allNonExiledPlayers' }
  | { kind: 'otherPlayers' }
  | { kind: 'chosen'; by: PlayerSelector; among: 'allPlayers' | 'otherPlayers' | 'allNonExiledPlayers' };

export type LocationSelector =
  | { kind: 'fixed'; location: LocationId }
  | { kind: 'colony' }
  | { kind: 'sourceLocation' }
  | { kind: 'eachNonColony' }
  | { kind: 'chosen'; by: PlayerSelector; among: 'all' | 'nonColony' | 'occupied' };

/**
 * Which survivors an effect touches.
 *
 * `lowestInfluenceAt` is separated out because §9.2 and §12 both name it as the
 * automatic casualty rule, and both must tie-break through the first player
 * rather than through array order.
 */
export type SurvivorSelector =
  /** Engine-internal binding; see `PlayerSelector`'s `ref`. */
  | { kind: 'ref'; id: string }
  | { kind: 'source' }
  | { kind: 'lowestInfluenceAt'; location: LocationSelector }
  | { kind: 'allAt'; location: LocationSelector; controlledBy?: PlayerSelector }
  | { kind: 'allControlledBy'; player: PlayerSelector }
  | { kind: 'chosen'; by: PlayerSelector; among: SurvivorSelector };

/** Which deck a draw, search or bottom-place refers to. */
export type DeckSelector =
  | { kind: 'locationItems'; location: NonColonyLocationId }
  | { kind: 'sourceLocationItems' }
  | { kind: 'crossroads' }
  | { kind: 'survivors' }
  | { kind: 'crisis' };

/* ------------------------------------------------------------------ *
 * Card requirements (§8.3, §11.3, §18.2)
 * ------------------------------------------------------------------ */

/**
 * What a crisis accepts, or what a main objective will take as a face-up
 * contribution.
 *
 * `excludeStarter` exists because §18.2 rules that starter cards never satisfy
 * an objective asking for non-starter cards — a distinction that cannot be
 * expressed with symbols alone.
 */
export interface CardRequirement {
  /** Any one of these symbols qualifies. Empty or absent means "any item". */
  symbols?: ItemSymbol[];
  /** §18.2: a "non-starter cards" objective refuses the starter deck. */
  excludeStarter?: boolean;
  /** Named cards, when an objective calls for specific ones. */
  cardIds?: CardId[];
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

export type Condition =
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'not'; of: Condition }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  /* colony counters */
  | { kind: 'morale'; atLeast?: number; atMost?: number }
  | { kind: 'roundsRemaining'; atLeast?: number; atMost?: number }
  | { kind: 'food'; atLeast?: number; atMost?: number }
  | { kind: 'wasteCount'; atLeast?: number; atMost?: number }
  | { kind: 'starvationTokens'; atLeast?: number }
  | { kind: 'roundsSurvived'; atLeast: number }
  /* board */
  | { kind: 'zombiesAt'; location: LocationSelector; atLeast?: number; atMost?: number }
  | {
      kind: 'survivorsAt';
      location: LocationSelector;
      controlledBy?: PlayerSelector;
      atLeast?: number;
      atMost?: number;
    }
  | { kind: 'helplessSurvivors'; atLeast?: number; atMost?: number }
  | { kind: 'colonyHasEmptySurvivorSpace' }
  | { kind: 'barricadesAt'; location: LocationSelector; atLeast: number }
  /* players */
  | { kind: 'playerExiled'; player: PlayerSelector }
  | { kind: 'handCount'; player: PlayerSelector; atLeast?: number; atMost?: number }
  /** §18.2 `Hoarder`: strictly the most cards, a tie is not enough. */
  | { kind: 'strictlyMostCardsInHand'; player: PlayerSelector }
  | {
      kind: 'holdsCards';
      player: PlayerSelector;
      requirement: CardRequirement;
      atLeast: number;
      /** Count equipped items as well as the hand. */
      includeEquipped?: boolean;
    }
  | { kind: 'controlsSurvivors'; player: PlayerSelector; atLeast?: number; atMost?: number }
  /* objective bookkeeping */
  | { kind: 'objectiveContributions'; requirement?: CardRequirement; atLeast: number }
  | { kind: 'counter'; counter: string; atLeast?: number; atMost?: number }
  /**
   * §18.2 `We Need More Samples` scales with "each player who started the
   * game", which is not the same as the number of players still alive under
   * the elimination variant.
   */
  | { kind: 'counterPerStartingPlayer'; counter: string; atLeast: number }
  /* effect-local scratch values, set by `rollDie` */
  | { kind: 'variable'; name: string; atLeast?: number; atMost?: number };

/* ------------------------------------------------------------------ *
 * Effects
 * ------------------------------------------------------------------ */

export interface EffectOption {
  id: string;
  /** Shown verbatim; §18.4 requires every option's outcome to be read first. */
  text: string;
  /** When present and false at resolution time the option is not offered (§10). */
  requires?: Condition;
  outcome: Effect;
}

export type Effect =
  | { kind: 'noop' }
  /** Ordered and atomic: ordinary item play cannot interrupt it (§8.1, §20). */
  | { kind: 'sequence'; effects: Effect[] }
  /** §17: simultaneous when card text demands it, rather than first-player ordered. */
  | { kind: 'simultaneous'; effects: Effect[] }
  /** §10: a clause qualified by "if able" may fail without cancelling its siblings. */
  | { kind: 'ifAble'; effect: Effect }
  | { kind: 'branch'; test: Condition; then: Effect; otherwise?: Effect }
  | { kind: 'repeat'; times: number; effect: Effect }
  /* colony counters */
  | { kind: 'adjustMorale'; amount: number }
  | { kind: 'adjustFood'; amount: number }
  | { kind: 'adjustRounds'; amount: number }
  | { kind: 'addStarvation'; amount: number }
  | { kind: 'adjustCounter'; counter: string; amount: number }
  /* zombies — kill and remove are deliberately different verbs (§7.1) */
  | { kind: 'addZombies'; count: number; location: LocationSelector }
  | { kind: 'removeZombies'; count: number; location: LocationSelector }
  | {
      kind: 'killZombies';
      count: number;
      location: LocationSelector;
      /** §7.1: an ability that kills is not automatically an *attack*. */
      isAttack: boolean;
      /** §7.1/§18.3: some effects explicitly cancel the exposure rolls. */
      rollExposure: boolean;
      /** The survivor credited with the kill, for exposure and objectives. */
      killer?: SurvivorSelector;
    }
  /* survivors */
  | { kind: 'addSurvivor'; to: PlayerSelector; count: number }
  | { kind: 'addHelpless'; count: number }
  | { kind: 'killSurvivor'; target: SurvivorSelector }
  /** §9.3: removal is not death and does not cost morale unless said so. */
  | { kind: 'removeSurvivor'; target: SurvivorSelector; reduceMorale?: boolean }
  | { kind: 'wound'; target: SurvivorSelector; amount: number; frostbite?: boolean }
  | { kind: 'heal'; target: SurvivorSelector; amount: number; frostbiteFirst?: boolean }
  | { kind: 'rollExposure'; target: SurvivorSelector }
  | {
      kind: 'moveSurvivor';
      target: SurvivorSelector;
      to: LocationSelector;
      rollExposure?: boolean;
      /** Forced relocation does not spend the once-per-turn allowance (§14.1). */
      consumesMoveAllowance?: boolean;
    }
  /* cards */
  | { kind: 'drawItems'; to: PlayerSelector; deck: DeckSelector; count: number }
  | { kind: 'discardItems'; from: PlayerSelector; count: number; requirement?: CardRequirement }
  | { kind: 'stealRandomCard'; from: PlayerSelector; to: PlayerSelector }
  /** §10: a search for a named card reshuffles the deck afterwards. */
  | { kind: 'searchDeckForCard'; deck: DeckSelector; cardId: CardId; to: PlayerSelector }
  | { kind: 'removeCrisisContributions'; reveal: boolean }
  /* board furniture */
  | { kind: 'addBarricade'; count: number; location: LocationSelector }
  | { kind: 'removeBarricade'; count: number; location: LocationSelector }
  | { kind: 'addNoise'; count: number; location: LocationSelector }
  | { kind: 'removeNoise'; count: number; location: LocationSelector }
  /* control flow needing a human */
  | { kind: 'choice'; prompt: string; chooser: PlayerSelector; options: EffectOption[] }
  | {
      kind: 'vote';
      prompt: string;
      /** §15: `Outbreak` narrows the electorate to colony-present players. */
      electorate: 'allNonExiled' | 'colonySurvivors';
      onPass: Effect;
      onFail: Effect;
    }
  /** §8.6: Request is a permitted nested action, so it is a first-class effect. */
  | { kind: 'requestCard'; requester: PlayerSelector; from: PlayerSelector; then?: Effect }
  /* scratch values */
  | { kind: 'rollDie'; sides: number; store: string }
  | { kind: 'endGame'; reason: string };

/* ------------------------------------------------------------------ *
 * Triggers (§17)
 * ------------------------------------------------------------------ */

export type TriggerEventKind =
  | 'turnStart'
  | 'turnEnd'
  | 'actionPerformed'
  | 'moveCompleted'
  | 'zombieKilled'
  | 'survivorKilled'
  | 'searchPerformed'
  | 'crisisResolved'
  | 'moraleChanged'
  | 'roundEnd'
  | 'never';

export type ActionKind =
  | 'attackZombie'
  | 'attackSurvivor'
  | 'search'
  | 'barricade'
  | 'cleanWaste'
  | 'attract'
  | 'ability'
  | 'playItem'
  | 'playFoodForDie'
  | 'move'
  | 'contributeCrisis'
  | 'contributeObjective'
  | 'any';

export interface TriggerSpec {
  event: TriggerEventKind;
  /** Only meaningful for `actionPerformed`. */
  action?: ActionKind;
  /** Only meaningful for `moveCompleted`. */
  destination?: 'colony' | 'nonColony' | 'any';
  /** Only meaningful for `crisisResolved`. */
  crisisOutcome?: 'prevented' | 'failed' | 'any';
  /** Only meaningful for `moraleChanged`. */
  moraleDirection?: 'up' | 'down' | 'any';
  /**
   * An extra gate evaluated at trigger time.
   *
   * §18.1: `Old Divisions` triggers only when a survivor controlled by the
   * active player is at the colony *and* at least one helpless survivor is
   * there — a condition the event kind alone cannot express.
   */
  requires?: Condition;
}

/* ------------------------------------------------------------------ *
 * Usage limits (§7.7, §18.5)
 * ------------------------------------------------------------------ */

/**
 * How often an ability may be used.
 *
 * `oncePerRound` is the interesting one: §7.7 confines it to the controller's
 * own turn and holds the used flag for the whole round, and §18.5 pins that
 * flag to the card/ability *instance*, so handing the item off, re-equipping it
 * or letting its survivor die does not launder the usage away.
 */
export type UsageLimit = 'unlimited' | 'oncePerTurn' | 'oncePerRound' | 'oncePerGame';

export interface AbilityDefinition {
  id: AbilityId;
  /** Rendered verbatim in the UI. */
  text: string;
  /** `'ANYWHERE'` or the location the survivor must occupy (§2.3). */
  location: 'ANYWHERE' | LocationId;
  /**
   * Die value the ability needs, or `null` for a no-die ability resolved at
   * its printed timing (§7.7).
   */
  dieThreshold: number | null;
  usage: UsageLimit;
  /** Absent for an activated ability; present for a triggered one. */
  trigger?: TriggerSpec;
  effect: Effect;
}
