/**
 * Dead of Winter — authoritative domain model.
 *
 * This file is the contract the rest of the package builds against: the engine
 * mutates these shapes, the server persists them as JSON, the client renders
 * them. Nothing here depends on a runtime environment, and nothing here holds
 * a function — §22 requires a match to be replayable from its seed and its
 * event stream, which only pure data can be.
 *
 * §20 enumerates what the authoritative state "must at minimum retain"; every
 * bullet in that list has a home below, and the comments say which.
 *
 * Rule references point at sections of
 * `dead-of-winter-gameplay-requirements.md`.
 */

import type { CoreLogEntry, GameStateEnvelope, PlayerId } from '@tt/core';

import type {
  ActionKind,
  Effect,
  TriggerEventKind,
} from './content/effects.js';
import type {
  AbilityId,
  CardId,
  CardInstanceId,
  ExposureFace,
  LocationId,
  NonColonyLocationId,
  SurvivorInstanceId,
} from './content/primitives.js';

export type { PlayerId };

/** Bumped whenever a persisted state's shape changes (see `migrateState`). */
export const STATE_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Settings (§1, §19)
 * ------------------------------------------------------------------ */

/**
 * The base mode.
 *
 * §19 presents six variants, but they are not six mutually exclusive things:
 * hardcore, betrayer and player-elimination are *modifiers* that layer onto a
 * base mode, while cooperative and Prisoner's Dilemma genuinely replace how
 * objectives and winning work. Modelling them as one flat enum would make
 * "cooperative + player elimination" unrepresentable, and nothing in §19 rules
 * that combination out.
 *
 * The two-player cooperative variant (§19.2) is `cooperative` at two seats
 * rather than its own mode, because §19.2 defines itself as "all cooperative
 * rules, plus" two setup deltas.
 */
export type GameMode = 'standard' | 'cooperative' | 'prisonersDilemma';

export const GAME_MODES: readonly GameMode[] = [
  'standard',
  'cooperative',
  'prisonersDilemma',
] as const;

/**
 * §19.6's three designer suggestions.
 *
 * §19.6 is explicit that these are "presented as personal suggestions" and must
 * be exposed "as the variant's documented defaults or separate toggles rather
 * than silently treating them as immutable base rules". Hence three booleans,
 * each defaulting to the suggestion.
 */
export interface PrisonersDilemmaOptions {
  /** Treat round-track zero exactly like morale zero. */
  roundZeroEndsLikeMoraleZero: boolean;
  /** Keep cards carrying the non-cooperative symbol in the decks. */
  keepNonCooperativeCards: boolean;
  /** Remove crossroads and other content that depends on exiled survivors. */
  removeExileDependentContent: boolean;
}

export interface GameSettings {
  /** Replayable random stream (§2.5, §22). Empty means "use the platform seed". */
  seed: string;
  playerCount: number;
  mode: GameMode;
  /** §19.4: use the hardcore side of the main objective. Forced on by `cooperative`. */
  hardcore: boolean;
  /** §19.3: set aside one non-betrayal objective per player instead of two. */
  betrayerVariant: boolean;
  /** §19.5: no last-survivor replacement; the player leaves the game. */
  playerElimination: boolean;
  /** §4.4 errata: the betrayal objective may be omitted for an easier game. */
  includeBetrayalObjective: boolean;
  /** §4.7: drop crossroads (and any other card) flagged for mature themes. */
  matureContentFilter: boolean;
  /** Chosen main objective, or `null` for a seeded random pick (§4.3). */
  mainObjectiveId: CardId | null;
  prisonersDilemma: PrisonersDilemmaOptions;
}

/* ------------------------------------------------------------------ *
 * Phases and steps (§5)
 * ------------------------------------------------------------------ */

export type Phase = 'setup' | 'playerTurns' | 'colony' | 'gameOver';

/** The seven ordered Colony Phase steps of §5.2. */
export type ColonyStep =
  | 'payFood'
  | 'checkWaste'
  | 'resolveCrisis'
  | 'addZombies'
  | 'checkMainObjective'
  | 'advanceRound'
  | 'passFirstPlayer';

export const COLONY_STEPS: readonly ColonyStep[] = [
  'payFood',
  'checkWaste',
  'resolveCrisis',
  'addZombies',
  'checkMainObjective',
  'advanceRound',
  'passFirstPlayer',
] as const;

/* ------------------------------------------------------------------ *
 * Board state (§2.1)
 * ------------------------------------------------------------------ */

/**
 * One numbered colony entrance, or the single entrance of a non-colony
 * location.
 *
 * §2.5: barricades and zombies are mutually exclusive occupants, so the two
 * counts together may never exceed `capacity`.
 */
export interface EntranceState {
  /** 1-based, matching the printed numbers used by the §12 placement cycle. */
  index: number;
  capacity: number;
  zombies: number;
  barricades: number;
}

export interface ColonyState {
  morale: number;
  maxMorale: number;
  /** Remaining rounds on the tracker (§11.6). */
  rounds: number;
  food: number;
  /** §11.1: persist through later successful feedings; removed only by effect. */
  starvation: number;
  /** §2.3: helpless survivors are tokens, not entities — a count is enough. */
  helpless: number;
  survivorSpaces: number;
  entrances: EntranceState[];
  /**
   * 0-based index of the entrance the *next* zombie goes to.
   *
   * §11.4: each new add-zombies sequence restarts at entrance 1, and crisis
   * placement must not advance the pointer the later Add Zombies step uses —
   * so the pointer is reset at batch start rather than carried forever.
   */
  entrancePointer: number;
  /** §11.2: ordered, newest last, so Clean Waste removes the newest first. */
  waste: CardInstanceId[];
}

export interface LocationState {
  id: NonColonyLocationId;
  survivorCapacity: number;
  /** The single entrance §12 gives a non-colony location. */
  entrance: EntranceState;
  /** §2.5: noise is counted individually because each token is rolled separately. */
  noise: number;
  noiseSpaces: number;
  /** Item deck, index 0 = top (§7.3). */
  deck: CardInstanceId[];
}

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

export interface SurvivorInstance {
  id: SurvivorInstanceId;
  cardId: CardId;
  controllerId: PlayerId;
  location: LocationId;
  /** §9.1: regular wounds and frostbite are counted separately but sum for death. */
  wounds: number;
  frostbite: number;
  equipped: CardInstanceId[];
  /** §8.4: at most one move per turn, cleared at turn start. */
  movedThisTurn: boolean;
  isLeader: boolean;
  /** §7.7 usage state, scoped as its name says. Keyed by ability id. */
  usedThisTurn: AbilityId[];
  usedThisRound: AbilityId[];
  usedThisGame: AbilityId[];
}

/**
 * An item card in play.
 *
 * Usage state lives here rather than on the holder because §18.5 rules that
 * once-per-round state "does not reset when its survivor dies and it returns to
 * hand, when it is re-equipped, or when it is handed off". Storing it on a
 * player would launder the usage on every transfer.
 */
export interface ItemInstance {
  iid: CardInstanceId;
  cardId: CardId;
  usedThisTurn: AbilityId[];
  usedThisRound: AbilityId[];
  usedThisGame: AbilityId[];
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  /** Seat order, clockwise. Turns pass left/up; the first player passes right/down (§15). */
  seatIndex: number;
  exiled: boolean;
  /** §19.5 only. An eliminated player keeps their seat but never acts again. */
  eliminated: boolean;
  leaderSurvivorId: SurvivorInstanceId | null;
  hand: CardInstanceId[];
  /** Normally one; §19.6 deals two. Empty in cooperative modes (§19.1). */
  secretObjectiveIds: CardId[];
  /** §14.1: attached on exile, modifying rather than replacing the original. */
  exiledObjectiveId: CardId | null;
  /** Objectives this player has been forced to reveal (§14.1). Public. */
  revealedObjectiveIds: CardId[];
  /** §6: dice belong to the group, not to a survivor. Values are d6 faces. */
  unusedDice: number[];
  usedDice: number[];
  /** §8.8: one exile nomination per turn. */
  nominatedThisTurn: boolean;
  connected: boolean;
}

/* ------------------------------------------------------------------ *
 * Decks and zones (§2.4)
 * ------------------------------------------------------------------ */

export interface DeckState {
  /** Undealt starter items; §4.8 returns these to the box. */
  starterItems: CardInstanceId[];
  survivors: CardId[];
  crossroads: CardId[];
  crisis: CardId[];
  exiledObjectives: CardId[];
  /**
   * §2.4 insists "returned to the box" during setup is not "removed from the
   * game" for card effects, so the two piles are genuinely separate.
   */
  returnedToBox: { items: CardInstanceId[]; survivors: CardId[]; objectives: CardId[] };
  removedFromGame: { items: CardInstanceId[]; survivors: CardId[] };
}

export interface CrisisState {
  cardId: CardId | null;
  /**
   * §3/§8.2: face down. The contributor is recorded so the count per player can
   * be published without the identity, and so §18.4's `Old Divisions` can
   * remove contributions without revealing them.
   */
  contributions: { playerId: PlayerId; iid: CardInstanceId }[];
}

export interface MainObjectiveState {
  cardId: CardId;
  side: 'standard' | 'hardcore';
  /** §3: face up and public. */
  contributions: CardInstanceId[];
  /** §8.3: reset each turn so an objective may cap the rate. */
  contributionsThisTurn: number;
  /** Scenario counters, e.g. samples taken (§18.2). */
  counters: Record<string, number>;
  /**
   * §18.2: `We Need More Samples` scales with "each player who started the
   * game", which the elimination variant would otherwise silently shrink.
   */
  startingPlayerCount: number;
}

/* ------------------------------------------------------------------ *
 * The effect machine (§17, §20)
 * ------------------------------------------------------------------ */

export type DeathCause = 'wounds' | 'bite' | 'overrun' | 'effect' | 'frostbite';

/**
 * Engine-internal effects.
 *
 * Rulebook procedures — placing one zombie, resolving one colony step, running
 * a bite chain — are expressed as effects rather than as straight-line code so
 * they inherit the same pause/resume machinery card effects use. §20 requires
 * the game to stop mid-procedure for a casualty choice and survive a
 * reconnection there; a procedure written as a `for` loop could not.
 *
 * The `i.` prefix keeps them out of the authored namespace: a content pack can
 * never emit one, because the schema's `Effect` union does not include them.
 */
export type InternalEffect =
  | { kind: 'i.beginRound' }
  | { kind: 'i.beginTurn'; playerId: PlayerId }
  | { kind: 'i.endTurn' }
  | { kind: 'i.colonyStep'; step: ColonyStep }
  /** One zombie, at one location, obeying §12's cycle/barricade/overrun rules. */
  | { kind: 'i.placeZombie'; location: LocationId; cycleEntrances: boolean }
  /** §11.4: every new add-zombies sequence restarts the colony cycle at entrance 1. */
  | { kind: 'i.resetEntrancePointer' }
  | { kind: 'i.overrun'; location: LocationId }
  /** One noise token removed and rolled; a 3 or lower adds a zombie (§11.4). */
  | { kind: 'i.noiseRoll'; location: NonColonyLocationId }
  /** §11.4's deferred morale test, legal only between complete batches. */
  | { kind: 'i.moraleCheckpoint' }
  | { kind: 'i.exposure'; survivorId: SurvivorInstanceId }
  | { kind: 'i.kill'; survivorId: SurvivorInstanceId; cause: DeathCause }
  /**
   * §9.2, resumable between links because each link is a controller choice.
   *
   * `deferred` carries the players whose last survivor died earlier in this
   * chain: §9.2 adds their replacement only "after the current location has no
   * eligible survivors and the bite effect ends", so the replacement cannot be
   * queued at the moment of death.
   */
  | {
      kind: 'i.biteChain';
      location: LocationId;
      excluded: SurvivorInstanceId[];
      deferred: PlayerId[];
    }
  | { kind: 'i.checkLastSurvivor'; playerId: PlayerId }
  | { kind: 'i.resolveExile'; playerId: PlayerId }
  | { kind: 'i.checkCrossroads' }
  | { kind: 'i.endGame'; reason: GameEndReason };

export type EngineEffect = Effect | InternalEffect;

/**
 * The context an effect resolves in.
 *
 * §17 demands "explicit card ownership, control, and current zone"; this is the
 * ownership half. `sourceInstanceId` is what makes §18.5's instance-scoped
 * once-per-round state addressable from inside a running effect.
 */
export interface EffectContext {
  sourceCardId: CardId | null;
  sourceInstanceId: CardInstanceId | null;
  controllerId: PlayerId | null;
  sourceSurvivorId: SurvivorInstanceId | null;
}

export interface EffectFrame {
  id: number;
  /** Remaining effects, in order. The head is executed next. */
  queue: EngineEffect[];
  /** Scratch values, written by `rollDie` and read by `variable` conditions. */
  vars: Record<string, number>;
  ctx: EffectContext;
}

export type ChoiceKind =
  | 'effectOption'
  | 'searchDecision'
  | 'biteTarget'
  | 'biteResponse'
  | 'overrunCasualty'
  | 'chooseNewLeader'
  | 'chooseSurvivor'
  | 'chooseLocation'
  | 'choosePlayer'
  | 'setupKeepSurvivors'
  | 'setupChooseLeader'
  | 'exileRelocate'
  | 'exileSwap'
  | 'lastSurvivorPlacement'
  | 'requestResponse'
  /** §8.7: the recipient's controller must consent to a hand-off. */
  | 'handOffConsent'
  | 'attractPlacement'
  | 'vote';

export interface ChoiceOption {
  id: string;
  label: string;
  /** §10: an option the chooser cannot satisfy is offered as illegal, not hidden. */
  legal: boolean;
  reason?: string;
}

/**
 * A decision the game is blocked on.
 *
 * Modelled as an explicit queue in state (§20) so a match can pause mid-effect
 * and resume after a reconnection with the choice — and its private option
 * list — intact.
 */
export interface PendingChoice {
  id: string;
  kind: ChoiceKind;
  /** Who must answer. `null` means every eligible voter (§15). */
  playerId: PlayerId | null;
  prompt: string;
  options: ChoiceOption[];
  /** How many option ids the answer must contain. Defaults to exactly one. */
  minPicks?: number;
  maxPicks?: number;
  /** Effects pushed when a given option is picked. */
  outcomes?: Record<string, EngineEffect>;
  /** Frame whose `vars` a numeric pick is written into. */
  frameId?: number;
  storeVar?: string;
  /** Structured payload the UI needs; redacted from everyone but `playerId`. */
  data?: Record<string, unknown>;
  /** §3: true when even the option *labels* are secret (search results). */
  private?: boolean;
}

/** An in-flight search (§7.3). Private to the searching player (§3). */
export interface SearchState {
  playerId: PlayerId;
  survivorId: SurvivorInstanceId;
  location: NonColonyLocationId;
  /** Cards inspected so far, not yet in any hand. */
  drawn: CardInstanceId[];
  noisePlaced: number;
}

/** An in-flight Request (§8.6). */
export interface RequestState {
  requesterId: PlayerId;
  targetId: PlayerId;
}

/** An in-flight exile vote or card-driven vote (§8.8, §15). */
export interface VoteState {
  prompt: string;
  /** Who may vote. §14.2 bars exiled players; §15 lets a card narrow it further. */
  electorate: PlayerId[];
  /** Committed simultaneously; identities stay hidden until every vote is in (§15). */
  votes: Record<PlayerId, boolean>;
  /**
   * Who has answered. Public even while the answers are not, so §21's
   * "require simultaneous secret vote commitments before revealing votes" can
   * show progress without showing content.
   */
  committed: PlayerId[];
  /** Set when this is an exile vote, so the engine knows what to do on `yes`. */
  nomineeId: PlayerId | null;
  /** Effects to run on the two outcomes when the vote came from a card. */
  onPass?: EngineEffect;
  onFail?: EngineEffect;
}

/* ------------------------------------------------------------------ *
 * Turn state (§6, §10)
 * ------------------------------------------------------------------ */

/**
 * An event worth testing a crossroads trigger against.
 *
 * Recorded as the action resolves, evaluated only once the effect stack is
 * empty — §10 requires the *entire* triggering action, "including movement
 * exposure, deaths, and other mandatory consequences", to finish first.
 */
export interface TurnEvent {
  event: TriggerEventKind;
  action?: ActionKind;
  survivorId?: SurvivorInstanceId;
  destination?: 'colony' | 'nonColony';
  moraleDirection?: 'up' | 'down';
  crisisOutcome?: 'prevented' | 'failed';
}

export interface TurnState {
  playerId: PlayerId;
  /** §10: the player on the active player's right draws and holds the card. */
  crossroadsHolderId: PlayerId;
  /** §3: known only to the holder until it triggers. */
  crossroadsCardId: CardId | null;
  crossroadsTriggered: boolean;
  events: TurnEvent[];
}

/* ------------------------------------------------------------------ *
 * Logs and outcome
 * ------------------------------------------------------------------ */

export type LogCategory =
  | 'setup'
  | 'phase'
  | 'turn'
  | 'dice'
  | 'action'
  | 'combat'
  | 'exposure'
  | 'death'
  | 'zombie'
  | 'crisis'
  | 'objective'
  | 'crossroads'
  | 'exile'
  | 'vote'
  | 'morale'
  | 'card'
  | 'effect'
  | 'endgame'
  | 'error';

export interface LogEntry extends CoreLogEntry {
  category: LogCategory;
  round: number;
  phase: Phase;
  /**
   * §3/§22: the public log must not leak hidden identities. Entries carrying
   * secrets are marked with the audience allowed to read them; redaction drops
   * everything else.
   */
  audience?: PlayerId[];
}

export type GameEndReason =
  | 'morale'
  | 'rounds'
  | 'mainObjective'
  | 'twoNonBetrayerExiles'
  | 'allPlayersEliminated'
  | 'effect';

export interface PlayerResult {
  playerId: PlayerId;
  won: boolean;
  /** Revealed only at game end (§16). */
  secretObjectiveIds: CardId[];
  exiledObjectiveId: CardId | null;
  objectiveComplete: boolean;
}

export interface GameOutcome {
  reason: GameEndReason;
  mainObjectiveComplete: boolean;
  /** §16: several players may win, and everyone may lose. */
  winners: PlayerId[];
  results: PlayerResult[];
}

/* ------------------------------------------------------------------ *
 * The state
 * ------------------------------------------------------------------ */

export interface GameState extends GameStateEnvelope {
  version: number;
  gameId: string;
  code: string;
  hostId: PlayerId;
  createdAt: number;
  updatedAt: number;

  settings: GameSettings;
  /** §22: the content version is pinned per match so a later patch cannot alter it. */
  contentPackId: string;
  contentVersion: string;
  /** §2.5, §22: seed plus cursor is the whole replayable random stream. */
  seed: string;
  rngCursor: number;

  phase: Phase;
  /**
   * Where inside §4's setup order the table is.
   *
   * Setup has two genuinely simultaneous decisions — every player keeps two of
   * four survivors (§4.10) and then names a group leader (§4.11) — so it needs
   * its own small state machine rather than a single "setting up" flag.
   */
  setupStage?: 'dealSurvivors' | 'keepSurvivors' | 'chooseLeader' | 'done';
  colonyStep: ColonyStep | null;
  round: number;
  /** §11.5: "survive X rounds" counts completed rounds, not the tracker. */
  roundsSurvived: number;

  /** Seating, clockwise. Turns go left along this array (§5.1). */
  seating: PlayerId[];
  firstPlayerId: PlayerId;
  /** Whose input the game waits on; `null` while resolving automatically. */
  activePlayerId: PlayerId | null;
  turn: TurnState | null;

  colony: ColonyState;
  locations: Record<string, LocationState>;
  players: Record<string, PlayerState>;
  survivors: Record<string, SurvivorInstance>;
  items: Record<string, ItemInstance>;

  decks: DeckState;
  crisis: CrisisState;
  mainObjective: MainObjectiveState;

  /** §20: the pending effect stack, choices and deferred morale checkpoint. */
  effectStack: EffectFrame[];
  pendingChoices: PendingChoice[];
  search: SearchState | null;
  request: RequestState | null;
  vote: VoteState | null;
  /** Set by §11.4 so a morale-zero seen mid-batch waits for the batch boundary. */
  deferMoraleCheck: boolean;

  /** Monotonic counters, so every minted id is deterministic. */
  nextSeq: number;

  log: LogEntry[];
  outcome: GameOutcome | null;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

/**
 * Everything a client may send.
 *
 * Every blocked decision funnels through `resolveChoice`, whatever produced it:
 * a card option, a bite response, an overrun casualty, a search continuation.
 * One action type means one out-of-turn rule, one redaction rule and one place
 * to audit, instead of a dozen near-identical ones.
 */
export type GameAction =
  /* die actions (§7) */
  | { type: 'attackZombie'; survivorId: SurvivorInstanceId; die: number; entrance?: number }
  | { type: 'attackSurvivor'; survivorId: SurvivorInstanceId; die: number; targetId: SurvivorInstanceId }
  | { type: 'search'; survivorId: SurvivorInstanceId; die: number }
  | { type: 'barricade'; survivorId: SurvivorInstanceId; die: number; entrance?: number }
  | { type: 'cleanWaste'; die: number }
  | {
      type: 'attract';
      survivorId: SurvivorInstanceId;
      die: number;
      from: LocationId;
      /** Which source entrances to pull from; colony sources may mix (§7.6). */
      fromEntrances?: number[];
      /** Destination entrances at the colony; free choice, no cycle (§7.6). */
      toEntrances?: number[];
      count: number;
    }
  | {
      type: 'useAbility';
      survivorId: SurvivorInstanceId;
      abilityId: AbilityId;
      /** Present for an equipped item's ability; absent for the survivor's own. */
      itemIid?: CardInstanceId;
      die?: number;
    }
  /* no-die actions (§8) */
  | { type: 'playItem'; iid: CardInstanceId; targetSurvivorId?: SurvivorInstanceId }
  | { type: 'contributeCrisis'; iids: CardInstanceId[] }
  | { type: 'contributeObjective'; iids: CardInstanceId[] }
  | { type: 'moveSurvivor'; survivorId: SurvivorInstanceId; to: LocationId }
  | { type: 'spendFood'; die: number; count: number }
  | { type: 'requestCards'; fromPlayerId: PlayerId }
  | { type: 'handOff'; iid: CardInstanceId; toSurvivorId: SurvivorInstanceId }
  | { type: 'nominateExile'; targetPlayerId: PlayerId }
  | { type: 'castVote'; vote: boolean }
  | { type: 'endTurn' }
  /* the universal decision channel */
  | { type: 'resolveChoice'; choiceId: string; optionIds: string[] };

/* ------------------------------------------------------------------ *
 * Small shared shapes
 * ------------------------------------------------------------------ */

/** Result of one exposure roll, for the log and for tests (§9.1). */
export interface ExposureResult {
  survivorId: SurvivorInstanceId;
  face: ExposureFace;
}

export type { ExposureFace, LocationId, NonColonyLocationId, CardId, CardInstanceId, SurvivorInstanceId, AbilityId };
