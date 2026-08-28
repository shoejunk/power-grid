/**
 * Rebuilds a started table from its immutable audit stream.
 *
 * This module deliberately knows only the platform plugin contract. The
 * server does not deserialize or interpret a game's action vocabulary; it
 * asks the plugin to parse, validate, and apply each recorded request again.
 */

import { createHash } from 'node:crypto';
import type { AnyGamePlugin, SeatSeed } from '@tt/core';
import type { GameAuditEvent, PersistedGame } from './types.js';

/** Canonical JSON for an opaque, JSON-serializable game state. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}

/** SHA-256 checkpoint for an opaque game state. */
export function hashReplayState(state: unknown): string {
  return createHash('sha256').update(canonicalJson(state), 'utf8').digest('hex');
}

function verifyHash(
  gameId: string,
  sequence: number,
  expected: string | undefined,
  state: unknown,
  label: 'before' | 'after',
): void {
  if (expected === undefined) return;
  const actual = hashReplayState(state);
  if (actual !== expected) {
    throw new Error(
      `Audit ${label} checkpoint mismatch for ${gameId}:${sequence}: expected ${expected}, got ${actual}`,
    );
  }
}

export function replayPersistedGame(
  plugin: AnyGamePlugin,
  record: PersistedGame,
  events: readonly GameAuditEvent[],
): unknown {
  if (!record.started) throw new Error(`Cannot replay a lobby: ${record.gameId}`);
  if (events.length === 0) throw new Error(`Missing start audit event: ${record.gameId}`);

  let expectedSequence = 1;
  for (const event of events) {
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Audit sequence gap for ${record.gameId}: expected ${expectedSequence}, got ${event.sequence}`,
      );
    }
    expectedSequence += 1;
  }

  const start = events[0];
  if (start?.type !== 'start') {
    throw new Error(`Audit stream does not start with setup: ${record.gameId}`);
  }

  const seats: SeatSeed[] = start.seats.map(({ playerId, name, color, isBot }) => ({
    playerId,
    name,
    color,
    isBot,
  }));
  let state = plugin.createGame(
    {
      gameId: record.gameId,
      code: record.code,
      hostId: start.hostId,
      seed: `${record.code}-${record.createdAt}`,
      now: start.at,
    },
    start.settings,
    seats,
  );

  verifyHash(record.gameId, start.sequence, start.afterHash, state, 'after');
  let lastTransition: { beforeHash: string; afterHash: string } | null = null;

  for (const event of events.slice(1)) {
    if (event.type === 'automatic') {
      // applyAction is atomic at the plugin boundary: the returned state already
      // includes its automatic consequences. This entry is an explicit replay
      // annotation for that settled transition, not a second application of the
      // same effects. It must point at the immediately preceding move so a
      // deleted/reordered annotation cannot silently pass validation.
      if (lastTransition === null) {
        throw new Error(`Automatic audit event has no preceding transition: ${record.gameId}:${event.sequence}`);
      }
      if (
        event.beforeHash !== lastTransition.beforeHash ||
        event.afterHash !== lastTransition.afterHash
      ) {
        throw new Error(`Automatic audit transition mismatch for ${record.gameId}:${event.sequence}`);
      }
      verifyHash(record.gameId, event.sequence, event.afterHash, state, 'after');
      continue;
    }
    if (event.type === 'hostChange') {
      if (!plugin.applyHostChange) {
        throw new Error(`Plugin cannot replay host change for ${record.gameId}`);
      }
      verifyHash(record.gameId, event.sequence, event.beforeHash, state, 'before');
      state = plugin.applyHostChange(state as never, event.hostId, event.at);
      verifyHash(record.gameId, event.sequence, event.afterHash, state, 'after');
      if (event.beforeHash !== undefined && event.afterHash !== undefined) {
        lastTransition = { beforeHash: event.beforeHash, afterHash: event.afterHash };
      } else {
        lastTransition = null;
      }
      continue;
    }
    if (event.type !== 'action') throw new Error(`Unexpected setup event: ${record.gameId}:${event.sequence}`);

    const action = plugin.parseAction(event.action);
    if (action === null) {
      throw new Error(`Malformed audited action: ${record.gameId}:${event.sequence}`);
    }
    verifyHash(record.gameId, event.sequence, event.beforeHash, state, 'before');
    const verdict = plugin.validateAction(state as never, event.playerId, action);
    if (!verdict.ok) {
      throw new Error(`Illegal audited action at ${record.gameId}:${event.sequence}: ${verdict.reason}`);
    }
    state = plugin.applyAction(state as never, event.playerId, action, event.at);
    verifyHash(record.gameId, event.sequence, event.afterHash, state, 'after');
    if (event.beforeHash !== undefined && event.afterHash !== undefined) {
      lastTransition = { beforeHash: event.beforeHash, afterHash: event.afterHash };
    } else {
      lastTransition = null;
    }
  }
  return state;
}
