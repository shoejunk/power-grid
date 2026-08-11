/**
 * Dead of Winter's implementation of the platform contract.
 *
 * This file is the *only* place the game and the platform meet. Everything the
 * server would otherwise have to know — that a settings object names a variant,
 * that an action carries a die face, that a hand is hidden, that votes and
 * casualty choices bypass the turn clock — lives behind `GamePlugin`.
 *
 * Nothing above this file may import from `./engine`, `./content` or `./types`.
 */

import {
  invalid,
  isBool,
  isInt,
  isOneOf,
  isRecord,
  isString,
  OK,
  type CreateGameContext,
  type GamePlugin,
  type PlayerId,
  type SeatSeed,
  type ValidationResult,
} from '@tt/core';

import { descriptor, MAX_PLAYERS, MIN_PLAYERS } from './descriptor.js';
import { TEST_PACK } from './content/testPack.js';
import type { ContentIndex } from './content/schema.js';
import {
  applyHostChange as engineHostChange,
  applyAction as engineApply,
  createGame as engineCreateGame,
  redactStateFor as engineRedact,
  registerContentPack,
  validateAction as engineValidate,
} from './engine/index.js';
import {
  GAME_MODES,
  STATE_VERSION,
  type GameAction,
  type GameMode,
  type GameSettings,
  type GameState,
} from './types.js';

/* ------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------ */

/**
 * The pack a new table is created against.
 *
 * §22 requires a match to pin its content version so a later patch cannot alter
 * an in-progress or replayed game, which is why the *pack* is registered here
 * rather than passed in per game: `createGame` records `id@version` in state,
 * and `engine/state.getContentPack` refuses to substitute anything else.
 *
 * Until the licensed catalog ships this is the engine's own fixture, and the
 * lobby says so through the pack's name. Swapping it is a one-line change plus
 * a registration.
 */
const ACTIVE_PACK: ContentIndex = registerContentPack(TEST_PACK);

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function defaultSettings(): GameSettings {
  return {
    seed: '',
    playerCount: 4,
    mode: 'standard',
    hardcore: false,
    betrayerVariant: false,
    playerElimination: false,
    // §4.4 errata: the betrayal card may be omitted for an easier game. The
    // default is the printed rule, not the errata's option.
    includeBetrayalObjective: true,
    matureContentFilter: false,
    mainObjectiveId: null,
    // §19.6 presents its three points as suggestions; the defaults *are* the
    // suggestions, and each is separately switchable.
    prisonersDilemma: {
      roundZeroEndsLikeMoraleZero: true,
      keepNonCooperativeCards: true,
      removeExileDependentContent: true,
    },
  };
}

function parseSettingsPatch(raw: unknown): Partial<GameSettings> | null {
  if (!isRecord(raw)) return null;
  const out: Partial<GameSettings> = {};

  if ('mode' in raw) {
    if (!isOneOf<GameMode>(raw.mode, GAME_MODES)) return null;
    out.mode = raw.mode;
  }
  if ('playerCount' in raw) {
    if (!isInt(raw.playerCount) || raw.playerCount < MIN_PLAYERS || raw.playerCount > MAX_PLAYERS) {
      return null;
    }
    out.playerCount = raw.playerCount;
  }
  for (const flag of [
    'hardcore',
    'betrayerVariant',
    'playerElimination',
    'includeBetrayalObjective',
    'matureContentFilter',
  ] as const) {
    if (flag in raw) {
      if (!isBool(raw[flag])) return null;
      out[flag] = raw[flag];
    }
  }
  if ('mainObjectiveId' in raw && raw.mainObjectiveId !== null) {
    if (!isString(raw.mainObjectiveId) || raw.mainObjectiveId.length > 64) return null;
    out.mainObjectiveId = raw.mainObjectiveId;
  } else if ('mainObjectiveId' in raw) {
    out.mainObjectiveId = null;
  }
  if ('seed' in raw && raw.seed !== undefined) {
    if (!isString(raw.seed) || raw.seed.length > 64) return null;
    out.seed = raw.seed;
  }
  if ('prisonersDilemma' in raw) {
    const pd = raw.prisonersDilemma;
    if (!isRecord(pd)) return null;
    const parsed: GameSettings['prisonersDilemma'] = {
      roundZeroEndsLikeMoraleZero: true,
      keepNonCooperativeCards: true,
      removeExileDependentContent: true,
    };
    for (const key of [
      'roundZeroEndsLikeMoraleZero',
      'keepNonCooperativeCards',
      'removeExileDependentContent',
    ] as const) {
      if (key in pd) {
        if (!isBool(pd[key])) return null;
        parsed[key] = pd[key];
      }
    }
    out.prisonersDilemma = parsed;
  }
  return out;
}

/**
 * §1's player-count rules, which are per-mode rather than global.
 *
 * "Support 3-5 players for the standard hidden-objective game. Support 2
 * players through the cooperative two-player variant." The Prisoner's Dilemma
 * variant of §19.6 is explicitly two-player. The descriptor advertises the
 * union (2-5) so the portal can show one card; this narrows it once a mode is
 * chosen, and `seatCapacity` narrows the lobby to match.
 */
function seatBounds(settings: GameSettings): { min: number; max: number } {
  switch (settings.mode) {
    case 'prisonersDilemma':
      return { min: 2, max: 2 };
    case 'cooperative':
      return { min: 2, max: 5 };
    default:
      return { min: 3, max: 5 };
  }
}

function validateSettings(settings: GameSettings, seatCount: number): ValidationResult {
  const bounds = seatBounds(settings);
  if (settings.playerCount < bounds.min || settings.playerCount > bounds.max) {
    return invalid(
      settings.mode === 'prisonersDilemma'
        ? 'The Prisoner’s Dilemma variant is for exactly two players. §19.6'
        : settings.mode === 'cooperative'
          ? 'The cooperative game seats 2–5 players. §19.1, §19.2'
          : 'The standard hidden-objective game seats 3–5 players. §1',
    );
  }
  if (seatCount > settings.playerCount) {
    return invalid('Remove players before lowering the player count.');
  }
  if (seatCount > 0 && seatCount < bounds.min) {
    return invalid(`This mode needs at least ${bounds.min} players. §1`);
  }
  if (settings.mode === 'cooperative' && settings.betrayerVariant) {
    return invalid('A cooperative game deals no secret objectives, so there is no betrayer. §19.1');
  }
  if (
    settings.mainObjectiveId !== null &&
    !ACTIVE_PACK.mainObjectives.has(settings.mainObjectiveId)
  ) {
    return invalid('That main objective is not in the content pack.');
  }
  return OK;
}

/** The lobby's hard ceiling once a mode is chosen. */
function seatCapacity(settings: GameSettings): number {
  return Math.min(settings.playerCount, seatBounds(settings).max);
}

/* ------------------------------------------------------------------ *
 * Action parsing
 * ------------------------------------------------------------------ */

const isDie = (v: unknown): v is number => isInt(v) && v >= 1 && v <= 6;

/**
 * Structural check of an untrusted action payload — shape only.
 *
 * Nothing here consults the state: whether a die is in the pool, whether the
 * survivor exists, whether it is even this player's turn are all
 * `validateAction`'s business, and duplicating any of it here would create two
 * places for the rules to disagree.
 */
function parseAction(raw: unknown): GameAction | null {
  if (!isRecord(raw) || !isString(raw.type)) return null;
  switch (raw.type) {
    case 'attackZombie':
      if (!isString(raw.survivorId) || !isDie(raw.die)) return null;
      if (raw.entrance !== undefined && !isInt(raw.entrance)) return null;
      return {
        type: 'attackZombie',
        survivorId: raw.survivorId,
        die: raw.die,
        ...(raw.entrance !== undefined ? { entrance: raw.entrance as number } : {}),
      };

    case 'attackSurvivor':
      if (!isString(raw.survivorId) || !isDie(raw.die) || !isString(raw.targetId)) return null;
      return {
        type: 'attackSurvivor',
        survivorId: raw.survivorId,
        die: raw.die,
        targetId: raw.targetId,
      };

    case 'search':
      if (!isString(raw.survivorId) || !isDie(raw.die)) return null;
      return { type: 'search', survivorId: raw.survivorId, die: raw.die };

    case 'barricade':
      if (!isString(raw.survivorId) || !isDie(raw.die)) return null;
      if (raw.entrance !== undefined && !isInt(raw.entrance)) return null;
      return {
        type: 'barricade',
        survivorId: raw.survivorId,
        die: raw.die,
        ...(raw.entrance !== undefined ? { entrance: raw.entrance as number } : {}),
      };

    case 'cleanWaste':
      return isDie(raw.die) ? { type: 'cleanWaste', die: raw.die } : null;

    case 'attract': {
      if (!isString(raw.survivorId) || !isDie(raw.die) || !isString(raw.from)) return null;
      if (!isInt(raw.count) || raw.count < 0) return null;
      const entrances = (v: unknown): number[] | null =>
        v === undefined ? null : Array.isArray(v) && v.every(isInt) ? (v as number[]) : null;
      const from = entrances(raw.fromEntrances);
      const to = entrances(raw.toEntrances);
      if (raw.fromEntrances !== undefined && from === null) return null;
      if (raw.toEntrances !== undefined && to === null) return null;
      return {
        type: 'attract',
        survivorId: raw.survivorId,
        die: raw.die,
        from: raw.from as GameAction extends { from: infer F } ? F : never,
        count: raw.count,
        ...(from ? { fromEntrances: from } : {}),
        ...(to ? { toEntrances: to } : {}),
      } as GameAction;
    }

    case 'useAbility':
      if (!isString(raw.survivorId) || !isString(raw.abilityId)) return null;
      if (raw.die !== undefined && !isDie(raw.die)) return null;
      if (raw.itemIid !== undefined && !isString(raw.itemIid)) return null;
      return {
        type: 'useAbility',
        survivorId: raw.survivorId,
        abilityId: raw.abilityId,
        ...(raw.die !== undefined ? { die: raw.die as number } : {}),
        ...(raw.itemIid !== undefined ? { itemIid: raw.itemIid as string } : {}),
      };

    case 'playItem':
      if (!isString(raw.iid)) return null;
      if (raw.targetSurvivorId !== undefined && !isString(raw.targetSurvivorId)) return null;
      return {
        type: 'playItem',
        iid: raw.iid,
        ...(raw.targetSurvivorId !== undefined
          ? { targetSurvivorId: raw.targetSurvivorId as string }
          : {}),
      };

    case 'contributeCrisis':
    case 'contributeObjective': {
      if (!Array.isArray(raw.iids) || !raw.iids.every(isString)) return null;
      if (raw.iids.length === 0 || raw.iids.length > 64) return null;
      return { type: raw.type, iids: raw.iids as string[] };
    }

    case 'moveSurvivor':
      if (!isString(raw.survivorId) || !isString(raw.to)) return null;
      return { type: 'moveSurvivor', survivorId: raw.survivorId, to: raw.to } as GameAction;

    case 'spendFood':
      if (!isDie(raw.die) || !isInt(raw.count) || raw.count < 1 || raw.count > 5) return null;
      return { type: 'spendFood', die: raw.die, count: raw.count };

    case 'requestCards':
      return isString(raw.fromPlayerId)
        ? { type: 'requestCards', fromPlayerId: raw.fromPlayerId }
        : null;

    case 'handOff':
      return isString(raw.iid) && isString(raw.toSurvivorId)
        ? { type: 'handOff', iid: raw.iid, toSurvivorId: raw.toSurvivorId }
        : null;

    case 'nominateExile':
      return isString(raw.targetPlayerId)
        ? { type: 'nominateExile', targetPlayerId: raw.targetPlayerId }
        : null;

    case 'castVote':
      return isBool(raw.vote) ? { type: 'castVote', vote: raw.vote } : null;

    case 'endTurn':
      return { type: 'endTurn' };

    case 'resolveChoice': {
      if (!isString(raw.choiceId)) return null;
      if (!Array.isArray(raw.optionIds) || !raw.optionIds.every(isString)) return null;
      if (raw.optionIds.length === 0 || raw.optionIds.length > 32) return null;
      return { type: 'resolveChoice', choiceId: raw.choiceId, optionIds: raw.optionIds as string[] };
    }

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

function createGame(ctx: CreateGameContext, settings: GameSettings, seats: SeatSeed[]): GameState {
  return engineCreateGame(
    ctx,
    { ...settings, seed: settings.seed || ctx.seed, playerCount: seats.length },
    seats,
    ACTIVE_PACK,
  );
}

/* ------------------------------------------------------------------ *
 * Information control
 * ------------------------------------------------------------------ */

/**
 * §15 and §21 both describe genuinely concurrent decisions, and the platform
 * refuses out-of-turn input unless this says otherwise.
 *
 * Three kinds qualify:
 *
 *  - votes, which §15 requires to be simultaneous;
 *  - any pending choice addressed to this player — a bite response (§9.2), an
 *    overrun casualty (§12), a setup keep (§4.10) — because the player holding
 *    the clock is frequently *not* the player being asked;
 *  - giving a requested card (§8.6), which arrives as such a choice.
 */
function allowsOutOfTurn(state: GameState, playerId: PlayerId, action: GameAction): boolean {
  if (action.type === 'castVote') return true;
  if (action.type === 'resolveChoice') {
    return state.pendingChoices.some(
      (c) => c.id === action.choiceId && c.playerId === playerId,
    );
  }
  return false;
}

/**
 * Mirrors socket presence into the state so the board can dim an absent
 * player's survivors. Deliberately outside the reducer: presence is not a move,
 * it is never validated, and nothing a replay depends on is touched.
 */
function applyPresence(
  state: GameState,
  connected: Readonly<Record<PlayerId, boolean>>,
  _now: number,
): GameState {
  for (const [playerId, isConnected] of Object.entries(connected)) {
    const player = state.players[playerId];
    if (player) player.connected = isConnected;
  }
  return state;
}

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

/**
 * §22: "Card scripts must be versioned with the match so a later content patch
 * does not change an in-progress or replayed game."
 *
 * A persisted state names the pack it was built against. If that exact version
 * is no longer registered the match is unreadable — and saying so is the right
 * answer, because loading it against a different catalog would silently rewrite
 * the game. The server archives the table instead of crashing.
 */
function migrateState(raw: unknown): GameState | null {
  if (!isRecord(raw) || !isInt(raw.version)) return null;
  if (raw.version !== STATE_VERSION) return null;
  if (!isString(raw.contentPackId) || !isString(raw.contentVersion)) return null;
  if (raw.contentPackId !== TEST_PACK.id || raw.contentVersion !== TEST_PACK.version) return null;
  return raw as unknown as GameState;
}

/* ------------------------------------------------------------------ *
 * The plugin
 * ------------------------------------------------------------------ */

export const deadOfWinter: GamePlugin<GameState, GameAction, GameSettings> = {
  descriptor,

  defaultSettings,
  parseSettingsPatch,
  validateSettings,
  seatCapacity,

  parseAction,
  validateAction: engineValidate,
  applyAction: (state, playerId, action, now) => engineApply(state, playerId, action, now),

  createGame,
  activePlayerOf: (state) => state.activePlayerId,
  isGameOver: (state) => state.phase === 'gameOver',

  redactStateFor: engineRedact,
  allowsOutOfTurn,
  applyPresence,
  applyHostChange: engineHostChange,

  migrateState,
};

export default deadOfWinter;

export { ACTIVE_PACK };
export type { GameAction, GameSettings, GameState };
