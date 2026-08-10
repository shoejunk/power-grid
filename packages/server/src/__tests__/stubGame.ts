/**
 * A deterministic, hermetic *fake game* for the server's integration tests.
 *
 * The point of this file is not to be a good game — it is to be a game the
 * server has never heard of. Before the platform rewrite the tests injected a
 * Power-Grid-shaped fake, which meant a server that had quietly grown
 * Power-Grid-specific behaviour would still pass. This one shares no
 * vocabulary with any shipping title, so anything the server gets right about
 * it, it gets right structurally.
 *
 * It implements exactly enough to exercise the transport contract:
 *
 *  - a turn clock (`activePlayerOf`),
 *  - a legal/illegal move distinction (`validateAction`),
 *  - observable state change (`applyAction`),
 *  - hidden information (`redactStateFor`) — a face-down deck and sealed
 *    ballots, so redaction is genuinely tested rather than assumed,
 *  - a simultaneous decision (`allowsOutOfTurn`) — sealed ballots, which every
 *    eligible player may answer while only one holds the clock,
 *  - presence folded into state (`applyPresence`),
 *  - and a safe default move, so the bot-seat path runs.
 */

import {
  invalid,
  isBool,
  isInt,
  isRecord,
  isString,
  OK,
  type CreateGameContext,
  type GameDescriptor,
  type GamePlugin,
  type PlayerId,
  type SeatSeed,
  type ValidationResult,
} from '@tt/core';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export type StubPhase = 'claiming' | 'over';

export interface StubPlayer {
  id: PlayerId;
  name: string;
  color: string;
  isBot: boolean;
  credits: number;
  claimed: number[];
  orderIndex: number;
  status: 'eligible' | 'acting' | 'claimed' | 'passed';
  connected: boolean;
  lastSeen: number;
}

export type StubBallotAnswer =
  | { status: 'for'; weight: number }
  | { status: 'against' }
  /** What another player's answer looks like once redacted. */
  | { status: 'sealed' };

export interface StubBallot {
  topic: string;
  eligible: PlayerId[];
  /** Missing means the player has not answered yet. */
  answers: Partial<Record<PlayerId, StubBallotAnswer>>;
}

export interface StubState {
  version: number;
  gameId: string;
  code: string;
  hostId: PlayerId;
  settings: StubSettings;
  phase: StubPhase;
  round: number;
  players: Record<PlayerId, StubPlayer>;
  order: PlayerId[];
  activePlayerId: PlayerId | null;
  /** Face-up, claimable. */
  market: number[];
  /** Face down. Redacted to a run of -1 for every recipient. */
  deck: number[];
  ballot: StubBallot | null;
  log: { id: number; playerId?: PlayerId; message: string; at: number }[];
  createdAt: number;
  updatedAt: number;
}

export interface StubSettings {
  tableSize: number;
  variant: 'plain' | 'spiced';
  seed: string;
}

export type StubAction =
  | { type: 'claim'; itemId: number; cost: number }
  | { type: 'pass' }
  | { type: 'castBallot'; support: boolean; weight: number };

/** Placeholder id substituted for face-down cards before broadcast. */
export const HIDDEN_ITEM = -1;

/** Face-down deck, so the redaction path is exercised on every broadcast. */
const DECK = [20, 21, 22, 23, 24];

export const STUB_GAME_KEY = 'stub';

const descriptor: GameDescriptor = {
  key: STUB_GAME_KEY,
  name: 'Stub',
  tagline: 'A game the server has never heard of.',
  blurb: 'Test fixture. Not a real title.',
  minPlayers: 2,
  maxPlayers: 4,
  playTime: '0 min',
  seatColors: ['alpha', 'beta', 'gamma', 'delta'],
  supportsBots: true,
  theme: { accent: '#888888', backdrop: '#111111', ink: '#eeeeee' },
};

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

function parseSettingsPatch(raw: unknown): Partial<StubSettings> | null {
  if (!isRecord(raw)) return null;
  const out: Partial<StubSettings> = {};
  if ('tableSize' in raw) {
    if (!isInt(raw.tableSize) || raw.tableSize < 2 || raw.tableSize > 4) return null;
    out.tableSize = raw.tableSize;
  }
  if ('variant' in raw) {
    if (raw.variant !== 'plain' && raw.variant !== 'spiced') return null;
    out.variant = raw.variant;
  }
  if ('seed' in raw && raw.seed !== undefined) {
    if (!isString(raw.seed) || raw.seed.length > 64) return null;
    out.seed = raw.seed;
  }
  return out;
}

function parseAction(raw: unknown): StubAction | null {
  if (!isRecord(raw) || !isString(raw.type)) return null;
  switch (raw.type) {
    case 'claim':
      return isInt(raw.itemId) && isInt(raw.cost) && raw.cost >= 0
        ? { type: 'claim', itemId: raw.itemId, cost: raw.cost }
        : null;
    case 'pass':
      return { type: 'pass' };
    case 'castBallot':
      return isBool(raw.support) && isInt(raw.weight) && raw.weight >= 0
        ? { type: 'castBallot', support: raw.support, weight: raw.weight }
        : null;
    default:
      return null;
  }
}

function createGame(ctx: CreateGameContext, settings: StubSettings, seats: SeatSeed[]): StubState {
  const order = seats.map((s) => s.playerId); // deterministic: lobby order
  const players: Record<PlayerId, StubPlayer> = {};
  seats.forEach((s, i) => {
    players[s.playerId] = {
      id: s.playerId,
      name: s.name,
      color: s.color,
      isBot: s.isBot,
      credits: 50,
      claimed: [],
      orderIndex: i,
      status: 'eligible',
      connected: false,
      lastSeen: 0,
    };
  });

  return {
    version: 1,
    gameId: ctx.gameId,
    code: ctx.code,
    hostId: ctx.hostId,
    settings,
    phase: 'claiming',
    round: 1,
    players,
    order,
    activePlayerId: order[0] ?? null,
    market: [3, 4, 5, 6],
    deck: [...DECK],
    ballot: null,
    log: [],
    // Fixed, not `ctx.now`: two runs must produce byte-identical states.
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function validateAction(state: StubState, playerId: PlayerId, action: StubAction): ValidationResult {
  if (!state.players[playerId]) return invalid('You are not in this game.');
  if (state.phase === 'over') return invalid('The game is over.');

  if (action.type === 'castBallot') {
    if (!state.ballot) return invalid('No ballot is open.');
    if (!state.ballot.eligible.includes(playerId)) return invalid('You are not eligible to vote.');
    if (state.ballot.answers[playerId] !== undefined) return invalid('You already answered.');
    return OK;
  }

  if (state.activePlayerId !== playerId) return invalid('It is not your turn.');

  switch (action.type) {
    case 'pass':
      return OK;
    case 'claim':
      if (!state.market.includes(action.itemId)) return invalid('That item is not on the market.');
      if (action.cost < action.itemId) return invalid('Offer below the minimum.');
      if ((state.players[playerId]?.credits ?? 0) < action.cost) {
        return invalid('You cannot afford that.');
      }
      return OK;
    default:
      return invalid('Unknown action.');
  }
}

function applyAction(
  state: StubState,
  playerId: PlayerId,
  action: StubAction,
  _now: number,
): StubState {
  const next = structuredClone(state);
  const player = next.players[playerId];
  if (!player) return next;

  if (action.type === 'castBallot' && next.ballot) {
    next.ballot.answers[playerId] = action.support
      ? { status: 'for', weight: action.weight }
      : { status: 'against' };
    return next;
  }

  if (action.type === 'claim') {
    player.credits -= action.cost;
    player.claimed.push(action.itemId);
    next.market = next.market.filter((id) => id !== action.itemId);
    player.status = 'claimed';
  } else {
    player.status = 'passed';
  }

  next.log.push({
    id: next.log.length + 1,
    playerId,
    message: `${player.name}: ${action.type}`,
    at: 1_700_000_000_000 + next.log.length,
  });

  const idx = next.order.indexOf(playerId);
  const nextIdx = (idx + 1) % Math.max(1, next.order.length);
  if (nextIdx === 0) {
    next.round += 1;
    for (const id of next.order) {
      const p = next.players[id];
      if (p) p.status = 'eligible';
    }
  }
  next.activePlayerId = next.order[nextIdx] ?? null;
  // Deterministic: never `Date.now()`, so two runs produce identical states.
  next.updatedAt = state.updatedAt + 1;
  return next;
}

/**
 * Hides the face-down deck from everyone and other players' ballot answers
 * from each recipient, while keeping *whether* they have answered public — the
 * same shape of secrecy a real hidden-information game needs.
 */
function redactStateFor(state: StubState, playerId: PlayerId | null): StubState {
  const view = structuredClone(state);
  view.deck = view.deck.map(() => HIDDEN_ITEM);
  if (view.ballot) {
    for (const id of view.ballot.eligible) {
      if (id === playerId || view.ballot.answers[id] === undefined) continue;
      view.ballot.answers[id] = { status: 'sealed' };
    }
  }
  return view;
}

export const stubGame: GamePlugin<StubState, StubAction, StubSettings> = {
  descriptor,

  defaultSettings: () => ({ tableSize: 4, variant: 'plain', seed: '' }),
  parseSettingsPatch,
  validateSettings: (settings, seatCount) => {
    if (settings.tableSize < descriptor.minPlayers || settings.tableSize > descriptor.maxPlayers) {
      return invalid(`Table size must be ${descriptor.minPlayers}–${descriptor.maxPlayers}.`);
    }
    if (settings.tableSize < seatCount) return invalid('Remove players before shrinking the table.');
    return OK;
  },

  parseAction,
  validateAction,
  applyAction,

  createGame,
  activePlayerOf: (state) => state.activePlayerId,
  isGameOver: (state) => state.phase === 'over',

  redactStateFor,
  allowsOutOfTurn: (state, _playerId, action) =>
    state.ballot !== null && action.type === 'castBallot',

  seatCapacity: (settings) => settings.tableSize,

  applyHostChange: (state, newHostId) => {
    state.hostId = newHostId;
    return state;
  },

  applyPresence: (state, connected, now) => {
    for (const [id, isConnected] of Object.entries(connected)) {
      const p = state.players[id];
      if (!p) continue;
      p.connected = isConnected;
      if (isConnected) p.lastSeen = now;
    }
    return state;
  },

  defaultActionFor: (state, playerId) =>
    state.activePlayerId === playerId ? { type: 'pass' } : null,
  safeDefaultActions: () => [{ type: 'pass' }],
};
