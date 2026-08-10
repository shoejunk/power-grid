/**
 * SQLite persistence built on Node's *built-in* `node:sqlite` module.
 *
 * Chosen over better-sqlite3 / sql.js because it needs no native build step
 * (a real problem on Windows without a toolchain) and no WASM shim: Node 22+
 * ships the driver. Writes are synchronous, which is exactly what we want —
 * when `saveGame()` returns, the game is durable, so an action can never be
 * acknowledged to clients before it is on disk.
 *
 * The schema is deliberately document-shaped: the authoritative `GameState`
 * is owned by the rules engine and evolves independently of the server, so
 * shredding it into columns would couple the two. `GameState.version` carries
 * the schema version for future migrations.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { LEGACY_GAME_KEY, type GameStore, type PersistedGame, type SessionRecord } from './types.js';

/**
 * `node:sqlite` is loaded through `createRequire` rather than a static import.
 * Two reasons: bundlers (Vite, used by vitest) key their built-in module list
 * on the un-prefixed name "sqlite", which Node does not expose, so a static
 * import breaks under test tooling; and a runtime require lets the store
 * factory catch the failure on Node builds without SQLite and fall back to
 * JSON persistence instead of crashing at module-load time.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string, options?: unknown) => DatabaseSyncType;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  gameId    TEXT PRIMARY KEY,
  gameKey   TEXT NOT NULL DEFAULT '${LEGACY_GAME_KEY}',
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
CREATE INDEX IF NOT EXISTS idx_games_updated ON games(updatedAt);
/* The gameKey index is created in migrate(), not here: on a database written
   by the single-game server the CREATE TABLE above is a no-op, so the column
   does not exist yet and indexing it would fail before the ALTER can run. */

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  gameId    TEXT NOT NULL,
  playerId  TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastSeen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_game ON sessions(gameId);
`;

interface GameRow {
  gameId: string;
  gameKey: string | null;
  code: string;
  hostId: string;
  settings: string;
  seats: string;
  state: string | null;
  started: number;
  chat: string;
  createdAt: number;
  updatedAt: number;
}

interface SessionRow {
  token: string;
  gameId: string;
  playerId: string;
  createdAt: number;
  lastSeen: number;
}

export class SqliteGameStore implements GameStore {
  readonly kind = 'sqlite' as const;
  readonly location: string;
  private readonly db: DatabaseSyncType;

  constructor(filePath: string) {
    this.location = filePath;
    if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    // WAL keeps readers from blocking the (single) writer and survives an
    // ungraceful shutdown; NORMAL sync is the usual WAL durability trade-off.
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    } catch {
      /* :memory: and some filesystems reject WAL — not fatal. */
    }
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Forward-only schema migrations.
   *
   * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
   * so a database written by the single-game server keeps its old column set
   * until it is altered here. Every migration must be safe to run repeatedly
   * and must never lose a row: an in-progress game is somebody's evening.
   */
  private migrate(): void {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(games)').all() as unknown as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!columns.has('gameKey')) {
      // Every pre-existing row is a Power Grid table by construction: the
      // server hosted nothing else when they were written.
      this.db.exec(
        `ALTER TABLE games ADD COLUMN gameKey TEXT NOT NULL DEFAULT '${LEGACY_GAME_KEY}'`,
      );
    }
    // Safe to run every boot, and it must come after the ALTER above.
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_games_key ON games(gameKey)');
  }

  loadGames(): PersistedGame[] {
    const rows = this.db.prepare('SELECT * FROM games ORDER BY updatedAt DESC').all() as unknown as GameRow[];
    const games: PersistedGame[] = [];
    for (const row of rows) {
      try {
        games.push({
          gameId: row.gameId,
          gameKey: row.gameKey ?? LEGACY_GAME_KEY,
          code: row.code,
          hostId: row.hostId,
          settings: JSON.parse(row.settings),
          seats: JSON.parse(row.seats),
          state: row.state ? JSON.parse(row.state) : null,
          started: row.started === 1,
          chat: JSON.parse(row.chat),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      } catch {
        // A corrupt row must not stop the server from serving every other game.
        this.deleteGame(row.gameId);
      }
    }
    return games;
  }

  saveGame(game: PersistedGame): void {
    this.db
      .prepare(
        `INSERT INTO games (gameId, gameKey, code, hostId, settings, seats, state, started, chat, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(gameId) DO UPDATE SET
           gameKey=excluded.gameKey, code=excluded.code, hostId=excluded.hostId,
           settings=excluded.settings, seats=excluded.seats, state=excluded.state,
           started=excluded.started, chat=excluded.chat, updatedAt=excluded.updatedAt`,
      )
      .run(
        game.gameId,
        game.gameKey,
        game.code,
        game.hostId,
        JSON.stringify(game.settings),
        JSON.stringify(game.seats),
        game.state ? JSON.stringify(game.state) : null,
        game.started ? 1 : 0,
        JSON.stringify(game.chat),
        game.createdAt,
        game.updatedAt,
      );
  }

  deleteGame(gameId: string): void {
    this.db.prepare('DELETE FROM games WHERE gameId = ?').run(gameId);
    this.deleteSessionsForGame(gameId);
  }

  loadSessions(): SessionRecord[] {
    const rows = this.db.prepare('SELECT * FROM sessions').all() as unknown as SessionRow[];
    return rows.map((r) => ({
      token: r.token,
      gameId: r.gameId,
      playerId: r.playerId,
      createdAt: r.createdAt,
      lastSeen: r.lastSeen,
    }));
  }

  saveSession(session: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (token, gameId, playerId, createdAt, lastSeen)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET lastSeen=excluded.lastSeen`,
      )
      .run(session.token, session.gameId, session.playerId, session.createdAt, session.lastSeen);
  }

  deleteSessionsForGame(gameId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE gameId = ?').run(gameId);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}
