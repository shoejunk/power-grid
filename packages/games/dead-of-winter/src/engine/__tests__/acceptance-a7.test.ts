/**
 * §23 acceptance criterion A7.
 *
 *   "Colony entrance cycling, barricade destruction, overruns, casualty
 *    choice, non-colony placement, and noise-generated zombies resolve in the
 *    correct order."
 *
 * These tests drive the public, resumable effect engine. In particular, the
 * casualty test proves that an overrun really pauses an unfinished placement
 * batch and that the chosen death finishes before the next zombie arrives.
 */

import { describe, expect, it } from 'vitest';

import type {
  EngineEffect,
  GameState,
  LocationId,
  SurvivorInstance,
} from '../../types.js';
import { advance, pushFrame, runColonyStep } from '../index.js';
import { NOW, choose, placeSurvivor, start } from './helpers.js';

interface AutomaticEvent {
  event?: string;
  location?: LocationId;
  entrance?: number;
  outcome?: string;
  roll?: number;
  survivorId?: string;
  cause?: string;
  total?: number;
  required?: number;
  prevented?: boolean;
}

function game(): GameState {
  const state = start({ playerCount: 4, seed: 'A7-FIXTURE' });
  // Crossroads are unrelated to A7 and must not intercept a synthetic batch.
  if (state.turn) state.turn.crossroadsTriggered = true;
  return state;
}

function runEffects(state: GameState, effects: EngineEffect[]): void {
  pushFrame(state, effects);
  advance(state, NOW);
}

function clearEntrances(state: GameState): void {
  for (const entrance of state.colony.entrances) {
    entrance.zombies = 0;
    entrance.barricades = 0;
  }
  for (const location of Object.values(state.locations)) {
    location.entrance.zombies = 0;
    location.entrance.barricades = 0;
  }
}

function eventsSince(state: GameState, from: number): AutomaticEvent[] {
  return state.log.slice(from).map((entry) => (entry.data ?? {}) as AutomaticEvent);
}

function placementSummary(state: GameState, from: number) {
  return eventsSince(state, from)
    .filter((data) => data.event === 'zombiePlacement')
    .map(({ location, entrance, outcome }) => ({ location, entrance, outcome }));
}

function lastCrisisOutcome(state: GameState): AutomaticEvent | undefined {
  return [...state.log]
    .reverse()
    .map((entry) => (entry.data ?? {}) as AutomaticEvent)
    .find((data) => data.event === 'crisisResolved');
}

function followers(state: GameState): SurvivorInstance[] {
  return Object.values(state.survivors).filter((survivor) => !survivor.isLeader);
}

/** Move every normal survivor out while respecting the fixture's location capacities. */
function evacuateColony(state: GameState): void {
  const destinations = ['police-station', 'grocery-store'] as const;
  Object.values(state.survivors).forEach((survivor, index) => {
    placeSurvivor(state, survivor.id, destinations[Math.floor(index / 4)]!);
  });
}

describe('§23 A7 — colony placement cycle', () => {
  it('cycles through entrance 6 and wraps the seventh incoming zombie to entrance 1', () => {
    const state = game();
    clearEntrances(state);
    const from = state.log.length;

    runEffects(state, [
      { kind: 'i.resetEntrancePointer' },
      ...Array.from({ length: 7 }, () => ({
        kind: 'i.placeZombie' as const,
        location: 'colony' as const,
        cycleEntrances: true,
      })),
    ]);

    expect(placementSummary(state, from).map(({ entrance, outcome }) => ({ entrance, outcome }))).toEqual([
      { entrance: 1, outcome: 'placed' },
      { entrance: 2, outcome: 'placed' },
      { entrance: 3, outcome: 'placed' },
      { entrance: 4, outcome: 'placed' },
      { entrance: 5, outcome: 'placed' },
      { entrance: 6, outcome: 'placed' },
      { entrance: 1, outcome: 'placed' },
    ]);
    expect(state.colony.entrances.map((entrance) => entrance.zombies)).toEqual([2, 1, 1, 1, 1, 1]);
    expect(state.colony.entrancePointer).toBe(1);
  });

  it('restarts at entrance 1, advances after a destroyed barricade, and wraps independently for a new batch', () => {
    const state = game();
    clearEntrances(state);

    // Entrance 1 is full: the barricade consumes the first incoming zombie.
    state.colony.entrances[0]!.zombies = 1;
    state.colony.entrances[0]!.barricades = 1;
    // A stale pointer must not leak into a distinct add-zombies sequence.
    state.colony.entrancePointer = 4;
    const firstLog = state.log.length;

    runEffects(state, [
      { kind: 'i.resetEntrancePointer' },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
    ]);

    expect(placementSummary(state, firstLog)).toEqual([
      { location: 'colony', entrance: 1, outcome: 'barricadeDestroyed' },
      { location: 'colony', entrance: 2, outcome: 'placed' },
      { location: 'colony', entrance: 3, outcome: 'placed' },
    ]);
    expect(state.colony.entrances.map((entrance) => [entrance.zombies, entrance.barricades])).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(state.colony.entrancePointer).toBe(3);

    const secondLog = state.log.length;
    runEffects(state, [
      { kind: 'i.resetEntrancePointer' },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
    ]);

    expect(placementSummary(state, secondLog)).toEqual([
      { location: 'colony', entrance: 1, outcome: 'placed' },
    ]);
    expect(state.colony.entrances[0]).toMatchObject({ zombies: 2, barricades: 0 });
    expect(state.colony.entrancePointer).toBe(1);
  });
});

describe('§23 A7 — overruns and casualty ordering', () => {
  it('pauses a colony batch for a first-player choice among only tied lowest-influence survivors', () => {
    let state = game();
    clearEntrances(state);

    const [victimA, victimB] = followers(state);
    expect(victimA).toBeDefined();
    expect(victimB).toBeDefined();
    // Scaffolding: create an unambiguous 3/3 tie while everyone else is 4.
    for (const survivor of Object.values(state.survivors)) survivor.cardId = 'sv-edward-white';
    victimA!.cardId = 'sv-loretta-clay';
    victimB!.cardId = 'sv-buddy-davis';

    state.colony.entrances[0]!.zombies = state.colony.entrances[0]!.capacity;
    const from = state.log.length;
    runEffects(state, [
      { kind: 'i.resetEntrancePointer' },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
    ]);

    const choice = state.pendingChoices[0];
    expect(choice).toMatchObject({
      kind: 'overrunCasualty',
      playerId: state.firstPlayerId,
      data: { location: 'colony' },
    });
    expect(choice!.options.map((option) => option.id).sort()).toEqual(
      [victimA!.id, victimB!.id].sort(),
    );
    expect(state.colony.entrances[1]!.zombies).toBe(0);
    expect(placementSummary(state, from)).toEqual([
      { location: 'colony', entrance: 1, outcome: 'overrun' },
    ]);

    // Select the second tied survivor to prove the prompt, not insertion order,
    // controls the casualty. Resolving it also resumes the interrupted batch.
    state = choose(state, state.firstPlayerId, choice!.id, [victimB!.id]);

    expect(state.survivors[victimB!.id]).toBeUndefined();
    expect(state.survivors[victimA!.id]).toBeDefined();
    expect(state.colony.entrances[1]!.zombies).toBe(1);
    const resumed = eventsSince(state, from).filter((data) =>
      ['zombiePlacement', 'survivorDied'].includes(data.event ?? ''),
    );
    expect(resumed.map(({ event, entrance, outcome, survivorId, cause }) => ({
      event,
      entrance,
      outcome,
      survivorId,
      cause,
    }))).toEqual([
      {
        event: 'zombiePlacement',
        entrance: 1,
        outcome: 'overrun',
        survivorId: undefined,
        cause: undefined,
      },
      {
        event: 'survivorDied',
        entrance: undefined,
        outcome: undefined,
        survivorId: victimB!.id,
        cause: 'overrun',
      },
      {
        event: 'zombiePlacement',
        entrance: 2,
        outcome: 'placed',
        survivorId: undefined,
        cause: undefined,
      },
    ]);
  });

  it('uses the sole non-colony entrance for barricade destruction, placement, then overrun casualty', () => {
    const state = game();
    clearEntrances(state);
    const victim = followers(state)[0]!;
    for (const survivor of Object.values(state.survivors)) placeSurvivor(state, survivor.id, 'colony');
    placeSurvivor(state, victim.id, 'police-station');

    const entrance = state.locations['police-station']!.entrance;
    entrance.zombies = 2;
    entrance.barricades = 1;
    state.colony.entrancePointer = 4;
    const from = state.log.length;

    runEffects(state, [
      { kind: 'i.placeZombie', location: 'police-station', cycleEntrances: false },
      { kind: 'i.placeZombie', location: 'police-station', cycleEntrances: false },
      { kind: 'i.placeZombie', location: 'police-station', cycleEntrances: false },
    ]);

    expect(placementSummary(state, from)).toEqual([
      { location: 'police-station', entrance: 1, outcome: 'barricadeDestroyed' },
      { location: 'police-station', entrance: 1, outcome: 'placed' },
      { location: 'police-station', entrance: 1, outcome: 'overrun' },
    ]);
    expect(entrance).toMatchObject({ zombies: 3, barricades: 0 });
    expect(state.survivors[victim.id]).toBeUndefined();
    expect(state.colony.entrancePointer).toBe(4);
  });

  it('finishes a last-survivor replacement before the next queued zombie reaches the next entrance', () => {
    const state = game();
    clearEntrances(state);
    const playerId = state.seating[0]!;
    const controlled = Object.values(state.survivors).filter(
      (survivor) => survivor.controllerId === playerId,
    );
    const victim = controlled.find((survivor) => survivor.isLeader)!;
    expect(victim).toBeDefined();
    for (const survivor of controlled) {
      if (survivor.id !== victim.id) delete state.survivors[survivor.id];
    }
    victim.cardId = 'sv-forest-plum'; // influence 1
    for (const survivor of Object.values(state.survivors)) {
      if (survivor.id !== victim.id) survivor.cardId = 'sv-edward-white'; // influence 4
    }
    const replacementCardId = state.decks.survivors[0];
    expect(replacementCardId).toBeTruthy();

    state.colony.entrances[0]!.zombies = state.colony.entrances[0]!.capacity;
    const from = state.log.length;
    runEffects(state, [
      { kind: 'i.resetEntrancePointer' },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
    ]);

    expect(state.survivors[victim.id]).toBeUndefined();
    const replacement = Object.values(state.survivors).find(
      (survivor) => survivor.controllerId === playerId,
    );
    expect(replacement).toMatchObject({
      cardId: replacementCardId,
      controllerId: playerId,
      location: 'colony',
      isLeader: true,
    });
    expect(state.colony.entrances[1]!.zombies).toBe(1);
    expect(eventsSince(state, from)
      .filter((data) => ['zombiePlacement', 'survivorDied', 'survivorAdded'].includes(data.event ?? ''))
      .map(({ event, entrance, outcome, survivorId }) => ({ event, entrance, outcome, survivorId })))
      .toEqual([
        { event: 'zombiePlacement', entrance: 1, outcome: 'overrun', survivorId: undefined },
        { event: 'survivorDied', entrance: undefined, outcome: undefined, survivorId: victim.id },
        {
          event: 'survivorAdded',
          entrance: undefined,
          outcome: undefined,
          survivorId: replacement!.id,
        },
        { event: 'zombiePlacement', entrance: 2, outcome: 'placed', survivorId: undefined },
      ]);
  });

  it('kills one helpless survivor when a colony overrun has no normal casualty', () => {
    const state = game();
    clearEntrances(state);
    evacuateColony(state);
    state.colony.helpless = 2;
    state.colony.entrances[0]!.zombies = state.colony.entrances[0]!.capacity;
    const moraleBefore = state.colony.morale;
    const from = state.log.length;

    runEffects(state, [
      { kind: 'i.resetEntrancePointer' },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
    ]);

    expect(state.colony.helpless).toBe(1);
    expect(state.colony.morale).toBe(moraleBefore - 1);
    expect(eventsSince(state, from)
      .filter((data) => ['zombiePlacement', 'helplessDied'].includes(data.event ?? ''))
      .map(({ event, entrance, outcome }) => ({ event, entrance, outcome }))).toEqual([
      { event: 'zombiePlacement', entrance: 1, outcome: 'overrun' },
      { event: 'helplessDied', entrance: undefined, outcome: undefined },
    ]);
  });

  it('discards an overrun zombie without a casualty when the location is empty', () => {
    const state = game();
    clearEntrances(state);
    evacuateColony(state);
    state.colony.helpless = 0;
    state.colony.entrances[0]!.zombies = state.colony.entrances[0]!.capacity;
    const moraleBefore = state.colony.morale;
    const from = state.log.length;

    runEffects(state, [
      { kind: 'i.resetEntrancePointer' },
      { kind: 'i.placeZombie', location: 'colony', cycleEntrances: true },
    ]);

    expect(state.colony.morale).toBe(moraleBefore);
    expect(state.colony.entrances[0]!.zombies).toBe(state.colony.entrances[0]!.capacity);
    expect(eventsSince(state, from)
      .filter((data) => ['zombiePlacement', 'overrunEmpty'].includes(data.event ?? ''))
      .map(({ event, entrance, outcome, location }) => ({ event, entrance, outcome, location })))
      .toEqual([
        { event: 'zombiePlacement', entrance: 1, outcome: 'overrun', location: 'colony' },
        { event: 'overrunEmpty', entrance: undefined, outcome: undefined, location: 'colony' },
      ]);
    expect(eventsSince(state, from).some((data) => data.event === 'survivorDied')).toBe(false);
    expect(eventsSince(state, from).some((data) => data.event === 'helplessDied')).toBe(false);
  });
});

describe('§23 A7 — distinct placement sequences', () => {
  it('isolates a crisis-authored colony sequence from the later real Add Zombies cycle', () => {
    const state = game();
    clearEntrances(state);
    state.colony.food = 20;
    state.crisis.cardId = 'cr-2'; // failure is an authored two-zombie colony effect
    state.crisis.contributions = [];
    state.colony.entrancePointer = 5;
    const crisisLog = state.log.length;

    runColonyStep(state, NOW, 'resolveCrisis');
    advance(state, NOW);

    expect(lastCrisisOutcome(state)).toMatchObject({ total: 0, required: 4, prevented: false });
    expect(placementSummary(state, crisisLog)).toEqual([
      { location: 'colony', entrance: 1, outcome: 'placed' },
      { location: 'colony', entrance: 2, outcome: 'placed' },
    ]);
    expect(state.colony.entrancePointer).toBe(2);

    const addZombiesLog = state.log.length;
    runColonyStep(state, NOW + 1, 'addZombies');
    advance(state, NOW + 1);

    // Eight colony occupants generate four zombies. The real Add Zombies step
    // must restart at 1 rather than continuing the crisis pointer at 3.
    expect(placementSummary(state, addZombiesLog)).toEqual([
      { location: 'colony', entrance: 1, outcome: 'placed' },
      { location: 'colony', entrance: 2, outcome: 'placed' },
      { location: 'colony', entrance: 3, outcome: 'placed' },
      { location: 'colony', entrance: 4, outcome: 'placed' },
    ]);
    expect(state.colony.entrancePointer).toBe(4);
  });
});

describe('§23 A7 — Add Zombies population and noise batches', () => {
  it('resolves population locations first, then each noise token in stable location/token order', () => {
    const state = game();
    clearEntrances(state);
    const [atPolice, atSchool] = followers(state);
    expect(atPolice).toBeDefined();
    expect(atSchool).toBeDefined();
    for (const survivor of Object.values(state.survivors)) placeSurvivor(state, survivor.id, 'colony');
    placeSurvivor(state, atPolice!.id, 'police-station');
    placeSurvivor(state, atSchool!.id, 'school');

    state.locations['police-station']!.noise = 2;
    state.locations['grocery-store']!.noise = 1;
    state.locations.school!.noise = 2;
    // Fix the random stream: the five rolls are 1, 5, 3, 6, 5. This gives
    // both success and failure branches while making their locations observable.
    state.seed = 'A7-NOISE';
    state.rngCursor = 0;
    const from = state.log.length;

    runColonyStep(state, NOW, 'addZombies');
    advance(state, NOW);

    expect(eventsSince(state, from)
      .filter((data) => data.event === 'zombiePlacement' || data.event === 'noiseRoll')
      .map(({ event, location, entrance, outcome, roll }) => ({
        event,
        location,
        entrance,
        outcome,
        roll,
      }))).toEqual([
      // Colony population: six occupants -> three zombies, starting at 1.
      { event: 'zombiePlacement', location: 'colony', entrance: 1, outcome: 'placed', roll: undefined },
      { event: 'zombiePlacement', location: 'colony', entrance: 2, outcome: 'placed', roll: undefined },
      { event: 'zombiePlacement', location: 'colony', entrance: 3, outcome: 'placed', roll: undefined },
      // Non-colony population follows content order, not survivor insertion order.
      { event: 'zombiePlacement', location: 'police-station', entrance: 1, outcome: 'placed', roll: undefined },
      { event: 'zombiePlacement', location: 'school', entrance: 1, outcome: 'placed', roll: undefined },
      // Each token is removed and rolled before the next token/location.
      { event: 'noiseRoll', location: 'police-station', entrance: undefined, outcome: undefined, roll: 1 },
      { event: 'zombiePlacement', location: 'police-station', entrance: 1, outcome: 'placed', roll: undefined },
      { event: 'noiseRoll', location: 'police-station', entrance: undefined, outcome: undefined, roll: 5 },
      { event: 'noiseRoll', location: 'grocery-store', entrance: undefined, outcome: undefined, roll: 3 },
      { event: 'zombiePlacement', location: 'grocery-store', entrance: 1, outcome: 'placed', roll: undefined },
      { event: 'noiseRoll', location: 'school', entrance: undefined, outcome: undefined, roll: 6 },
      { event: 'noiseRoll', location: 'school', entrance: undefined, outcome: undefined, roll: 5 },
    ]);
    expect(state.rngCursor).toBe(5);
    expect(state.locations['police-station']!.noise).toBe(0);
    expect(state.locations['grocery-store']!.noise).toBe(0);
    expect(state.locations.school!.noise).toBe(0);
    expect(state.locations['police-station']!.entrance.zombies).toBe(2);
    expect(state.locations['grocery-store']!.entrance.zombies).toBe(1);
    expect(state.locations.school!.entrance.zombies).toBe(1);
  });
});
