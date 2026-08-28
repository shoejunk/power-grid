/**
 * Atomic JSON-file persistence — the fallback when `node:sqlite` is missing
 * (Node < 22, or a build with SQLite compiled out).
 *
 * Durability comes from write-temp-then-rename: `fs.renameSync` is atomic
 * within a filesystem, so a crash mid-write leaves the previous complete file
 * intact rather than a truncated one. The whole database is held in memory,
 * which is fine for the scale this server targets (tens of concurrent tables).
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountRecord,
  AuthSessionRecord,
  GameAuditEvent,
  GameAuditEventInput,
  GameStore,
  PersistedGame,
  SessionRecord,
} from './types.js';

interface FileShape {
  version: 1 | 2 | 3 | 4;
  games: PersistedGame[];
  sessions: SessionRecord[];
  accounts?: AccountRecord[];
  authSessions?: AuthSessionRecord[];
  auditEvents?: Record<string, GameAuditEvent[]>;
}

export class JsonFileGameStore implements GameStore {
  readonly kind = 'json' as const;
  readonly location: string;
  private games = new Map<string, PersistedGame>();
  private sessions = new Map<string, SessionRecord>();
  private accounts = new Map<string, AccountRecord>();
  private authSessions = new Map<string, AuthSessionRecord>();
  private auditEvents = new Map<string, GameAuditEvent[]>();
  private closed = false;

  constructor(filePath: string) {
    this.location = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.read();
  }

  private read(): void {
    if (!fs.existsSync(this.location)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.location, 'utf8')) as FileShape;
      for (const g of parsed.games ?? []) this.games.set(g.gameId, g);
      for (const s of parsed.sessions ?? []) this.sessions.set(s.token, s);
      for (const account of parsed.accounts ?? []) this.accounts.set(account.accountId, account);
      for (const session of parsed.authSessions ?? []) this.authSessions.set(session.token, session);
      for (const [gameId, events] of Object.entries(parsed.auditEvents ?? {})) {
        this.auditEvents.set(gameId, structuredClone(events));
      }
    } catch {
      // Corrupt file: keep it around for forensics, start clean.
      try {
        fs.renameSync(this.location, `${this.location}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
    }
  }

  /** Temp file + rename, so readers never observe a partial write. */
  private flush(): void {
    if (this.closed) return;
    const payload: FileShape = {
      version: 4,
      games: [...this.games.values()],
      sessions: [...this.sessions.values()],
      accounts: [...this.accounts.values()],
      authSessions: [...this.authSessions.values()],
      auditEvents: Object.fromEntries(
        [...this.auditEvents.entries()].map(([gameId, events]) => [gameId, structuredClone(events)]),
      ),
    };
    const tmp = `${this.location}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, this.location);
  }

  loadGames(): PersistedGame[] {
    return [...this.games.values()];
  }

  saveGame(game: PersistedGame): void {
    this.games.set(game.gameId, game);
    this.flush();
  }

  saveGameWithAudit(game: PersistedGame, events: readonly GameAuditEventInput[]): void {
    const current = this.auditEvents.get(game.gameId) ?? [];
    const expected = game.auditSequence ?? current.length + events.length;
    if (expected !== current.length + events.length) {
      throw new Error(`Audit sequence mismatch for ${game.gameId}`);
    }
    const nextEvents = [...current];
    for (const event of events) {
      nextEvents.push({ ...structuredClone(event), sequence: nextEvents.length + 1 } as GameAuditEvent);
    }
    this.auditEvents.set(game.gameId, nextEvents);
    this.games.set(game.gameId, structuredClone(game));
    this.flush();
  }

  deleteGame(gameId: string): void {
    this.games.delete(gameId);
    this.auditEvents.delete(gameId);
    for (const [token, s] of this.sessions) if (s.gameId === gameId) this.sessions.delete(token);
    this.flush();
  }

  loadAuditEvents(gameId: string): GameAuditEvent[] {
    return structuredClone(this.auditEvents.get(gameId) ?? []);
  }

  appendAuditEvent(gameId: string, event: GameAuditEventInput): GameAuditEvent {
    const events = this.auditEvents.get(gameId) ?? [];
    const appended = { ...structuredClone(event), sequence: events.length + 1 } as GameAuditEvent;
    events.push(appended);
    this.auditEvents.set(gameId, events);
    this.flush();
    return structuredClone(appended);
  }

  loadSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  saveSession(session: SessionRecord): void {
    this.sessions.set(session.token, session);
    this.flush();
  }

  deleteSession(token: string): void {
    this.sessions.delete(token);
    this.flush();
  }

  deleteSessionsForGame(gameId: string): void {
    for (const [token, s] of this.sessions) if (s.gameId === gameId) this.sessions.delete(token);
    this.flush();
  }

  loadAccounts(): AccountRecord[] {
    return [...this.accounts.values()].map((account) => structuredClone(account));
  }

  saveAccount(account: AccountRecord): void {
    this.accounts.set(account.accountId, structuredClone(account));
    this.flush();
  }

  loadAuthSessions(): AuthSessionRecord[] {
    return [...this.authSessions.values()].map((session) => structuredClone(session));
  }

  saveAuthSession(session: AuthSessionRecord): void {
    this.authSessions.set(session.token, structuredClone(session));
    this.flush();
  }

  deleteAuthSession(token: string): void {
    this.authSessions.delete(token);
    this.flush();
  }

  close(): void {
    this.flush();
    this.closed = true;
  }
}
