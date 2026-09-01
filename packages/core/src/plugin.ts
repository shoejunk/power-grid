/**
 * The contract between the platform and a game.
 *
 * The server hosts tables, mints join codes, owns sockets, persists state and
 * decides who is allowed to speak. It knows *nothing* about rules. Every
 * question it cannot answer from seats and sockets alone is asked of a
 * `GamePlugin`:
 *
 *   "is this settings payload well-formed?"      → parseSettingsPatch
 *   "may this table start?"                      → validateSettings
 *   "is this action well-formed?"                → parseAction
 *   "is this action legal right now?"            → validateAction
 *   "what happens next?"                         → applyAction
 *   "whose input am I waiting on?"               → activePlayerOf
 *   "may this player act out of turn?"           → allowsOutOfTurn
 *   "what must I hide from this recipient?"      → redactStateFor
 *   "what should a bot do?"                      → defaultActionFor
 *
 * That list is deliberately exhaustive. If the server ever needs to branch on
 * `gameKey` to answer something, the branch belongs behind a new method here
 * instead — otherwise game-specific knowledge leaks back into the platform.
 *
 * The three type parameters are erased at the server boundary
 * (`AnyGamePlugin`), which is safe because every value crossing that boundary
 * either came out of the plugin or was validated by it first.
 */

import type {
  CreateGameContext,
  GameKey,
  GameStateEnvelope,
  PlayerId,
  SeatColor,
  SeatSeed,
  ValidationResult,
} from './types.js';

/* ------------------------------------------------------------------ *
 * Descriptor
 * ------------------------------------------------------------------ */

/**
 * Everything the portal needs to advertise a game without importing it.
 *
 * This is data, not behaviour, so the home page can render a full game picker
 * from the registry alone.
 */
export interface GameDescriptor {
  key: GameKey;
  /** Display name, e.g. "Dead of Winter". */
  name: string;
  /** One line under the title on the portal card. */
  tagline: string;
  /** A paragraph for the game's detail panel. */
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  /** Typical length, shown on the portal card, e.g. "60–120 min". */
  playTime: string;
  /** Seat colours, in the order they are handed out. Must be unique. */
  seatColors: readonly SeatColor[];
  /** Whether the lobby may add automated seats. */
  supportsBots: boolean;
  /**
   * CSS custom properties the portal applies when previewing or entering this
   * game, so each title keeps its own identity inside one shared shell.
   */
  theme: {
    /** Primary accent, used for the portal card and in-game highlights. */
    accent: string;
    /** Deep background colour behind the game's own art. */
    backdrop: string;
    /** Ink colour that reads on `backdrop`. */
    ink: string;
  };
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

export interface GamePlugin<
  TState extends GameStateEnvelope = GameStateEnvelope,
  TAction = unknown,
  TSettings = unknown,
> {
  readonly descriptor: GameDescriptor;

  /* -- settings ---------------------------------------------------- */

  /** Settings a brand-new lobby starts with. */
  defaultSettings(): TSettings;

  /**
   * Structural check of an untrusted settings patch from a client.
   * Returns `null` when malformed — the server rejects the frame and never
   * looks inside the payload itself.
   */
  parseSettingsPatch(raw: unknown): Partial<TSettings> | null;

  /**
   * Rules-level check of a complete settings object against the seated
   * players. Called both when the host edits settings and again at start.
   */
  validateSettings(settings: TSettings, seatCount: number): ValidationResult;

  /**
   * How many seats this table accepts, given its settings.
   *
   * Defaults to `descriptor.maxPlayers`. Games override it when the host may
   * size the table below the game's ceiling — "a four-player game" is a real
   * setting, and without this the lobby would happily seat a sixth player into
   * a table configured for four and only fail at start.
   */
  seatCapacity?(settings: TSettings): number;

  /* -- actions ----------------------------------------------------- */

  /**
   * Structural check of an untrusted action payload. Shape only — whether the
   * move is *legal* is `validateAction`'s job.
   */
  parseAction(raw: unknown): TAction | null;

  /** Pure check. Must not mutate `state`. */
  validateAction(state: TState, playerId: PlayerId, action: TAction): ValidationResult;

  /**
   * Applies a *previously validated* action and returns the next state.
   * Must be pure and deterministic: no clock, no `Math.random`. `now` is
   * supplied so log timestamps are real without the game reading the clock.
   */
  applyAction(state: TState, playerId: PlayerId, action: TAction, now: number): TState;

  /**
   * Optional audit-aware reducer. The returned transitions are the individual
   * automatic steps that happened after the player action, each with its own
   * private checkpoint. The server may persist these without knowing the
   * owning game's rules or state shape.
   */
  auditAction?(state: TState, playerId: PlayerId, action: TAction, now: number): {
    state: TState;
    automaticTransitions: ReadonlyArray<{
      trigger: string;
      beforeState: TState;
      afterState: TState;
    }>;
  };

  /* -- lifecycle --------------------------------------------------- */

  /** Builds a fully set-up state from finalised settings and seats. */
  createGame(ctx: CreateGameContext, settings: TSettings, seats: SeatSeed[]): TState;

  /**
   * Whose input the game is waiting on; `null` when it is resolving
   * automatically or is over. The server uses this only to decide when to run
   * a bot seat — never to decide legality, which is `validateAction`'s job.
   */
  activePlayerOf(state: TState): PlayerId | null;

  isGameOver(state: TState): boolean;

  /* -- information control ----------------------------------------- */

  /**
   * Returns the view of `state` that `playerId` is allowed to see, with every
   * hidden card, sealed bid and private objective stripped or masked.
   *
   * This is the *only* thing standing between a hidden-information game and a
   * player reading the answer out of a WebSocket frame, so it must be
   * exhaustive rather than best-effort. Implementations should redact by
   * construction — build the view from what is public — rather than by
   * deleting known-secret fields from a full clone.
   *
   * Pass `null` for a spectator or an audit projection.
   */
  redactStateFor(state: TState, playerId: PlayerId | null): TState;

  /**
   * True when this action is legal outside the single active-player clock:
   * sealed bids, simultaneous votes, and any other genuinely concurrent
   * decision. The server refuses out-of-turn input unless this says otherwise.
   */
  allowsOutOfTurn(state: TState, playerId: PlayerId, action: TAction): boolean;

  /* -- presence ---------------------------------------------------- */

  /**
   * Optional: fold live socket presence into the game state.
   *
   * Presence is a platform fact, not a rule, so it lives on the lobby by
   * default and most games need nothing here. It is offered as a hook because
   * some games genuinely want it *inside* their state — to grey out an absent
   * player's board, to pause a timer, to log that somebody dropped — and
   * threading it through as an action would be worse: presence changes are not
   * moves, they are not validated, and they must not appear in a replay.
   *
   * Implementations must be pure and must not change anything a replay
   * depends on. Returning `state` unchanged is always correct.
   */
  applyPresence?(state: TState, connected: Readonly<Record<PlayerId, boolean>>, now: number): TState;

  /* -- host handover ----------------------------------------------- */

  /**
   * Tells the game that the table's host has changed.
   *
   * The platform owns who the host *is* — it promotes the longest-seated
   * connected player when a host leaves — but a game that gates decisions on
   * the host (a setup choice, a variant selection) keeps its own copy and must
   * be told, or the table strands: the new host is refused because the game
   * still names the old one, and the old host is refused because they are gone.
   *
   * Implementations should also hand over any decision that was pending on the
   * departing host. Returning `state` unchanged is correct for games that
   * never consult the host.
   */
  applyHostChange?(state: TState, newHostId: PlayerId, now: number): TState;

  /* -- automation -------------------------------------------------- */

  /**
   * The move an automated seat should make. Returning `null` means "no
   * opinion"; the server then falls back to `safeDefaultActions`.
   */
  defaultActionFor?(state: TState, playerId: PlayerId): TAction | null;

  /**
   * Pass-like moves to try, in order, when `defaultActionFor` has no opinion.
   * The server probes each against `validateAction` and plays the first legal
   * one, so a game that cannot plan a move still never stalls a table.
   */
  safeDefaultActions?(state: TState, playerId: PlayerId): TAction[];

  /* -- migration --------------------------------------------------- */

  /**
   * Upgrades a persisted state written by an older build of this game.
   * Return `null` when the state is unreadable; the server then archives the
   * table rather than crashing the whole server on boot.
   */
  migrateState?(raw: unknown): TState | null;
}

/** The plugin as the server sees it, with its type parameters erased. */
export type AnyGamePlugin = GamePlugin<GameStateEnvelope, unknown, unknown>;

/**
 * Erases a plugin's type parameters for storage in the registry.
 *
 * The cast is contained here rather than sprinkled through the server, and it
 * is sound because every `unknown` the server hands back to a plugin method
 * originated from that same plugin: actions come from its own `parseAction`,
 * settings from its own `parseSettingsPatch`, and state from its own
 * `createGame` / `applyAction`.
 */
export function erase<S extends GameStateEnvelope, A, C>(
  plugin: GamePlugin<S, A, C>,
): AnyGamePlugin {
  return plugin as unknown as AnyGamePlugin;
}
