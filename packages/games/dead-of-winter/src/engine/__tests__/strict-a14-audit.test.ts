/**
 * Strict A14 evidence for the authored We Need More Samples card through the
 * public GamePlugin boundary. This file intentionally imports no engine
 * helper, fixture pack, or content definition.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameSettings, GameState, PlayerId } from '../../types.js';

const NOW = 1_000;
const SEAT_COLORS = ['ember', 'frost', 'moss', 'rust', 'violet'] as const;

function seats(count: number): SeatSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${index + 1}`,
    name: `P${index + 1}`,
    color: SEAT_COLORS[index % SEAT_COLORS.length]!,
    isBot: false,
  }));
}

function action(raw: unknown): GameAction {
  const parsed = deadOfWinter.parseAction(raw);
  expect(parsed).not.toBeNull();
  return parsed!;
}

function apply(state: GameState, playerId: PlayerId, raw: unknown): GameState {
  const parsed = action(raw);
  expect(deadOfWinter.validateAction(state, playerId, parsed)).toMatchObject({ ok: true });
  return deadOfWinter.applyAction(state, playerId, parsed, NOW);
}

function settleChoices(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 100; guard += 1) {
    const choice = current.pendingChoices[0];
    if (!choice) return current;
    const legal = choice.options.filter((option) => option.legal);
    const count = Math.max(1, choice.minPicks ?? 1);
    expect(legal.length).toBeGreaterThanOrEqual(count);
    current = apply(current, choice.playerId ?? current.activePlayerId!, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: legal.slice(0, count).map((option) => option.id),
    });
  }
  throw new Error('public choice queue did not settle');
}

function start(seed: string): GameState {
  const settings: GameSettings = {
    ...deadOfWinter.defaultSettings(),
    playerCount: 4,
    mainObjectiveId: 'mo-we-need-more-samples',
    includeBetrayalObjective: false,
  };
  const context: CreateGameContext = {
    gameId: `strict-a14-${seed}`,
    code: 'A14AUDIT',
    hostId: 'p1' as PlayerId,
    seed,
    now: NOW,
  };
  let state = deadOfWinter.createGame(context, settings, seats(4));
  for (let guard = 0; state.phase === 'setup' && guard < 100; guard += 1) {
    state = settleChoices(state);
  }
  expect(state.phase).toBe('playerTurns');
  return state;
}

function zombiesAt(state: GameState, location: string): number {
  if (location === 'colony') {
    return state.colony.entrances.reduce((total, entrance) => total + entrance.zombies, 0);
  }
  return state.locations[location]!.entrance.zombies;
}

function eventIndex(
  state: GameState,
  event: string,
  predicate?: (data: Record<string, unknown>) => boolean,
  startAt = 0,
): number {
  return state.log.findIndex((entry, index) => {
    if (index < startAt) return false;
    const data = entry.data;
    return data?.event === event && (!predicate || predicate(data));
  });
}

describe('A14 §18.2 authored objective through the public GamePlugin boundary', () => {
  it('uses the introductory We Need More Samples setup values', () => {
    const state = start('strict-a14-samples-setup');

    expect(state.mainObjective).toMatchObject({
      cardId: 'mo-we-need-more-samples',
      startingPlayerCount: 4,
      counters: { samples: 0 },
    });
    expect(state.colony).toMatchObject({ morale: 6, rounds: 6 });
    for (const location of [
      'grocery-store',
      'gas-station',
      'library',
      'school',
      'hospital',
      'police-station',
    ]) {
      expect(zombiesAt(state, location), `${location} setup zombies`).toBe(1);
    }
  });

  it('records the mandatory sample check before exposure on a public kill action', () => {
    let result: GameState | undefined;
    for (let attempt = 0; attempt < 100 && !result; attempt += 1) {
      let state = start(`strict-a14-samples-kill-${attempt}`);
      const playerId = state.activePlayerId!;
      const survivor = Object.values(state.survivors).find(
        (candidate) => candidate.controllerId === playerId && candidate.location === 'colony' && candidate.cardId !== 'sv-edward-white',
      );
      if (!survivor) continue;

      state = settleChoices(apply(state, playerId, {
        type: 'moveSurvivor',
        survivorId: survivor.id,
        to: 'school',
      }));
      const moved = state.survivors[survivor.id];
      if (!moved || moved.location !== 'school' || zombiesAt(state, 'school') < 1) continue;
      const die = state.players[playerId]!.unusedDice.find((value) =>
        deadOfWinter.validateAction(state, playerId, action({
          type: 'attackZombie',
          survivorId: moved.id,
          die: value,
        })).ok,
      );
      if (die === undefined) continue;
      const attack = action({ type: 'attackZombie', survivorId: moved.id, die });
      result = deadOfWinter.applyAction(state, playerId, attack, NOW);
    }

    expect(result).toBeDefined();
    const state = result!;
    const kill = state.log.reduce(
      (last, entry, index) => (entry.data?.event === 'zombieKilled' ? index : last),
      -1,
    );
    const sampleRoll = eventIndex(state, 'effectRoll', (data) => data.store === 'sample', kill);
    const exposure = eventIndex(state, 'exposure', undefined, kill);
    expect(kill).toBeGreaterThanOrEqual(0);
    expect(sampleRoll).toBeGreaterThanOrEqual(0);
    expect(exposure).toBeGreaterThan(sampleRoll);
    expect(eventIndex(state, 'zombieKilled')).toBeGreaterThanOrEqual(0);
  });
});
