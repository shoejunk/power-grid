/**
 * Schema migration.
 *
 * A deployment upgrading from the single-game server has a database whose
 * `games` table has no `gameKey` column, and rows in it are somebody's
 * in-progress evening. `CREATE TABLE IF NOT EXISTS` does nothing to a table
 * that already exists, so without an explicit `ALTER` the new server would
 * read `undefined` for every row's game and quietly refuse to host any of them.
 *
 * These tests build a genuine old-shape database by hand and prove the upgrade
 * is lossless.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteGameStore } from '../persistence/sqliteStore.js';
import { LEGACY_GAME_KEY } from '../persistence/types.js';
import { makeDataDir, removeDataDir } from './helpers.js';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...args: unknown[]): unknown; all(): unknown[] };
    close(): void;
  };
};

/** The exact `games` schema the single-game server shipped. */
const OLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  gameId    TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  hostId    TEXT NOT NULL,
  settings  TEXT NOT NULL,
  seats     TEXT NOT NULL,
  state     TEXT,
  started   INTEGER NOT NULL DEFAULT 0,
  chat      TEXT NOT NULL DEFAULT '[]',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  gameId    TEXT NOT NULL,
  playerId  TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastSeen  INTEGER NOT NULL
);
`;

describe('sqlite schema migration', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) removeDataDir(dir);
  });

  function seedOldDatabase(): string {
    const dir = makeDataDir();
    dirs.push(dir);
    const file = path.join(dir, 'legacy.db');

    const db = new DatabaseSync(file);
    db.exec(OLD_SCHEMA);
    db.prepare(
      `INSERT INTO games (gameId, code, hostId, settings, seats, state, started, chat, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'game-1',
      'ABC234',
      'host-1',
      JSON.stringify({ mapId: 'germany', playerCount: 2 }),
      JSON.stringify([
        { playerId: 'host-1', name: 'Ada', color: 'red', isBot: false, ready: true, joinedAt: 1 },
      ]),
      JSON.stringify({ version: 1, phase: 'auction', round: 3 }),
      1,
      JSON.stringify([{ from: 'host-1', name: 'Ada', text: 'hi', at: 5 }]),
      1_700_000_000_000,
      Date.now(),
    );
    db.prepare(
      'INSERT INTO sessions (token, gameId, playerId, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?)',
    ).run('token-1', 'game-1', 'host-1', 1, 2);
    db.close();

    return file;
  }

  it('adds the gameKey column without touching existing rows', () => {
    const file = seedOldDatabase();
    const store = new SqliteGameStore(file);
    try {
      const games = store.loadGames();
      expect(games).toHaveLength(1);
      const game = games[0]!;

      // Every pre-existing row was a Power Grid table by construction.
      expect(game.gameKey).toBe(LEGACY_GAME_KEY);
      // Nothing else moved.
      expect(game.gameId).toBe('game-1');
      expect(game.code).toBe('ABC234');
      expect(game.hostId).toBe('host-1');
      expect(game.started).toBe(true);
      expect(game.settings).toEqual({ mapId: 'germany', playerCount: 2 });
      expect(game.seats.map((s) => s.name)).toEqual(['Ada']);
      expect(game.state).toEqual({ version: 1, phase: 'auction', round: 3 });
      expect(game.chat).toHaveLength(1);

      // Sessions survive, so a player's token still resumes their seat.
      expect(store.loadSessions().map((s) => s.token)).toEqual(['token-1']);
    } finally {
      store.close();
    }
  });

  it('is idempotent — reopening a migrated database is a no-op', () => {
    const file = seedOldDatabase();
    const first = new SqliteGameStore(file);
    first.close();
    const second = new SqliteGameStore(file);
    try {
      expect(second.loadGames()).toHaveLength(1);
      expect(second.loadGames()[0]?.gameKey).toBe(LEGACY_GAME_KEY);
    } finally {
      second.close();
    }
  });

  it('round-trips a game from a title the migration knows nothing about', () => {
    const file = seedOldDatabase();
    const store = new SqliteGameStore(file);
    try {
      store.saveGame({
        gameId: 'game-2',
        gameKey: 'dead-of-winter',
        code: 'XYZ789',
        hostId: 'host-2',
        settings: { variant: 'hardcore' },
        seats: [],
        state: { version: 1, morale: 7 },
        started: true,
        chat: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const byKey = Object.fromEntries(store.loadGames().map((g) => [g.gameKey, g]));
      expect(Object.keys(byKey).sort()).toEqual(['dead-of-winter', 'power-grid']);
      expect(byKey['dead-of-winter']?.state).toEqual({ version: 1, morale: 7 });
      expect(byKey['dead-of-winter']?.settings).toEqual({ variant: 'hardcore' });
    } finally {
      store.close();
    }
  });

  it('leaves a database created fresh by the new server unchanged', () => {
    const dir = makeDataDir();
    dirs.push(dir);
    const file = path.join(dir, 'fresh.db');
    const store = new SqliteGameStore(file);
    try {
      expect(fs.existsSync(file)).toBe(true);
      expect(store.loadGames()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
