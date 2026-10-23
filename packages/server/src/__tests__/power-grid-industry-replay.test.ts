import { expect, it } from 'vitest';
import { erase } from '@tt/core';
import { powerGrid } from '@game/power-grid';
import { replayPersistedGame, hashReplayState } from '../persistence/replay.js';
import type { GameAuditEvent, PersistedGame } from '../persistence/types.js';

it('replays an Industry game including facility auctions, income and cash victory through the server audit contract', () => {
  const seats = ['p1', 'p2'].map((playerId, i) => ({ playerId, name: playerId, color: powerGrid.descriptor.seatColors[i]!, isBot: true, ready: true, joinedAt: 1 }));
  const settings = { ...powerGrid.defaultSettings(), playerCount: 2, rulesMode: 'industry' as const, moneyTarget: 250 };
  let state = powerGrid.createGame({ gameId: 'industry-replay', code: 'IND234', hostId: 'p1', seed: 'IND234-1', now: 1 }, settings, seats);
  expect(state.version).toBe(4);
  const events: GameAuditEvent[] = [{ type: 'start', sequence: 1, at: 1, hostId: 'p1', settings, seats, afterHash: hashReplayState(state), afterState: structuredClone(state) }];
  for (let i = 0; i < 1200 && state.phase !== 'gameOver'; i++) {
    const playerId = state.activePlayerId!;
    const proposed = powerGrid.defaultActionFor!(state, playerId)!;
    const action = powerGrid.parseAction(JSON.parse(JSON.stringify(proposed)))!;
    expect(powerGrid.validateAction(state, playerId, action).ok).toBe(true);
    const beforeHash = hashReplayState(state);
    state = powerGrid.applyAction(state, playerId, action, i + 2);
    events.push({ type: 'action', sequence: events.length + 1, at: i + 2, playerId, action, beforeHash, afterHash: hashReplayState(state) });
  }
  expect(state.phase).toBe('gameOver');
  expect(state.log.some(e => e.data?.event === 'facilityAcquired')).toBe(true);
  expect(state.log.some(e => e.data?.event === 'facilityIncome')).toBe(true);
  const record: PersistedGame = { gameId: 'industry-replay', gameKey: 'power-grid', code: 'IND234', hostId: 'p1', settings, seats, state, started: true, chat: [], createdAt: 1, updatedAt: 2000, auditSequence: events.length };
  const restored = JSON.parse(JSON.stringify(record)) as PersistedGame;
  expect(replayPersistedGame(erase(powerGrid), restored, events)).toEqual(state);
  expect(powerGrid.achievementAwards!(state)).toEqual([]);
});
