/**
 * Fixture-free public evidence for the §18.2 Samples kill/remove boundary.
 * The game is created through the shipping plugin and every board mutation is
 * an action accepted by that plugin.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameSettings, GameState, PendingChoice, PlayerId } from '../../types.js';

const NOW = 1_000;
const COLORS = ['ember', 'frost', 'moss', 'rust'] as const;
const P1 = 'p1' as PlayerId;

function seats(): SeatSeed[] {
  return COLORS.map((color, index) => ({
    playerId: `p${index + 1}`,
    name: `P${index + 1}`,
    color,
    isBot: false,
  }));
}

function parseAction(raw: unknown): GameAction {
  const action = deadOfWinter.parseAction(raw);
  expect(action).not.toBeNull();
  return action!;
}

function apply(state: GameState, playerId: PlayerId, raw: unknown): GameState {
  const action = parseAction(raw);
  expect(deadOfWinter.validateAction(state, playerId, action)).toMatchObject({ ok: true });
  return deadOfWinter.applyAction(state, playerId, action, NOW);
}

function firstLegalOption(choice: PendingChoice): string {
  const option = choice.options.find((candidate) => candidate.legal);
  expect(option).toBeDefined();
  return option!.id;
}

function settle(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 100; guard += 1) {
    const choice = current.pendingChoices[0];
    if (!choice) return current;
    if (choice.playerId === null) throw new Error(`Unexpected simultaneous ${choice.kind} choice`);
    current = apply(current, choice.playerId, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: [firstLegalOption(choice)],
    });
  }
  throw new Error('Public choices did not settle');
}

function start(seed: string, mainObjectiveId = 'mo-we-need-more-samples'): GameState {
  const settings: GameSettings = {
    ...deadOfWinter.defaultSettings(),
    playerCount: 4,
    mainObjectiveId,
    includeBetrayalObjective: false,
  };
  const context: CreateGameContext = {
    gameId: `strict-a14-samples-removal-${seed}`,
    code: 'A14SAMP',
    hostId: P1,
    seed,
    now: NOW,
  };
  let state = deadOfWinter.createGame(context, settings, seats());
  for (let guard = 0; state.phase === 'setup' && guard < 100; guard += 1) {
    const choice = state.pendingChoices[0];
    expect(choice).toBeDefined();
    if (choice!.playerId === null) throw new Error('Setup choice unexpectedly simultaneous');
    state = apply(state, choice!.playerId, {
      type: 'resolveChoice',
      choiceId: choice!.id,
      optionIds: choice!.options.filter((option) => option.legal).slice(0, choice!.minPicks ?? 1).map((option) => option.id),
    });
  }
  expect(state.phase).toBe('playerTurns');
  return state;
}

function zombiesAtSchool(state: GameState): number {
  return state.locations.school!.entrance.zombies;
}

function findToolbox(state: GameState): string | undefined {
  return state.players[P1]!.hand.find((iid) => state.items[iid]?.cardId === 'it-toolbox');
}

describe('A14 §18.2 We Need More Samples through the public plugin', () => {
  it('does not sample-credit a public removal', () => {
    let found: GameState | undefined;
    for (let attempt = 0; attempt < 500 && !found; attempt += 1) {
      let state = start(`attempt-${attempt}`);
      if (state.activePlayerId !== P1 || !findToolbox(state)) continue;
      const mover = Object.values(state.survivors).find(
        (survivor) => survivor.controllerId === P1 && survivor.location === 'colony',
      );
      if (!mover) continue;
      const move = parseAction({ type: 'moveSurvivor', survivorId: mover.id, to: 'school' });
      if (!deadOfWinter.validateAction(state, P1, move).ok) continue;
      state = settle(deadOfWinter.applyAction(state, P1, move, NOW));
      if (!state.survivors[mover.id] || state.survivors[mover.id]!.location !== 'school') continue;
      if (zombiesAtSchool(state) < 1) continue;
      found = state;
    }

    expect(found).toBeDefined();
    let state = found!;
    const mover = Object.values(state.survivors).find(
      (survivor) => survivor.controllerId === P1 && survivor.location === 'school',
    )!;
    const toolbox = findToolbox(state)!;
    state = apply(state, P1, { type: 'playItem', iid: toolbox, targetSurvivorId: mover.id });
    state = apply(state, P1, {
      type: 'useAbility',
      survivorId: mover.id,
      abilityId: 'toolbox-work',
      itemIid: toolbox,
    });

    const choice = state.pendingChoices[0]!;
    const clear = choice.options.find((option) => option.id === 'toolbox-clear');
    expect(choice.kind).toBe('effectOption');
    expect(clear).toMatchObject({ legal: true });
    const samplesBefore = state.mainObjective.counters.samples;
    const logBefore = state.log.length;
    state = apply(state, P1, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: ['toolbox-clear'],
    });

    const removalLog = state.log.slice(logBefore).find((entry) => entry.data?.event === 'zombiesRemoved');
    expect(removalLog?.data).toMatchObject({ isKill: false, count: 1 });
    expect(state.mainObjective.counters.samples).toBe(samplesBefore);
    expect(state.log.slice(logBefore).some((entry) => entry.data?.event === 'zombieKilled')).toBe(false);
    expect(state.log.slice(logBefore).some((entry) => entry.data?.event === 'effectRoll' && entry.data.store === 'sample')).toBe(false);
  });

  it('counts the authored Bev Russell option toward Raiding Party through public actions', () => {
    let found: GameState | undefined;
    for (let attempt = 0; attempt < 1_000 && !found; attempt += 1) {
      let state = start(`raiding-party-${attempt}`, 'mo-raiding-party');
      const actor = state.activePlayerId;
      if (!actor || state.turn?.crossroadsCardId !== 'xr-f73') continue;
      const mover = Object.values(state.survivors).find(
        (survivor) => survivor.controllerId === actor && survivor.location === 'colony',
      );
      if (!mover) continue;
      const move = parseAction({ type: 'moveSurvivor', survivorId: mover.id, to: 'school' });
      if (!deadOfWinter.validateAction(state, actor, move).ok) continue;
      state = deadOfWinter.applyAction(state, actor, move, NOW);
      if (!state.survivors[mover.id]) continue;
      const choice = state.pendingChoices[0];
      if (choice?.kind !== 'effectOption' || choice.data?.source !== 'crossroads') continue;
      if (choice.data.cardId !== 'xr-f73') continue;
      found = state;
    }

    expect(found).toBeDefined();
    const state = found!;
    const actor = state.activePlayerId!;
    const choice = state.pendingChoices[0]!;
    expect(choice.options).toMatchObject([
      { id: 'raiding-party', legal: true },
    ]);
    const next = apply(state, actor, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: ['raiding-party'],
    });
    expect(next.mainObjective.counters.bevRussellOptions).toBe(1);
    expect(next.log.some((entry) => entry.data?.event === 'crossroadsResolved')).toBe(true);
  });
});
