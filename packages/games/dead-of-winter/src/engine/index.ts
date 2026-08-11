/**
 * Dead of Winter rules engine — public API.
 *
 *   createGame(ctx, settings, seats)          → GameState
 *   validateAction(state, playerId, action)   → ValidationResult
 *   applyAction(state, playerId, action, now) → GameState (new object)
 *
 * The reducer is pure and deterministic (§22): it never mutates its input,
 * never reads the clock or `Math.random`, and every random draw goes through
 * `Rng` seeded from `state.seed` + `state.rngCursor`, whose advanced position
 * is persisted back into the returned state.
 *
 * `applyAction` auto-advances: after the action lands it runs every automatic
 * transition — effects, deaths, zombie batches, colony steps, whole rounds —
 * until the game is once again waiting on a human. §5's "no phase or step may
 * advance while it has an unresolved choice" is what makes that safe: the
 * driver stops the moment a `PendingChoice` appears.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';

import type { ContentIndex } from '../content/schema.js';
import type { GameAction, GameState, PlayerId } from '../types.js';
import { contentOf, deepClone, getPlayer, pushLog, unshiftIntoCurrentFrame } from './state.js';
import { applyValidatedAction, validateAction } from './actions.js';
import { stepEffects } from './effects/runner.js';
import { checkCrossroadsTrigger, returnCrossroads } from './crossroads.js';
import { checkMoraleZero, endGame } from './endgame.js';
import {
  assignFirstPlayer,
  createGame as buildGame,
  dealSurvivorChoices,
  pushLeaderChoices,
} from './setup.js';

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export function createGame(
  ctx: CreateGameContext,
  settings: GameState['settings'],
  seats: SeatSeed[],
  content: ContentIndex,
): GameState {
  const state = buildGame(ctx, settings, seats, content);
  advance(state, ctx.now);
  return state;
}

/* ------------------------------------------------------------------ *
 * Reduction
 * ------------------------------------------------------------------ */

export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now: number = state.updatedAt,
): GameState {
  const verdict = validateAction(state, playerId, action);
  if (!verdict.ok) throw new Error(verdict.reason);

  const next = deepClone(state);
  next.updatedAt = now;
  applyValidatedAction(next, now, playerId, action);
  advance(next, now);
  return next;
}

/* ------------------------------------------------------------------ *
 * The driver
 * ------------------------------------------------------------------ */

/**
 * Runs every automatic transition until a human decision is required.
 *
 * The loop order encodes three rules that would otherwise be scattered:
 *
 *  - §16: morale zero ends the game immediately, *except* while §11.4's
 *    deferral is set during the Add Zombies sequence;
 *  - §5/§8.1: a pending choice or a queued effect outranks anything else, so a
 *    half-resolved death can never be overtaken by the next colony step;
 *  - §10: a crossroads trigger is tested only once the stack is empty, which is
 *    the structural form of "first finish the entire triggering action".
 */
export function advance(state: GameState, now: number): void {
  for (let guard = 0; guard < 100_000; guard++) {
    if (state.phase === 'gameOver') {
      state.activePlayerId = null;
      return;
    }

    if (checkMoraleZero(state, now)) continue;

    if (stepEffects(state, now)) continue;

    if (state.pendingChoices.length > 0) {
      const head = state.pendingChoices[0]!;
      // A simultaneous decision (a vote) names nobody; the platform reads
      // `allowsOutOfTurn` for those, so the clock stays where it was.
      state.activePlayerId = head.playerId ?? state.activePlayerId;
      return;
    }

    switch (state.phase) {
      case 'setup':
        if (advanceSetup(state, now)) continue;
        return;

      case 'playerTurns': {
        if (!state.turn) {
          unshiftIntoCurrentFrame(state, [{ kind: 'i.beginRound' }]);
          continue;
        }
        // §10: the trigger test happens here and nowhere else.
        if (checkCrossroadsTrigger(state, now)) continue;
        state.activePlayerId = state.turn.playerId;
        return;
      }

      case 'colony':
        // Colony steps are queued as effects; an empty stack here means the
        // phase finished and `passFirstPlayer` already queued the next round.
        return;

      default:
        return;
    }
  }
  /* istanbul ignore next — a settled game always reaches a return above. */
  throw new Error('advance(): the rules engine did not settle');
}

/**
 * §4's two simultaneous setup decisions, in order.
 *
 * Each stage is entered only once the previous stage's choices have all been
 * answered, because the driver returns while any choice is outstanding.
 */
function advanceSetup(state: GameState, now: number): boolean {
  switch (state.setupStage) {
    case 'dealSurvivors':
      dealSurvivorChoices(state, now);
      state.setupStage = 'keepSurvivors';
      return true;
    case 'keepSurvivors':
      pushLeaderChoices(state, now);
      state.setupStage = 'chooseLeader';
      return true;
    case 'chooseLeader':
      assignFirstPlayer(state, now);
      state.setupStage = 'done';
      pushLog(state, now, {
        category: 'setup',
        message: 'Setup is complete. The first winter round begins.',
        data: { event: 'setupComplete' },
      });
      unshiftIntoCurrentFrame(state, [{ kind: 'i.beginRound' }]);
      return true;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * Host handover
 * ------------------------------------------------------------------ */

/**
 * The platform promotes a new host when the old one leaves.
 *
 * Dead of Winter keeps `hostId` for provenance only — no rule consults it —
 * with one exception: §11.3's optional over-contribution prompt and §15's
 * tie-breaks are addressed to the *first player*, not the host, so nothing has
 * to be re-targeted. Recording the change keeps the audit log honest.
 */
export function applyHostChange(state: GameState, newHostId: PlayerId, now: number): GameState {
  if (state.hostId === newHostId) return state;
  const next = deepClone(state);
  next.hostId = newHostId;
  pushLog(next, now, {
    category: 'setup',
    playerId: newHostId,
    message: `${next.players[newHostId]?.name ?? newHostId} is now the host.`,
    data: { event: 'hostChanged', hostId: newHostId },
  });
  return next;
}

/* ------------------------------------------------------------------ *
 * Re-exports
 * ------------------------------------------------------------------ */

export { validateAction } from './actions.js';
export { redactStateFor } from './redact.js';
export * from './state.js';
export * from './policy.js';
export * from './setup.js';
export * from './survivors.js';
export * from './zombies.js';
export * from './crossroads.js';
export * from './exile.js';
export * from './endgame.js';
export * from './flow.js';
export * from './actions.js';
export * from './effects/conditions.js';
export * from './effects/runner.js';

export { contentOf, getPlayer, returnCrossroads, endGame };
