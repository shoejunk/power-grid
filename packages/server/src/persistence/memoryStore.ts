/**
 * Non-durable store. Used by unit tests that do not exercise restart, and by
 * `PG_STORE=memory` for throwaway demo servers.
 */

import type { GameStore, PersistedGame, SessionRecord } from './types.js';

export class MemoryGameStore implements GameStore {
  readonly kind = 'memory' as const;
  readonly location = ':memory:';
  private games = new Map<string, PersistedGame>();
  private sessions = new Map<string, SessionRecord>();

  loadGames(): PersistedGame[] {
    // Deep-copy on the way out so callers cannot mutate stored state in place —
    // this keeps the memory store honest about round-tripping through JSON.
    return [...this.games.values()].map((g) => structuredClone(g));
  }

  saveGame(game: PersistedGame): void {
    this.games.set(game.gameId, structuredClone(game));
  }

  deleteGame(gameId: string): void {
    this.games.delete(gameId);
    this.deleteSessionsForGame(gameId);
  }

  loadSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  saveSession(session: SessionRecord): void {
    this.sessions.set(session.token, { ...session });
  }

  deleteSessionsForGame(gameId: string): void {
    for (const [token, s] of this.sessions) if (s.gameId === gameId) this.sessions.delete(token);
  }

  close(): void {
    /* nothing to release */
  }
}
