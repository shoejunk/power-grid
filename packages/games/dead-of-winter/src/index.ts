/**
 * `@game/dead-of-winter` — public API.
 *
 * The platform only ever touches `deadOfWinter`; everything else is exported
 * for this game's own client code and tests.
 *
 * The domain model and the content vocabulary belong to that second group. A
 * client has to narrow the platform's opaque `state` into something it can
 * draw, and it has to turn a card *instance* id into a card *name*, so both the
 * state shapes and the active content pack are published here. None of it hands
 * a client any authority: the server re-validates every action, and
 * `redactStateFor` has already decided what that client was allowed to see.
 */

export * from './descriptor.js';
export * from './plugin.js';

/* -- domain model -------------------------------------------------- */

export type {
  ChoiceKind,
  ChoiceOption,
  ColonyState,
  ColonyStep,
  CrisisState,
  DeathCause,
  DeckState,
  EntranceState,
  ExposureResult,
  GameEndReason,
  GameMode,
  GameOutcome,
  ItemInstance,
  LocationState,
  LogCategory,
  LogEntry,
  MainObjectiveState,
  PendingChoice,
  Phase,
  PlayerResult,
  PlayerState,
  PrisonersDilemmaOptions,
  RequestState,
  SearchState,
  SurvivorInstance,
  TurnState,
  VoteState,
} from './types.js';

export { COLONY_STEPS, GAME_MODES, STATE_VERSION } from './types.js';

/* -- content vocabulary -------------------------------------------- */

export {
  ALL_LOCATIONS,
  COLONY,
  COLONY_ENTRANCE_COUNT,
  EXPOSURE_FACES,
  ITEM_SYMBOLS,
  NON_COLONY_LOCATIONS,
  isColony,
} from './content/primitives.js';

export type {
  AbilityId,
  CardId,
  CardInstanceId,
  ExposureFace,
  ItemSymbol,
  LocationId,
  NonColonyLocationId,
  SurvivorInstanceId,
} from './content/primitives.js';

export type {
  ContentIndex,
  ContentPack,
  CrisisCardDefinition,
  CrossroadsCardDefinition,
  ItemCardDefinition,
  LocationDefinition,
  MainObjectiveDefinition,
  MainObjectiveSide,
  SecretObjectiveDefinition,
  SurvivorCardDefinition,
} from './content/schema.js';
