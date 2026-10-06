import path from 'node:path';
import { expect, it } from 'vitest';
import { erase } from '@tt/core';
import { powerGrid } from '@game/power-grid';
import { awardAchievements } from '../achievements.js';
import { MemoryGameStore } from '../persistence/memoryStore.js';
import { JsonFileGameStore } from '../persistence/jsonStore.js';
import { SqliteGameStore } from '../persistence/sqliteStore.js';
import type { GameStore, PersistedGame } from '../persistence/types.js';
import { boot, makeDataDir, removeDataDir } from './helpers.js';

function finished(store: GameStore): PersistedGame {
  const seats = ['p1', 'p2'].map((playerId, i) => ({ playerId, name: playerId, color: powerGrid.descriptor.seatColors[i]!, isBot: false, ready: true, joinedAt: 1 }));
  const settings = { ...powerGrid.defaultSettings(), playerCount: 2 };
  const state = powerGrid.createGame({ gameId: 'game', code: 'ABC234', hostId: 'p1', seed: 'awards', now: 1 }, settings, seats);
  state.phase = 'gameOver'; state.winnerId = 'p1';
  const game: PersistedGame = { gameId: 'game', code: 'ABC234', gameKey: 'power-grid', hostId: 'p1', settings, state, seats, started: true, chat: [], createdAt: 1, updatedAt: 20 };
  store.saveGame(game);
  store.appendAuditEvent('game', { type: 'start', at: 1, hostId: 'p1', settings, seats });
  store.saveSession({ token: 'one', playerId: 'p1', gameId: 'game', accountId: 'account1', createdAt: 1, lastSeen: 1 });
  store.saveSession({ token: 'two', playerId: 'p2', gameId: 'game', accountId: 'account2', createdAt: 1, lastSeen: 1 });
  return game;
}

it.each(['memory', 'json', 'sqlite'] as const)('persists account awards idempotently in %s, independently of game cleanup', backend => {
  const dir = makeDataDir();
  const open = (): GameStore => backend === 'sqlite' ? new SqliteGameStore(path.join(dir, 'awards.db')) : backend === 'json' ? new JsonFileGameStore(path.join(dir, 'awards.json')) : new MemoryGameStore();
  let store = open();
  try {
    const game = finished(store);
    awardAchievements(store, erase(powerGrid), game);
    awardAchievements(store, erase(powerGrid), game);
    expect(store.loadAchievements('account1').map(a => a.achievementId).sort()).toEqual(['first-finish', 'first-win', 'win-without-scrapping']);
    expect(store.loadAchievements('account2').map(a => a.achievementId)).toEqual(['first-finish']);
    store.deleteGame('game');
    if (backend !== 'memory') { store.close(); store = open(); }
    expect(store.loadAchievements('account1')).toHaveLength(3);
    expect(store.loadAchievements('stranger')).toEqual([]);
  } finally { store.close(); removeDataDir(dir); }
});

it('rejects bot-only competition, incomplete histories and two seats owned by one account', () => {
  for (const reason of ['bot', 'no-history', 'same-account', 'not-over']) {
    const store = new MemoryGameStore();
    const game = finished(store);
    if (reason === 'bot') game.seats[1]!.isBot = true;
    if (reason === 'no-history') game.gameId = 'legacy';
    if (reason === 'same-account') store.saveSession({ ...store.loadSessions()[1]!, accountId: 'account1' });
    if (reason === 'not-over') (game.state as { phase: string }).phase = 'resources';
    awardAchievements(store, erase(powerGrid), game);
    expect(store.loadAchievements('account1')).toEqual([]);
  }
});

it.each(['memory', 'json', 'sqlite'] as const)('persists the expanded awards once per account in %s', backend => {
  const dir = makeDataDir();
  const open = (): GameStore => backend === 'sqlite' ? new SqliteGameStore(path.join(dir, 'expanded.db')) : backend === 'json' ? new JsonFileGameStore(path.join(dir, 'expanded.json')) : new MemoryGameStore();
  let store = open();
  try {
    const game = finished(store);
    const state = game.state as ReturnType<typeof powerGrid.createGame>;
    state.log.push(
      { id: 100, at: 2, round: 2, phase: 'auction', step: 1, category: 'auction', playerId: 'p1', message: 'Auction won', data: { event: 'plantAcquired', plantId: 21, plants: [10, 21], price: 76, via: 'auction' } },
      { id: 101, at: 3, round: 2, phase: 'resources', step: 1, category: 'resource', playerId: 'p1', message: 'Resource market exhausted', data: { event: 'resourcesBought', blockedResourceBuyers: [{ playerId: 'p2', resource: 'coal' }] } },
      { id: 102, at: 4, round: 2, phase: 'bureaucracy', step: 1, category: 'power', playerId: 'p1', message: 'Ten cities powered', data: { event: 'citiesPowered', citiesSupplied: 10 } },
    );
    awardAchievements(store, erase(powerGrid), game);
    awardAchievements(store, erase(powerGrid), game);
    store.deleteGame(game.gameId);
    if (backend !== 'memory') { store.close(); store = open(); }
    const awards = store.loadAchievements('account1');
    expect(awards.map(a => a.achievementId).sort()).toEqual(['asshole', 'big-upgrade', 'expensive-auction', 'first-finish', 'first-win', 'power-ten', 'win-without-scrapping']);
    expect(awards.find(a => a.achievementId === 'big-upgrade')!.name).toBe('Big Upgrade');
    expect(store.loadAchievements('account2').map(a => a.achievementId)).toEqual(['first-finish']);
  } finally { store.close(); removeDataDir(dir); }
});

it('an earlier scrap disqualifies Built to Last even when that plant is gone', () => {
  const store = new MemoryGameStore();
  const game = finished(store);
  (game.state as { log: unknown[] }).log.push({ playerId: 'p1', data: { event: 'plantScrapped', plantId: 5 } });
  awardAchievements(store, erase(powerGrid), game);
  expect(store.loadAchievements('account1').map(a => a.achievementId)).toEqual(['first-finish', 'first-win']);
});

it('reads only the starting roster when awarding a completed game', () => {
  const store = new MemoryGameStore();
  const game = finished(store);
  const start = store.loadAuditEvents(game.gameId)[0]!;
  let closed = false;
  store.loadAuditEvents = () => { throw new Error('Must not materialize history'); };
  store.iterateAuditEvents = function* () {
    try {
      yield start;
      throw new Error('Must not read historical state checkpoints');
    } finally { closed = true; }
  };
  awardAchievements(store, erase(powerGrid), game);
  expect(closed).toBe(true);
  expect(store.loadAchievements('account1')).toHaveLength(3);
});

it('serves own and other public achievement profiles without credentials or email', async () => {
  const server = await boot({ storeKind: 'memory' });
  try {
    server.store.saveAccount({ accountId: 'a', name: 'Ada', email: 'private@example.test', passwordHash: 'secret-hash', createdAt: 1, lastSeen: 1 });
    server.store.saveAchievement({ accountId: 'a', gameKey: 'power-grid', achievementId: 'first-win', name: 'Power Player', description: 'Win', gameId: 'private-game', earnedAt: 20 });
    const body = await (await fetch(`${server.url}/api/achievements?accountId=a`)).json();
    expect(body.profile.achievements).toHaveLength(1);
    expect(body.players).toEqual([{ id: 'a', name: 'Ada' }]);
    expect(JSON.stringify(body)).not.toMatch(/private@example|secret-hash|private-game/);
  } finally { await server.close(); }
});
