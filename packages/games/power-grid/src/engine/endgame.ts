/**
 * §11 — End of game and winner.
 *
 * The game ends immediately after Phase 4 once a *human* reaches the city
 * threshold. The Phase 5 that follows pays nothing: it only asks how many
 * cities each player could supply, and "The player who can supply the most
 * cities wins, even if another player triggered the end of the game by reaching
 * the threshold." Money breaks ties.
 */

import type { GameState, PlayerId } from '../types.js';
import { END_GAME_THRESHOLD } from './constants.js';
import { getPlayer, humanPlayers, pushLog, type FinalEvaluationRow } from './state.js';
import { bestSupply } from './production.js';
import { stateMap, zoneCities } from './mapAccess.js';

export function endGameThreshold(state: GameState): number {
  const printed = END_GAME_THRESHOLD[state.settings.playerCount] ?? 17;
  // A player-count-sized zone contains only 14 cities in a two-player game.
  // Keep the end condition reachable under that requested setup variant.
  if (state.zone.length === 0) return printed;
  return Math.min(printed, zoneCities(stateMap(state), state.zone).length);
}

/** §11 / §13: only human networks can trigger the end of the game. */
export function endGameReached(state: GameState): boolean {
  const threshold = endGameThreshold(state);
  return humanPlayers(state).some((p) => p.cities.length >= threshold);
}

/** Called once Phase 4 is complete. §11. */
export function checkEndGameTrigger(state: GameState, now: number): void {
  if (state.endGameTriggered) return;
  if (!endGameReached(state)) return;
  state.endGameTriggered = true;
  const threshold = endGameThreshold(state);
  const triggers = humanPlayers(state)
    .filter((p) => p.cities.length >= threshold)
    .map((p) => p.id);
  pushLog(state, now, {
    category: 'endgame',
    message: `The end of the game is triggered at ${threshold} connected cities.`,
    data: {
      event: 'endGameTriggered',
      threshold,
      triggeredBy: triggers,
      networks: humanPlayers(state).map((p) => ({ playerId: p.id, cities: p.cities.length })),
    },
  });
}

/**
 * Winner evaluation. §11 / §14: "Paying cash during endgame winner evaluation"
 * is explicitly illegal, so no money changes hands here.
 */
export function runFinalEvaluation(state: GameState, now: number): void {
  const rows: FinalEvaluationRow[] = [];
  for (const player of humanPlayers(state)) {
    const best = bestSupply(state, player.id);
    rows.push({
      playerId: player.id,
      citiesSupplied: best.cities,
      money: player.money,
      networkSize: player.cities.length,
      plantIds: best.plantIds.slice(),
    });
    pushLog(state, now, {
      category: 'endgame',
      playerId: player.id,
      message: `${player.name} can supply ${best.cities} of their ${player.cities.length} cities.`,
      data: {
        event: 'winnerEvaluation',
        playerId: player.id,
        citiesSupplied: best.cities,
        capacity: best.capacity,
        networkSize: player.cities.length,
        operatePlantIds: best.plantIds.slice(),
        money: player.money,
        paid: 0,
      },
    });
  }

  // §13: "The Trust cannot win." — humanPlayers() already excludes it.
  const winner = rows
    .slice()
    .sort((a, b) => b.citiesSupplied - a.citiesSupplied || b.money - a.money)[0];

  state.finalEvaluation = rows;
  state.winnerId = winner ? winner.playerId : null;
  state.phase = 'gameOver';
  state.activePlayerId = null;

  pushLog(state, now, {
    category: 'endgame',
    ...(winner ? { playerId: winner.playerId } : {}),
    message: winner
      ? `${getPlayer(state, winner.playerId).name} wins, supplying ${winner.citiesSupplied} cities with ${winner.money} Elektro remaining.`
      : 'The game ends with no winner.',
    data: {
      event: 'gameOver',
      winnerId: state.winnerId,
      results: rows.map((r) => ({ ...r })),
      tieBreak: 'money',
    },
  });
}

/** Convenience for the UI: the ranking used to pick the winner. §11. */
export function finalStandings(state: GameState): FinalEvaluationRow[] {
  return (state.finalEvaluation ?? [])
    .slice()
    .sort((a, b) => b.citiesSupplied - a.citiesSupplied || b.money - a.money);
}

export function isWinner(state: GameState, playerId: PlayerId): boolean {
  return state.winnerId === playerId;
}
