/**
 * Non-durable store. Used by unit tests that do not exercise restart, and by
 * `PG_STORE=memory` for throwaway demo servers.
 */

import type {
  GameAuditEvent,
  GameAuditEventInput,
  GameStore,
  PersistedGame,
  SessionRecord,
} from './types.js';

export class MemoryGameStore implements GameStore {
  readonly kind = 'memory' as const;
  readonly location = ':memory:';
  private games = new Map<string, PersistedGame>();
  private sessions = new Map<string, SessionRecord>();
  private auditEvents = new Map<string, GameAuditEvent[]>();

  loadGames(): PersistedGame[] {
    // Deep-copy on the way out so callers cannot mutate stored state in place —
    // this keeps the memory store honest about round-tripping through JSON.
    return [...this.games.values()].map((g) => structuredClone(g));
  }

  saveGame(game: PersistedGame): void {
    this.games.set(game.gameId, structuredClone(game));
  }

  saveGameWithAudit(game: PersistedGame, events: readonly GameAuditEventInput[]): void {
    const current = this.auditEvents.get(game.gameId) ?? [];
    const expected = game.auditSequence ?? current.length + events.length;
    if (expected !== current.length + events.length) {
      throw new Error(`Audit sequence mismatch for ${game.gameId}`);
    }
    for (const event of events) {
      current.push({ ...structuredClone(event), sequence: current.length + 1 } as GameAuditEvent);
    }
    this.auditEvents.set(game.gameId, current);
    this.games.set(game.gameId, structuredClone(game));
  }

  deleteGame(gameId: string): void {
    this.games.delete(gameId);
    this.auditEvents.delete(gameId);
    this.deleteSessionsForGame(gameId);
  }

  loadAuditEvents(gameId: string): GameAuditEvent[] {
    return structuredClone(this.auditEvents.get(gameId) ?? []);
  }

  appendAuditEvent(gameId: string, event: GameAuditEventInput): GameAuditEvent {
    const events = this.auditEvents.get(gameId) ?? [];
    const appended = { ...structuredClone(event), sequence: events.length + 1 } as GameAuditEvent;
    events.push(appended);
    this.auditEvents.set(gameId, events);
    return structuredClone(appended);
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
