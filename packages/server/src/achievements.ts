import type { AnyGamePlugin } from '@tt/core';
import type { GameStore, PersistedGame } from './persistence/types.js';

/** Awards are account-owned, idempotent, and survive table cleanup. */
export function awardAchievements(store: GameStore, plugin: AnyGamePlugin, game: PersistedGame): void {
  if (!game.started || game.state == null || !plugin.isGameOver(game.state as never) || !plugin.achievementAwards) return;
  const start = store.loadAuditEvents(game.gameId).find(e => e.type === 'start');
  // Legacy snapshots without a full starting roster cannot prove eligibility.
  if (!start || start.type !== 'start') return;
  const originalHumans = new Set(start.seats.filter(s => !s.isBot).map(s => s.playerId));
  const humans = game.seats.filter(s => !s.isBot && originalHumans.has(s.playerId));
  if (originalHumans.size < 2 || humans.length < 2) return;
  const sessions = store.loadSessions().filter(s => s.gameId === game.gameId && s.accountId);
  const owners = new Map(sessions.map(s => [s.playerId, s.accountId!]));
  // Two seats linked to the same account cannot manufacture human eligibility.
  const identities = new Set(humans.map(s => owners.get(s.playerId) ?? `seat:${s.playerId}`));
  if (identities.size < 2) return;
  for (const award of plugin.achievementAwards(game.state as never)) {
    if (!humans.some(s => s.playerId === award.playerId)) continue;
    const accountId = owners.get(award.playerId);
    if (!accountId) continue;
    store.saveAchievement({ accountId, gameKey: game.gameKey, achievementId: award.id, name: award.name,
      description: award.description, gameId: game.gameId, earnedAt: game.updatedAt });
  }
}
