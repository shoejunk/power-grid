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
import {
  type AccountRecord,
  type AuthSessionRecord,
  LEGACY_GAME_KEY,
  type GameAuditEvent,
  type GameAuditEventInput,
  type GameStore,
  type PersistedGame,
  type SessionRecord,
} from './types.js';

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
  auditSequence INTEGER,
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
  accountId TEXT,
  createdAt INTEGER NOT NULL,
  lastSeen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_game ON sessions(gameId);

CREATE TABLE IF NOT EXISTS accounts (
  accountId TEXT PRIMARY KEY,
  email     TEXT NOT NULL,
  name      TEXT NOT NULL,
  picture   TEXT,
  createdAt INTEGER NOT NULL,
  lastSeen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token     TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastSeen  INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(accountId);

CREATE TABLE IF NOT EXISTS audit_events (
  gameId    TEXT NOT NULL,
  sequence  INTEGER NOT NULL,
  type      TEXT NOT NULL,
  at        INTEGER NOT NULL,
  hostId    TEXT,
  playerId  TEXT,
  settings  TEXT,
  seats     TEXT,
  action    TEXT,
  PRIMARY KEY (gameId, sequence)
);
CREATE INDEX IF NOT EXISTS idx_audit_events_game ON audit_events(gameId, sequence);
`;

interface GameRow {
  gameId: string;
  gameKey: string | null;
  code: string;
  hostId: string;
  settings: string;
  seats: string;
  state: string | null;
  auditSequence: number | null;
  started: number;
  chat: string;
  createdAt: number;
  updatedAt: number;
}

interface SessionRow {
  token: string;
  gameId: string;
  playerId: string;
  accountId: string | null;
  createdAt: number;
  lastSeen: number;
}

interface AccountRow {
  accountId: string;
  email: string;
  name: string;
  picture: string | null;
  createdAt: number;
  lastSeen: number;
}

interface AuthSessionRow {
  token: string;
  accountId: string;
  createdAt: number;
  lastSeen: number;
  expiresAt: number;
}

interface AuditRow {
  gameId: string;
  sequence: number;
  type: string;
  at: number;
  hostId: string | null;
  playerId: string | null;
  settings: string | null;
  seats: string | null;
  action: string | null;
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
    if (!columns.has('auditSequence')) {
      // NULL marks a pre-audit snapshot. It must keep using the snapshot path
      // until a future start creates a complete stream with its setup event.
      this.db.exec('ALTER TABLE games ADD COLUMN auditSequence INTEGER');
    }
    const sessionColumns = new Set(
      (this.db.prepare('PRAGMA table_info(sessions)').all() as unknown as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!sessionColumns.has('accountId')) {
      // Existing seat tokens remain valid as anonymous migration tokens. A
      // signed-in player can claim their old token once after Google login.
      this.db.exec('ALTER TABLE sessions ADD COLUMN accountId TEXT');
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
          ...(row.auditSequence !== null ? { auditSequence: row.auditSequence } : {}),
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

  private writeGame(game: PersistedGame): void {
    this.db
      .prepare(
        `INSERT INTO games (gameId, gameKey, code, hostId, settings, seats, state, auditSequence, started, chat, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(gameId) DO UPDATE SET
           gameKey=excluded.gameKey, code=excluded.code, hostId=excluded.hostId,
           settings=excluded.settings, seats=excluded.seats, state=excluded.state,
           auditSequence=excluded.auditSequence, started=excluded.started,
           chat=excluded.chat, updatedAt=excluded.updatedAt`,
      )
      .run(
        game.gameId,
        game.gameKey,
        game.code,
        game.hostId,
        JSON.stringify(game.settings),
        JSON.stringify(game.seats),
        game.state ? JSON.stringify(game.state) : null,
        game.auditSequence === undefined ? null : game.auditSequence,
        game.started ? 1 : 0,
        JSON.stringify(game.chat),
        game.createdAt,
        game.updatedAt,
      );
  }

  saveGame(game: PersistedGame): void {
    this.writeGame(game);
  }

  saveGameWithAudit(game: PersistedGame, events: readonly GameAuditEventInput[]): void {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) AS lastSequence FROM audit_events WHERE gameId = ?')
      .get(game.gameId) as unknown as { lastSequence: number };
    const expected = game.auditSequence ?? row.lastSequence + events.length;
    if (expected !== row.lastSequence + events.length) {
      throw new Error(`Audit sequence mismatch for ${game.gameId}`);
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (let i = 0; i < events.length; i += 1) {
        const event = events[i]!;
        const sequence = row.lastSequence + i + 1;
        const settings = event.type === 'start' ? JSON.stringify(event.settings) : null;
        const seats = event.type === 'start' ? JSON.stringify(event.seats) : null;
        const action = event.type === 'action' ? JSON.stringify(event.action) : null;
        const hostId = event.type === 'start' || event.type === 'hostChange' ? event.hostId : null;
        const playerId = event.type === 'action' ? event.playerId : null;
        this.db
          .prepare(
            `INSERT INTO audit_events (gameId, sequence, type, at, hostId, playerId, settings, seats, action)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(game.gameId, sequence, event.type, event.at, hostId, playerId, settings, seats, action);
      }
      this.writeGame(game);
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* preserve the original failure */
      }
      throw err;
    }
  }

  deleteGame(gameId: string): void {
    this.db.prepare('DELETE FROM games WHERE gameId = ?').run(gameId);
    this.db.prepare('DELETE FROM audit_events WHERE gameId = ?').run(gameId);
    this.deleteSessionsForGame(gameId);
  }

  loadAuditEvents(gameId: string): GameAuditEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE gameId = ? ORDER BY sequence')
      .all(gameId) as unknown as AuditRow[];
    return rows.map((row) => {
      if (row.type === 'start' && row.hostId && row.settings && row.seats) {
        return {
          sequence: row.sequence,
          type: 'start',
          at: row.at,
          hostId: row.hostId,
          settings: JSON.parse(row.settings),
          seats: JSON.parse(row.seats),
        };
      }
      if (row.type === 'action' && row.playerId && row.action) {
        return {
          sequence: row.sequence,
          type: 'action',
          at: row.at,
          playerId: row.playerId,
          action: JSON.parse(row.action),
        };
      }
      if (row.type === 'hostChange' && row.hostId) {
        return { sequence: row.sequence, type: 'hostChange', at: row.at, hostId: row.hostId };
      }
      throw new Error(`Corrupt audit event ${gameId}:${row.sequence}`);
    });
  }

  appendAuditEvent(gameId: string, event: GameAuditEventInput): GameAuditEvent {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence FROM audit_events WHERE gameId = ?')
      .get(gameId) as unknown as { nextSequence: number };
    const sequence = row.nextSequence;
    const settings = event.type === 'start' ? JSON.stringify(event.settings) : null;
    const seats = event.type === 'start' ? JSON.stringify(event.seats) : null;
    const action = event.type === 'action' ? JSON.stringify(event.action) : null;
    const hostId = event.type === 'start' || event.type === 'hostChange' ? event.hostId : null;
    const playerId = event.type === 'action' ? event.playerId : null;
    this.db
      .prepare(
        `INSERT INTO audit_events (gameId, sequence, type, at, hostId, playerId, settings, seats, action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(gameId, sequence, event.type, event.at, hostId, playerId, settings, seats, action);
    return { ...structuredClone(event), sequence } as GameAuditEvent;
  }

  loadSessions(): SessionRecord[] {
    const rows = this.db.prepare('SELECT * FROM sessions').all() as unknown as SessionRow[];
    return rows.map((r) => ({
      token: r.token,
      gameId: r.gameId,
      playerId: r.playerId,
      ...(r.accountId !== null ? { accountId: r.accountId } : {}),
      createdAt: r.createdAt,
      lastSeen: r.lastSeen,
    }));
  }

  saveSession(session: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (token, gameId, playerId, accountId, createdAt, lastSeen)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           gameId=excluded.gameId, playerId=excluded.playerId,
           accountId=excluded.accountId, createdAt=excluded.createdAt,
           lastSeen=excluded.lastSeen`,
      )
      .run(
        session.token,
        session.gameId,
        session.playerId,
        session.accountId ?? null,
        session.createdAt,
        session.lastSeen,
      );
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  deleteSessionsForGame(gameId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE gameId = ?').run(gameId);
  }

  loadAccounts(): AccountRecord[] {
    const rows = this.db.prepare('SELECT * FROM accounts').all() as unknown as AccountRow[];
    return rows.map((row) => ({
      accountId: row.accountId,
      email: row.email,
      name: row.name,
      ...(row.picture !== null ? { picture: row.picture } : {}),
      createdAt: row.createdAt,
      lastSeen: row.lastSeen,
    }));
  }

  saveAccount(account: AccountRecord): void {
    this.db
      .prepare(
        `INSERT INTO accounts (accountId, email, name, picture, createdAt, lastSeen)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(accountId) DO UPDATE SET
           email=excluded.email, name=excluded.name, picture=excluded.picture,
           lastSeen=excluded.lastSeen`,
      )
      .run(
        account.accountId,
        account.email,
        account.name,
        account.picture ?? null,
        account.createdAt,
        account.lastSeen,
      );
  }

  loadAuthSessions(): AuthSessionRecord[] {
    const rows = this.db.prepare('SELECT * FROM auth_sessions').all() as unknown as AuthSessionRow[];
    return rows.map((row) => ({
      token: row.token,
      accountId: row.accountId,
      createdAt: row.createdAt,
      lastSeen: row.lastSeen,
      expiresAt: row.expiresAt,
    }));
  }

  saveAuthSession(session: AuthSessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO auth_sessions (token, accountId, createdAt, lastSeen, expiresAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           accountId=excluded.accountId, createdAt=excluded.createdAt,
           lastSeen=excluded.lastSeen, expiresAt=excluded.expiresAt`,
      )
      .run(session.token, session.accountId, session.createdAt, session.lastSeen, session.expiresAt);
  }

  deleteAuthSession(token: string): void {
    this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}
