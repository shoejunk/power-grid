/**
 * Rebuilds a started table from its immutable audit stream.
 *
 * This module deliberately knows only the platform plugin contract. The
 * server does not deserialize or interpret a game's action vocabulary; it
 * asks the plugin to parse, validate, and apply each recorded request again.
 */

import type { AnyGamePlugin, SeatSeed } from '@tt/core';
import type { GameAuditEvent, PersistedGame } from './types.js';

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

  for (const event of events.slice(1)) {
    if (event.type === 'hostChange') {
      if (!plugin.applyHostChange) {
        throw new Error(`Plugin cannot replay host change for ${record.gameId}`);
      }
      state = plugin.applyHostChange(state as never, event.hostId, event.at);
      continue;
    }
    if (event.type !== 'action') throw new Error(`Unexpected setup event: ${record.gameId}:${event.sequence}`);

    const action = plugin.parseAction(event.action);
    if (action === null) {
      throw new Error(`Malformed audited action: ${record.gameId}:${event.sequence}`);
    }
    const verdict = plugin.validateAction(state as never, event.playerId, action);
    if (!verdict.ok) {
      throw new Error(`Illegal audited action at ${record.gameId}:${event.sequence}: ${verdict.reason}`);
    }
    state = plugin.applyAction(state as never, event.playerId, action, event.at);
  }
  return state;
}

