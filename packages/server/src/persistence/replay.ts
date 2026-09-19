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

/** Verifies that a stored private checkpoint is the state it claims to be. */
function verifySnapshotHash(
  gameId: string,
  sequence: number,
  expected: string | undefined,
  snapshot: unknown,
  label: 'before' | 'after',
): void {
  if (snapshot === undefined || expected === undefined) return;
  const actual = hashReplayState(snapshot);
  if (actual !== expected) {
    throw new Error(
      `Audit ${label} snapshot mismatch for ${gameId}:${sequence}: expected ${expected}, got ${actual}`,
    );
  }
}

export function replayPersistedGame(
  plugin: AnyGamePlugin,
  record: PersistedGame,
  events: Iterable<GameAuditEvent>,
): unknown {
  if (!record.started) throw new Error(`Cannot replay a lobby: ${record.gameId}`);
  // Consume each checkpoint once, without retaining the full audit history.
  const iterator = events[Symbol.iterator]();
  try {
    const first = iterator.next();
    if (first.done) throw new Error(`Missing start audit event: ${record.gameId}`);
    let lastSequence = 0;
    const verifySequence = (event: GameAuditEvent): void => {
      if (event.sequence !== lastSequence + 1) {
        throw new Error(
          `Audit sequence gap for ${record.gameId}: expected ${lastSequence + 1}, got ${event.sequence}`,
        );
      }
      lastSequence = event.sequence;
    };

    const start = first.value;
    verifySequence(start);
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
        replayVersion: (start.afterState as { version?: number } | undefined)?.version
          ?? (record.state as { version?: number } | null)?.version ?? 1,
      },
      start.settings,
      seats,
    );

    verifyHash(record.gameId, start.sequence, start.afterHash, state, 'after');
    verifySnapshotHash(record.gameId, start.sequence, start.afterHash, start.afterState, 'after');
    let priorTransition = false;
    let pendingAutomaticAfterHash: string | null = null;

    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      const event = next.value;
      verifySequence(event);
      if (event.type === 'automatic') {
        // The owning plugin applies a player action atomically, but an audit-aware
        // plugin may expose the automatic portion as a sequence of checkpoints.
        // These annotations are not applied a second time during replay; their
        // private snapshots are verified as a contiguous chain whose final state
        // must equal the already-settled plugin result.
        if (!priorTransition) {
          throw new Error(`Automatic audit event has no preceding transition: ${record.gameId}:${event.sequence}`);
        }
        if (pendingAutomaticAfterHash !== null && event.beforeHash !== pendingAutomaticAfterHash) {
          throw new Error(`Automatic audit checkpoint chain mismatch for ${record.gameId}:${event.sequence}`);
        }
        verifySnapshotHash(record.gameId, event.sequence, event.beforeHash, event.beforeState, 'before');
        verifySnapshotHash(record.gameId, event.sequence, event.afterHash, event.afterState, 'after');
        pendingAutomaticAfterHash = event.afterHash;
        continue;
      }
      if (pendingAutomaticAfterHash !== null) {
        verifyHash(record.gameId, event.sequence - 1, pendingAutomaticAfterHash, state, 'after');
        pendingAutomaticAfterHash = null;
      }
      if (event.type === 'hostChange') {
        if (!plugin.applyHostChange) {
          throw new Error(`Plugin cannot replay host change for ${record.gameId}`);
        }
        verifyHash(record.gameId, event.sequence, event.beforeHash, state, 'before');
        verifySnapshotHash(record.gameId, event.sequence, event.beforeHash, event.beforeState, 'before');
        state = plugin.applyHostChange(state as never, event.hostId, event.at);
        verifyHash(record.gameId, event.sequence, event.afterHash, state, 'after');
        verifySnapshotHash(record.gameId, event.sequence, event.afterHash, event.afterState, 'after');
        priorTransition = event.beforeHash !== undefined && event.afterHash !== undefined;
        continue;
      }
      if (event.type !== 'action') throw new Error(`Unexpected setup event: ${record.gameId}:${event.sequence}`);

      const action = plugin.parseAction(event.action);
      if (action === null) {
        throw new Error(`Malformed audited action: ${record.gameId}:${event.sequence}`);
      }
      verifyHash(record.gameId, event.sequence, event.beforeHash, state, 'before');
      verifySnapshotHash(record.gameId, event.sequence, event.beforeHash, event.beforeState, 'before');
      const verdict = plugin.validateAction(state as never, event.playerId, action);
      if (!verdict.ok) {
        throw new Error(`Illegal audited action at ${record.gameId}:${event.sequence}: ${verdict.reason}`);
      }
      state = plugin.applyAction(state as never, event.playerId, action, event.at);
      verifyHash(record.gameId, event.sequence, event.afterHash, state, 'after');
      verifySnapshotHash(record.gameId, event.sequence, event.afterHash, event.afterState, 'after');
      priorTransition = event.beforeHash !== undefined && event.afterHash !== undefined;
    }
    if (pendingAutomaticAfterHash !== null) {
      verifyHash(record.gameId, lastSequence, pendingAutomaticAfterHash, state, 'after');
    }
    return state;
  } finally {
    iterator.return?.();
  }
}
