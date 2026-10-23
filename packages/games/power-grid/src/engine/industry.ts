/** Industry rules and balance values. Classic never calls the economy below. */
import type { GameSettings, GameState, Player, ResourceBundle, ResourceType } from '../types.js';
import { RESOURCE_TYPES } from '../types.js';
import { facilitiesForVersion, getFacility } from '../data/facilities.js';
import { humanPlayers, pushLog } from './state.js';

export const isIndustry = (state: Pick<GameState, 'settings'>): boolean => state.settings.rulesMode === 'industry';
// Saved version-4 games retain their original cash victory and separate offers.
export const isLegacyIndustry = (state: Pick<GameState, 'settings' | 'version'>): boolean => isIndustry(state) && state.version < 5;
export const usesMixedMarket = (state: GameState): boolean => isIndustry(state) && !isLegacyIndustry(state);
/** Legacy replay values, not the victory condition for new Industry games. */
export const INDUSTRY_MONEY_TARGETS: Readonly<Record<number, number>> = { 2: 250, 3: 250, 4: 250, 5: 250, 6: 250 };
export const industryMoneyTarget = (settings: GameSettings): number => settings.moneyTarget ?? INDUSTRY_MONEY_TARGETS[settings.playerCount] ?? 250;
export const INDUSTRY_BASE_REFILL: Readonly<Record<number, ResourceBundle>> = {
  2: { coal: 1, oil: 1, garbage: 1, uranium: 0 },
  3: { coal: 2, oil: 1, garbage: 1, uranium: 0 },
  4: { coal: 2, oil: 1, garbage: 1, uranium: 0 },
  5: { coal: 2, oil: 2, garbage: 1, uranium: 1 },
  6: { coal: 3, oil: 2, garbage: 1, uranium: 1 },
};
export const industryBaseRefill = (state: GameState): ResourceBundle => ({ ...INDUSTRY_BASE_REFILL[state.settings.playerCount]! });
export const ownedCardIds = (player: Player): number[] => [...player.plants.map(p => p.plantId), ...(player.facilities ?? [])];
export const cardLimit = (state: GameState): number => isIndustry(state) ? 5 : 3;
export const auctionCardIds = (state: GameState): number[] => [...state.plantMarket.current, ...(isLegacyIndustry(state) ? state.facilityMarket ?? [] : [])];

export function initializeIndustry(state: GameState): void {
  if (isLegacyIndustry(state)) state.facilityMarket = facilitiesForVersion(state.version).filter(f => f.size === 'small').map(f => f.id);
  state.scrappedFacilities = [];
  for (const player of humanPlayers(state)) player.facilities = [];
}

/** Fill actual empty price slots. Baseline gets first access; only delivered units earn income. */
function deliver(state: GameState, resource: ResourceType, requested: number): { delivered: number; revenue: number } {
  const usaCoal = resource === 'coal' && state.settings.mapId === 'usa';
  const available = usaCoal ? state.usaCoalStorage : state.supply[resource];
  let remaining = Math.min(requested, available);
  let delivered = 0;
  let revenue = 0;
  for (const space of state.resourceMarket[resource].slice().reverse()) {
    const count = Math.min(remaining, space.capacity - space.filled);
    space.filled += count;
    remaining -= count;
    delivered += count;
    revenue += count * Math.max(0, space.price - 1);
  }
  if (usaCoal) state.usaCoalStorage -= delivered;
  else state.supply[resource] -= delivered;
  return { delivered, revenue };
}

/** Proportional integer payouts; largest remainders get the spare Elektro.
 * Rotate exact remainder ties by round, independent of player/build resolution order.
 */
function shares(total: number, weights: number[], round: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const result = weights.map(w => Math.floor(total * w / sum));
  const priority = weights.map((w, i) => ({ i, remainder: (total * w) % sum }))
    .sort((a, b) => b.remainder - a.remainder || ((a.i + round) % weights.length) - ((b.i + round) % weights.length));
  const spare = total - result.reduce((a, b) => a + b, 0);
  for (let i = 0; i < spare; i++) result[priority[i]!.i]! += 1;
  return result;
}

export function refillIndustryMarket(state: GameState, now: number): void {
  const baseline = industryBaseRefill(state);
  const added = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
  for (const resource of RESOURCE_TYPES) added[resource] = deliver(state, resource, baseline[resource]).delivered;
  pushLog(state, now, { category: 'resource', message: 'Industry baseline resources enter the market (unchanged by Step).',
    data: { event: 'industryBaseRefill', requested: baseline, added } });

  for (const resource of RESOURCE_TYPES) {
    const producers = humanPlayers(state).map(player => ({ player,
      output: (player.facilities ?? []).map(id => getFacility(id, state.version)).filter(f => f.resource === resource).reduce((n, f) => n + f.output, 0),
    })).filter(p => p.output > 0).sort((a, b) => a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0);
    if (!producers.length) continue;
    const weights = producers.map(p => p.output);
    const requested = weights.reduce((a, b) => a + b, 0);
    const { delivered, revenue } = deliver(state, resource, requested);
    const payouts = shares(revenue, weights, state.round);
    for (let i = 0; i < producers.length; i++) {
      const { player, output } = producers[i]!;
      const paid = payouts[i]!;
      player.money += paid;
      pushLog(state, now, { category: 'payment', playerId: player.id,
        message: `${player.name}'s ${resource} facilities earn ${paid} Elektro after handling.`,
        data: { event: 'facilityIncome', playerId: player.id, resource, output, requested, delivered,
          totalRevenue: revenue, paid, moneyAfter: player.money } });
    }
  }
}

export function finishIndustryGame(state: GameState, now: number): boolean {
  const players = humanPlayers(state);
  const target = industryMoneyTarget(state.settings);
  if (!players.some(p => p.money >= target)) return false;
  const highest = Math.max(...players.map(p => p.money));
  state.endGameTriggered = true;
  state.winnerIds = players.filter(p => p.money === highest).map(p => p.id);
  state.winnerId = state.winnerIds[0] ?? null;
  state.finalEvaluation = players.map(p => ({ playerId: p.id, money: p.money, networkSize: p.cities.length,
    citiesSupplied: 0, plantIds: p.plants.map(op => op.plantId) }));
  state.phase = 'gameOver';
  state.activePlayerId = null;
  pushLog(state, now, { category: 'endgame', message: `${state.winnerIds.map(id => state.players[id]!.name).join(' and ')} win${state.winnerIds.length === 1 ? 's' : ''} with ${highest} Elektro after all round income.`,
    data: { event: 'gameOver', winnerId: state.winnerId, winnerIds: state.winnerIds, target, results: state.finalEvaluation, victory: 'money' } });
  return true;
}
