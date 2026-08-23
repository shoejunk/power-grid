/**
 * §23 acceptance criterion A8.
 *
 * §16 makes morale-zero an immediate loss which suppresses the main-objective
 * check. §11.4 is the only exception: Add Zombies defers that loss until the
 * end of each of its three batches (colony population, non-colony population,
 * and noise). These tests use the public effect driver and colony-step API so
 * the assertions cover the resumable placement/overrun procedure rather than
 * a private helper in the implementation.
 */

import { describe, expect, it } from 'vitest';

import type { EngineEffect, GameState } from '../../types.js';
import { advance, mainObjectiveSatisfied, pushFrame, runColonyStep } from '../index.js';
import {
  NOW,
  act,
  placeSurvivor,
  start,
  survivorsOfPlayer,
} from './helpers.js';

interface EventData {
  event?: string;
  location?: string;
  entrance?: number;
  outcome?: string;
  reason?: string;
  roll?: number;
  survivorId?: string;
  cause?: string;
}

function game(): GameState {
  const state = start({
    playerCount: 4,
    seed: 'A8-FIXTURE',
    // mo-f1 is already satisfied when food is set to three. That makes a
    // skipped Check Main Objective observable rather than hypothetical.
    settings: { mainObjectiveId: 'mo-f1' },
  });
  // Crossroads are unrelated to A8 and must not intercept a synthetic colony
  // phase started from the public runColonyStep API.
  if (state.turn) state.turn.crossroadsTriggered = true;
  return state;
}

function runEffects(state: GameState, effects: EngineEffect[]): void {
  pushFrame(state, effects);
  advance(state, NOW);
}

function clearBoard(state: GameState): void {
  for (const entrance of state.colony.entrances) {
    entrance.zombies = 0;
    entrance.barricades = 0;
  }
  for (const location of Object.values(state.locations)) {
    location.entrance.zombies = 0;
    location.entrance.barricades = 0;
    location.noise = 0;
  }
}

function eventsSince(state: GameState, from: number): EventData[] {
  return state.log.slice(from).map((entry) => (entry.data ?? {}) as EventData);
}

function placementsSince(state: GameState, from: number): EventData[] {
  return eventsSince(state, from).filter((data) => data.event === 'zombiePlacement');
}

function gameOverEvents(state: GameState, from: number): EventData[] {
  return eventsSince(state, from).filter((data) => data.event === 'gameOver');
}

function expectMoraleLoss(state: GameState, from: number): EventData[] {
  expect(state.phase).toBe('gameOver');
  expect(state.colony.morale).toBe(0);
  expect(state.outcome).toMatchObject({
    reason: 'morale',
    mainObjectiveComplete: false,
  });
  expect(eventsSince(state, from).some((data) => data.event === 'mainObjectiveComplete')).toBe(
    false,
  );
  expect(gameOverEvents(state, from)).toEqual([
    expect.objectContaining({ event: 'gameOver', reason: 'morale' }),
  ]);
  return eventsSince(state, from);
}

describe('§23 A8 — immediate morale-zero termination', () => {
  it('ends outside Add Zombies before a queued objective check and remains stable', () => {
    const state = game();
    state.colony.morale = 1;
    state.colony.food = 3;
    const from = state.log.length;

    runEffects(state, [
      { kind: 'adjustMorale', amount: -1 },
      { kind: 'i.colonyStep', step: 'checkMainObjective' },
    ]);

    const events = expectMoraleLoss(state, from);
    expect(events.map((data) => data.event)).toEqual(['morale', 'gameOver']);
    expect(state.effectStack).toEqual([]);
    expect(state.pendingChoices).toEqual([]);
    expect(state.colonyStep).toBeNull();
    expect(state.activePlayerId).toBeNull();
    expect(state.deferMoraleCheck).toBe(false);

    const snapshot = JSON.stringify(state);
    advance(state, NOW + 1);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(gameOverEvents(state, from)).toHaveLength(1);
    expect(() => act(state, state.seating[0]!, { type: 'endTurn' })).toThrow(/game is over/i);
  });
});

describe('§23 A8 — Add Zombies morale checkpoints', () => {
  it('checks after the colony population batch, after completing an in-flight overrun', () => {
    const state = game();
    clearBoard(state);

    // Remove normal survivors from the colony so the first overrun must kill a
    // helpless survivor, without opening a last-survivor replacement choice.
    for (const [index, survivor] of Object.values(state.survivors).entries()) {
      placeSurvivor(state, survivor.id, index < 4 ? 'police-station' : 'grocery-store');
    }
    state.colony.helpless = 3; // ceil(3 / 2) = two colony-population zombies
    state.colony.morale = 1;
    state.colony.food = 3;
    expect(mainObjectiveSatisfied(state)).toBe(true);
    state.colony.entrances[0]!.zombies = state.colony.entrances[0]!.capacity;
    const from = state.log.length;

    runColonyStep(state, NOW, 'addZombies');
    advance(state, NOW);

    const events = expectMoraleLoss(state, from);
    expect(placementsSince(state, from).map(({ location, entrance, outcome }) => ({
      location,
      entrance,
      outcome,
    }))).toEqual([
      { location: 'colony', entrance: 1, outcome: 'overrun' },
      { location: 'colony', entrance: 2, outcome: 'placed' },
    ]);
    expect(events.findIndex((data) => data.event === 'helplessDied')).toBeGreaterThan(
      events.findIndex(
        (data) =>
          data.event === 'zombiePlacement' &&
          data.location === 'colony' &&
          data.entrance === 1,
      ),
    );
    expect(events.findIndex((data) => data.event === 'gameOver')).toBeGreaterThan(
      events.findIndex(
        (data) =>
          data.event === 'zombiePlacement' &&
          data.location === 'colony' &&
          data.entrance === 2,
      ),
    );
    // The first checkpoint ends the game before non-colony population, noise,
    // or the main-objective step can begin.
    expect(placementsSince(state, from).some((data) => data.location !== 'colony')).toBe(false);
    expect(events.some((data) => data.event === 'noiseRoll')).toBe(false);
  });

  it('checks after the non-colony population batch, after completing all its overruns', () => {
    const state = game();
    clearBoard(state);
    const firstPoliceSurvivor = survivorsOfPlayer(state, 'p1')[0]!;
    const secondPoliceSurvivor = survivorsOfPlayer(state, 'p2')[0]!;
    firstPoliceSurvivor.cardId = 'sv-forest-plum'; // influence 1: deterministic casualty first
    secondPoliceSurvivor.cardId = 'sv-edward-white'; // influence 4: deterministic casualty second
    for (const survivor of Object.values(state.survivors)) placeSurvivor(state, survivor.id, 'colony');
    placeSurvivor(state, firstPoliceSurvivor.id, 'police-station');
    placeSurvivor(state, secondPoliceSurvivor.id, 'police-station');

    state.colony.morale = 1;
    state.colony.food = 3;
    expect(mainObjectiveSatisfied(state)).toBe(true);
    state.locations['police-station']!.entrance.zombies =
      state.locations['police-station']!.entrance.capacity;
    state.locations['police-station']!.noise = 1;
    const from = state.log.length;

    runColonyStep(state, NOW, 'addZombies');
    advance(state, NOW);

    const events = expectMoraleLoss(state, from);
    expect(placementsSince(state, from).map(({ location, entrance, outcome }) => ({
      location,
      entrance,
      outcome,
    }))).toEqual([
      { location: 'colony', entrance: 1, outcome: 'placed' },
      { location: 'colony', entrance: 2, outcome: 'placed' },
      { location: 'colony', entrance: 3, outcome: 'placed' },
      { location: 'police-station', entrance: 1, outcome: 'overrun' },
      { location: 'police-station', entrance: 1, outcome: 'overrun' },
    ]);
    expect(events.filter((data) => data.event === 'survivorDied').map((data) => data.survivorId)).toEqual([
      firstPoliceSurvivor.id,
      secondPoliceSurvivor.id,
    ]);
    // The second police overrun and its death finish before checkpoint two;
    // checkpoint two then terminates before the queued noise token is rolled.
    expect(events.filter((data) => data.event === 'noiseRoll')).toEqual([]);
    expect(state.locations['police-station']!.noise).toBe(1);
  });

  it('checks after the noise batch, after rolling remaining noise following an overrun', () => {
    const state = game();
    clearBoard(state);
    const policeSurvivor = survivorsOfPlayer(state, 'p1')[0]!;
    for (const survivor of Object.values(state.survivors)) placeSurvivor(state, survivor.id, 'colony');
    placeSurvivor(state, policeSurvivor.id, 'police-station');

    state.colony.morale = 1;
    state.colony.food = 3;
    expect(mainObjectiveSatisfied(state)).toBe(true);
    // The population zombie fills the last space; the first noise zombie then
    // overruns the entrance and kills the sole survivor there.
    state.locations['police-station']!.entrance.zombies = 2;
    state.locations['police-station']!.noise = 2;
    // With this reset, the two noise rolls are 1 (zombie/overrun) and 5
    // (discarded). The second roll is the evidence that checkpoint three waits
    // for the complete noise batch after morale reaches zero.
    state.seed = 'A7-NOISE';
    state.rngCursor = 0;
    const from = state.log.length;

    runColonyStep(state, NOW, 'addZombies');
    advance(state, NOW);

    const events = expectMoraleLoss(state, from);
    expect(placementsSince(state, from).map(({ location, entrance, outcome }) => ({
      location,
      entrance,
      outcome,
    }))).toEqual([
      { location: 'colony', entrance: 1, outcome: 'placed' },
      { location: 'colony', entrance: 2, outcome: 'placed' },
      { location: 'colony', entrance: 3, outcome: 'placed' },
      { location: 'colony', entrance: 4, outcome: 'placed' },
      { location: 'police-station', entrance: 1, outcome: 'placed' },
      { location: 'police-station', entrance: 1, outcome: 'overrun' },
    ]);
    expect(events.filter((data) => data.event === 'noiseRoll').map((data) => data.roll)).toEqual([
      1,
      5,
    ]);
    expect(events.findIndex((data) => data.event === 'gameOver')).toBeGreaterThan(
      events.map((data) => data.event).lastIndexOf('noiseRoll'),
    );
    expect(state.locations['police-station']!.noise).toBe(0);
    expect(events.filter((data) => data.event === 'mainObjectiveComplete')).toEqual([]);
  });
});
