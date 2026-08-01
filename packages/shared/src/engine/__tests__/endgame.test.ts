/** §11 End of game and winner evaluation. Acceptance 7. */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../types.js';
import { END_GAME_THRESHOLD } from '../../data/tables.js';
import {
  deepClone,
  endGameThreshold,
  finalStandings,
  stateMap,
  zoneCities,
} from '../index.js';
import { act, enterPhase, lastLog, start } from './helpers.js';

const ZONE = ['west', 'southwest', 'east'];

/** Gives `id` `n` cities on `slot`, so several players can share a city. */
function houses(s: GameState, id: PlayerId, n: number, slot: number): void {
  const cities = zoneCities(stateMap(s), s.zone);
  for (let i = 0; i < n; i++) {
    s.citySlots[cities[i]!]![slot] = id;
    s.players[id]!.cities.push(cities[i]!);
    s.players[id]!.housesRemaining -= 1;
    s.players[id]!.hasNetwork = true;
  }
}

/**
 * The trigger player has the biggest network but almost no generation; another
 * player can supply far more cities. §11.
 */
function endgameBoard(seed = 'ENDGAME') {
  const base = start({ playerCount: 3, seed, zone: ZONE });
  const s = deepClone(base);
  s.step = 3;
  s.step2Triggered = true;
  const [strong, weak, trigger] = s.playerOrder as [string, string, string];

  houses(s, trigger, 17, 0); // reaches the 3-player threshold
  houses(s, strong, 10, 1);
  houses(s, weak, 5, 2);

  s.players[trigger]!.plants = [
    { plantId: 3, stored: { coal: 0, oil: 2, garbage: 0, uranium: 0 } }, // 1 city
  ];
  s.players[strong]!.plants = [
    { plantId: 36, stored: { coal: 3, oil: 0, garbage: 0, uranium: 0 } }, // 7 cities
    { plantId: 30, stored: { coal: 0, oil: 0, garbage: 3, uranium: 0 } }, // 6 cities
  ];
  s.players[weak]!.plants = [];
  return { s, strong, weak, trigger };
}

describe('§11 thresholds', () => {
  it('uses the printed threshold for each player count', () => {
    expect(END_GAME_THRESHOLD).toMatchObject({ 2: 18, 3: 17, 4: 17, 5: 15, 6: 14 });
    for (const playerCount of [2, 3, 4, 5, 6]) {
      const s = start({ playerCount, seed: `T-${playerCount}` });
      expect(endGameThreshold(s)).toBe(END_GAME_THRESHOLD[playerCount]);
    }
  });
});

describe('§11 trigger timing', () => {
  it('the rest of Phase 4 still happens after the threshold is reached', () => {
    const { s, trigger } = endgameBoard('TRIGGER-TIMING');
    const t0 = deepClone(s);
    t0.phase = 'building';
    for (const id of t0.playerOrder) t0.players[id]!.phaseStatus = 'eligible';
    const reverse = t0.playerOrder.slice().reverse();
    t0.activePlayerId = reverse[0]!;
    expect(reverse[0]).toBe(trigger);

    // The trigger player already has 17 cities; ending their turn must not end
    // the game while other players still have a Phase 4 turn.
    const t1 = act(t0, trigger, { type: 'passBuilding' });
    expect(t1.phase).toBe('building');
    expect(t1.endGameTriggered).toBe(false);
    expect(t1.activePlayerId).toBe(reverse[1]);
  });

  it('fires immediately after Phase 4 completes', () => {
    const { s, trigger } = endgameBoard('TRIGGER-FIRE');
    const t = act(enterPhase(s, 'building', trigger), trigger, { type: 'passBuilding' });
    expect(t.endGameTriggered).toBe(true);
    expect(lastLog(t, 'endGameTriggered')!.data).toMatchObject({
      threshold: 17,
      triggeredBy: [trigger],
    });
  });
});

describe('§11 winner evaluation', () => {
  it('picks the player who can supply the most cities, not the trigger player', () => {
    const { s, strong, trigger } = endgameBoard('WINNER');
    const t = act(enterPhase(s, 'building', trigger), trigger, { type: 'passBuilding' });

    expect(t.phase).toBe('gameOver');
    expect(t.winnerId).toBe(strong);
    expect(t.winnerId).not.toBe(trigger);

    const rows = finalStandings(t);
    expect(rows[0]!.playerId).toBe(strong);
    expect(rows[0]!.citiesSupplied).toBe(10); // capacity 13 capped by a 10-city network
    expect(rows.find((r) => r.playerId === trigger)!.citiesSupplied).toBe(1);
    expect(rows.find((r) => r.playerId === trigger)!.networkSize).toBe(17);
  });

  it('§14 pays no cash during the evaluation phase', () => {
    const { s, trigger } = endgameBoard('NO-CASH');
    const before = Object.fromEntries(s.playerOrder.map((id) => [id, s.players[id]!.money]));
    const t = act(enterPhase(s, 'building', trigger), trigger, { type: 'passBuilding' });
    for (const id of t.playerOrder) {
      expect(t.players[id]!.money).toBe(before[id]);
    }
    expect(lastLog(t, 'gameOver')).toBeDefined();
    expect(t.log.some((l) => (l.data as { event?: string } | undefined)?.event === 'citiesPowered'))
      .toBe(false);
  });

  it('breaks a tie on supplied cities with remaining money', () => {
    const { s, strong, weak, trigger } = endgameBoard('TIEBREAK');
    const t0 = deepClone(s);
    // Both contenders can supply exactly 5 cities.
    t0.players[strong]!.plants = [
      { plantId: 25, stored: { coal: 2, oil: 0, garbage: 0, uranium: 0 } }, // 5 cities
    ];
    t0.players[weak]!.plants = [
      { plantId: 26, stored: { coal: 0, oil: 2, garbage: 0, uranium: 0 } }, // 5 cities
    ];
    t0.players[strong]!.money = 40;
    t0.players[weak]!.money = 41;

    const t = act(enterPhase(t0, 'building', trigger), trigger, { type: 'passBuilding' });
    const rows = finalStandings(t);
    expect(rows[0]!.citiesSupplied).toBe(5);
    expect(rows[1]!.citiesSupplied).toBe(5);
    expect(t.winnerId).toBe(weak);
  });

  it('an unfuelled plant supplies nothing', () => {
    const { s, strong, trigger } = endgameBoard('UNFUELLED');
    const t0 = deepClone(s);
    t0.players[strong]!.plants = [
      { plantId: 36, stored: { coal: 2, oil: 0, garbage: 0, uranium: 0 } }, // needs 3
    ];
    const t = act(enterPhase(t0, 'building', trigger), trigger, { type: 'passBuilding' });
    expect(finalStandings(t).find((r) => r.playerId === strong)!.citiesSupplied).toBe(0);
    // The trigger player, supplying 1, now wins.
    expect(t.winnerId).toBe(trigger);
  });

  it('logs a structured explanation for every player', () => {
    const { s, trigger } = endgameBoard('LOGGED');
    const t = act(enterPhase(s, 'building', trigger), trigger, { type: 'passBuilding' });
    const rows = t.log.filter(
      (l) => (l.data as { event?: string } | undefined)?.event === 'winnerEvaluation',
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.data).toMatchObject({ paid: 0 });
  });

  it('no further actions are accepted once the game is over', () => {
    const { s, trigger } = endgameBoard('OVER');
    const t = act(enterPhase(s, 'building', trigger), trigger, { type: 'passBuilding' });
    expect(() => act(t, trigger, { type: 'passBuilding' })).toThrow(/game is over/);
    expect(t.activePlayerId).toBeNull();
  });
});
