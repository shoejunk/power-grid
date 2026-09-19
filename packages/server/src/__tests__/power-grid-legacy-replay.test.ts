import { expect, it } from 'vitest';
import { erase } from '@tt/core';
import { powerGrid } from '@game/power-grid';
import { replayPersistedGame, hashReplayState } from '../persistence/replay.js';
import type { GameAuditEvent, PersistedGame } from '../persistence/types.js';

it.each([1, 2])('replays Power Grid rules version %i across zone selection and resource purchases', version => {
  const seats = ['p1', 'p2'].map((playerId, i) => ({ playerId, name: playerId, color: powerGrid.descriptor.seatColors[i]!, isBot: false, ready: true, joinedAt: 1 }));
  const settings = { ...powerGrid.defaultSettings(), playerCount: 2 };
  let state = powerGrid.createGame({ gameId: 'replay', code: 'ABC234', hostId: 'p1', seed: 'ABC234-1', now: 1, replayVersion: version }, settings, seats);
  expect(state.zone).toHaveLength(version === 1 ? 2 : 3);
  const events: GameAuditEvent[] = [{ type: 'start', sequence: 1, at: 1, hostId: 'p1', settings, seats, afterHash: hashReplayState(state), afterState: structuredClone(state) }];
  let bought = false;
  for (let i = 0; i < 60; i++) {
    const playerId = state.activePlayerId!;
    const action = powerGrid.defaultActionFor!(state, playerId)!;
    const beforeHash = hashReplayState(state);
    state = powerGrid.applyAction(state, playerId, action, i + 2);
    if (action.type === 'buyResources') bought = true;
    events.push({ type: 'action', sequence: events.length + 1, at: i + 2, playerId, action, beforeHash, afterHash: hashReplayState(state) });
  }
  expect(bought).toBe(true);
  const record: PersistedGame = { gameId: 'replay', gameKey: 'power-grid', code: 'ABC234', hostId: 'p1', settings, seats, state, started: true, chat: [], createdAt: 1, updatedAt: 100, auditSequence: events.length };
  expect(replayPersistedGame(erase(powerGrid), record, events)).toEqual(state);
});
