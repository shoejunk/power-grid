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
import type { GameStore, PersistedGame, SessionRecord } from './types.js';

interface FileShape {
  version: 1;
  games: PersistedGame[];
  sessions: SessionRecord[];
}

export class JsonFileGameStore implements GameStore {
  readonly kind = 'json' as const;
  readonly location: string;
  private games = new Map<string, PersistedGame>();
  private sessions = new Map<string, SessionRecord>();
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
      version: 1,
      games: [...this.games.values()],
      sessions: [...this.sessions.values()],
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

  deleteGame(gameId: string): void {
    this.games.delete(gameId);
    for (const [token, s] of this.sessions) if (s.gameId === gameId) this.sessions.delete(token);
    this.flush();
  }

  loadSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  saveSession(session: SessionRecord): void {
    this.sessions.set(session.token, session);
    this.flush();
  }

  deleteSessionsForGame(gameId: string): void {
    for (const [token, s] of this.sessions) if (s.gameId === gameId) this.sessions.delete(token);
    this.flush();
  }

  close(): void {
    this.flush();
    this.closed = true;
  }
}
