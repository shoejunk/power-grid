import type { GameState, LogEntry } from './types.js';
import { getPlant } from './data/plants.js';
import { STEP2_THRESHOLD } from './data/tables.js';
import { endGameThreshold } from './engine/endgame.js';
import { neighboursInZone, stateMap } from './engine/mapAccess.js';

/** Shared by the award evaluator and the available-awards UI. IDs are permanent. */
export const POWER_GRID_ACHIEVEMENTS = [
  { id: 'first-finish', name: 'On the Grid', description: 'Finish a game with at least two humans.' },
  { id: 'first-win', name: 'Power Player', description: 'Win a game with at least two humans.' },
  { id: 'win-without-scrapping', name: 'Built to Last', description: 'Win without ever scrapping a power plant.' },
  { id: 'two-cities-turn-one', name: 'Double Start', description: 'Build exactly two cities on turn 1.' },
  { id: 'zero-cities-turn-one-win', name: 'Late Bloomer', description: 'Build no cities on turn 1, then win the game.' },
  { id: 'open-step-two', name: 'Open the Gates', description: 'Be the first to reach the city threshold that opens Step 2 (seven cities, or six with six players).' },
  { id: 'eco-only-win', name: 'Green Victory', description: 'Win while owning only ecological power plants.' },
  { id: 'above-threshold-win', name: 'Overachiever', description: 'Win while powering more than 17 cities with 2–4 players, 15 with five players, or 14 with six players.' },
  { id: 'below-threshold-win', name: 'Less Is More', description: 'Win while powering fewer than 17 cities with 2–4 players, 15 with five players, or 14 with six players.' },
  { id: 'skip-region-win', name: 'Home Turf', description: 'Win without building in at least one region of the playing zone.' },
  { id: 'big-upgrade', name: 'Big Upgrade', description: 'Buy a plant numbered above 20 and more than double your previous highest plant number.' },
  { id: 'urban-sprawl', name: 'Urban Sprawl', description: 'Build four or more cities in one turn.' },
  { id: 'asshole', name: 'Asshole', description: 'Buy the last available tokens of a resource when a player buying after you still needs it to fuel a plant.' },
  { id: 'tiebreaker-win', name: 'Every Elektro Counts', description: 'Win a tie on powered cities by having more money.' },
  { id: 'long-connection', name: 'Long Distance', description: 'Connect a city at least three map hops from your existing network.' },
  { id: 'expensive-auction', name: 'High Roller', description: 'Buy a power plant for more than 75 Elektro at auction.' },
  { id: 'cash-reserve-win', name: 'Cash Reserve', description: 'Win with at least 100 Elektro remaining.' },
  { id: 'all-regions-win', name: 'Coast to Coast', description: 'Win with a city in every region of the playing zone.' },
  { id: 'power-ten', name: 'Double Digits', description: 'Power at least ten cities in a single round.' },
  { id: 'bargain-plant', name: 'Bargain Hunter', description: 'Buy a plant at auction for less than its printed number.' },
] as const;

type AchievementId = typeof POWER_GRID_ACHIEVEMENTS[number]['id'];

/** Minimum map hops from any owned city, independent of route price. */
function networkHops(state: GameState, sources: string[], target: string): number {
  if (sources.length === 0) return 0;
  const seen = new Set(sources);
  let frontier = sources;
  for (let hops = 0; frontier.length; hops++) {
    if (frontier.includes(target)) return hops;
    const next: string[] = [];
    for (const city of frontier) {
      for (const neighbour of neighboursInZone(stateMap(state), state.zone, city)) {
        if (!seen.has(neighbour)) { seen.add(neighbour); next.push(neighbour); }
      }
    }
    frontier = next;
  }
  return 0;
}

/** Remove provisional builds that were undone before considering any build award. */
function committedBuilds(state: GameState): LogEntry[] {
  const builds: LogEntry[] = [];
  for (const entry of state.log) {
    if (entry.data?.event === 'cityConnected') builds.push(entry);
    if (entry.data?.event === 'buildUndone') {
      let index = builds.length - 1;
      while (index >= 0 && !(builds[index]!.playerId === entry.playerId && builds[index]!.round === entry.round && builds[index]!.data?.cityId === entry.data?.cityId)) index--;
      if (index >= 0) builds.splice(index, 1);
    }
  }
  return builds;
}

export function powerGridAchievementAwards(state: GameState) {
  if (state.phase !== 'gameOver') return [];
  const builds = committedBuilds(state);
  const stepTwo = state.log.find(e => e.data?.event === 'stepChange' && e.data.step === 2);
  const opener = stepTwo?.data?.reason === 'cityThreshold'
    ? builds.find(e => e.round === stepTwo.round && e.step === 1 && Number(e.data?.networkSize) >= (STEP2_THRESHOLD[state.settings.playerCount] ?? 7))?.playerId
    : undefined;
  return Object.values(state.players).filter(p => !p.isBot && !p.isTrust).flatMap(player => {
    const ids = new Set<AchievementId>(['first-finish']);
    const ownLog = state.log.filter(e => e.playerId === player.id);
    const ownBuilds = builds.filter(e => e.playerId === player.id);
    // A completed first building turn proves the zero-build case; missing history does not.
    const firstTurn = ownLog.find(e => e.round === 1 && e.data?.event === 'buildingDone');
    const firstBuilds = ownBuilds.filter(e => e.round === 1).length;
    if (firstTurn && firstBuilds === 2) ids.add('two-cities-turn-one');
    if (opener === player.id) ids.add('open-step-two');
    const perRound = new Map<number, number>();
    const network: string[] = [];
    for (const entry of ownBuilds) {
      perRound.set(entry.round, (perRound.get(entry.round) ?? 0) + 1);
      const city = entry.data?.cityId;
      if (typeof city !== 'string') continue;
      if (networkHops(state, network, city) >= 3) ids.add('long-connection');
      network.push(city);
    }
    if ([...perRound.values()].some(count => count >= 4)) ids.add('urban-sprawl');
    for (const entry of ownLog) {
      const data = entry.data;
      if (data?.event === 'plantAcquired' && data.via === 'auction') {
        const plantId = Number(data.plantId);
        const previous = Array.isArray(data.plants) ? data.plants.filter((id): id is number => typeof id === 'number' && id !== plantId) : [];
        if (previous.length && plantId > 20 && plantId > 2 * Math.max(...previous)) ids.add('big-upgrade');
        if (Number(data.price) > 75) ids.add('expensive-auction');
        if (Number(data.price) < plantId) ids.add('bargain-plant');
      }
      if (data?.event === 'resourcesBought' && Array.isArray(data.blockedResourceBuyers) && data.blockedResourceBuyers.length > 0) ids.add('asshole');
      if ((data?.event === 'citiesPowered' || data?.event === 'winnerEvaluation') && Number(data.citiesSupplied) >= 10) ids.add('power-ten');
    }
    if (state.winnerId === player.id) {
      ids.add('first-win');
      if (!ownLog.some(e => e.data?.event === 'plantScrapped')) ids.add('win-without-scrapping');
      if (firstTurn?.data?.networkSize === 0 && firstBuilds === 0) ids.add('zero-cities-turn-one-win');
      if (player.plants.length && player.plants.every(p => getPlant(p.plantId).accepts.length === 0)) ids.add('eco-only-win');
      const result = state.finalEvaluation?.find(row => row.playerId === player.id);
      if (result) {
        // The requested achievement target is 17 for 2–4 players; the two-player
        // rules engine ends at 18 built cities. Achievements do not change that rule.
        const threshold = state.settings.playerCount === 2 ? 17 : endGameThreshold(state);
        if (result.citiesSupplied > threshold) ids.add('above-threshold-win');
        if (result.citiesSupplied < threshold) ids.add('below-threshold-win');
        const tied = state.finalEvaluation!.filter(row => row.playerId !== player.id && row.citiesSupplied === result.citiesSupplied);
        if (tied.length && tied.every(row => row.money < result.money)) ids.add('tiebreaker-win');
      }
      const regions = new Set(player.cities.map(id => stateMap(state).cities.find(c => c.id === id)?.area));
      if (player.cities.length && state.zone.some(area => !regions.has(area))) ids.add('skip-region-win');
      if (state.zone.length && state.zone.every(area => regions.has(area))) ids.add('all-regions-win');
      if (player.money >= 100) ids.add('cash-reserve-win');
    }
    return POWER_GRID_ACHIEVEMENTS.filter(a => ids.has(a.id)).map(a => ({ playerId: player.id, ...a }));
  });
}
