/**
 * A14 public-boundary evidence.
 *
 * This suite deliberately uses the shipping GamePlugin surface rather than the
 * engine helpers. Direct state reads below are observations of a state produced
 * by public setup/action calls; they do not arrange the behavior under test.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { COLONY } from '../../content/primitives.js';
import { ACTIVE_PACK, deadOfWinter } from '../../plugin.js';
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

function context(seed: string): CreateGameContext {
  return {
    gameId: 'a14-public',
    code: 'A14PUB',
    hostId: 'p1',
    seed,
    now: NOW,
  };
}

function parseSettings(raw: unknown): Partial<GameSettings> {
  const parsed = deadOfWinter.parseSettingsPatch(raw);
  expect(parsed).not.toBeNull();
  return parsed!;
}

function parseAction(raw: unknown): GameAction {
  const parsed = deadOfWinter.parseAction(raw);
  expect(parsed).not.toBeNull();
  return parsed!;
}

function applyParsed(state: GameState, playerId: PlayerId, raw: unknown): GameState {
  const action = parseAction(raw);
  expect(deadOfWinter.validateAction(state, playerId, action)).toMatchObject({ ok: true });
  return deadOfWinter.applyAction(state, playerId, action, NOW);
}

function answerPublicChoice(state: GameState): GameState {
  const choice = state.pendingChoices[0];
  expect(choice).toBeDefined();
  const legal = choice!.options.filter((option) => option.legal);
  const picks = Math.max(1, choice!.minPicks ?? 1);
  expect(legal.length).toBeGreaterThanOrEqual(picks);
  const playerId = choice!.playerId ?? state.activePlayerId ?? state.seating[0]!;
  const action = parseAction({
    type: 'resolveChoice',
    choiceId: choice!.id,
    optionIds: legal.slice(0, picks).map((option) => option.id),
  });

  if (state.activePlayerId !== playerId) {
    expect(deadOfWinter.allowsOutOfTurn(state, playerId, action)).toBe(true);
  }
  expect(deadOfWinter.validateAction(state, playerId, action)).toMatchObject({ ok: true });
  return deadOfWinter.applyAction(state, playerId, action, NOW);
}

function setupThroughPlugin(seed: string, rawPatch: unknown): GameState {
  const settings = {
    ...deadOfWinter.defaultSettings(),
    ...parseSettings(rawPatch),
  };
  expect(deadOfWinter.validateSettings(settings, settings.playerCount)).toMatchObject({ ok: true });

  let state = deadOfWinter.createGame(context(seed), settings, seats(settings.playerCount));
  for (let guard = 0; state.phase === 'setup' && guard < 100; guard++) {
    state = answerPublicChoice(state);
  }

  expect(state.phase).toBe('playerTurns');
  expect(deadOfWinter.activePlayerOf(state)).toBe(state.turn!.playerId);
  return state;
}

function zombiesAt(state: GameState, location: string): number {
  if (location === COLONY) {
    return state.colony.entrances.reduce((total, entrance) => total + entrance.zombies, 0);
  }
  return state.locations[location]!.entrance.zombies;
}

function logEvents(state: GameState, event: string) {
  return state.log.filter((entry) => entry.data?.event === event);
}

describe('A14 §18 through the active Dead of Winter GamePlugin boundary', () => {
  it('exposes the incomplete fixture-backed catalog as non-shipping', () => {
    expect(deadOfWinter.contentStatus).toMatchObject({
      shipping: false,
      kind: 'non-shipping',
    });
    expect(deadOfWinter.contentStatus.fixtureBackedFamilies).toEqual([
      'mainObjectives',
      'secretObjectives',
    ]);
    expect(ACTIVE_PACK.pack.name).toMatch(/non-shipping/i);
  });

  it('pins the exact active content pack through public setup and audit state', () => {
    const state = setupThroughPlugin('A14-PUBLIC-CONTENT', {
      playerCount: 4,
      mainObjectiveId: 'mo-we-need-more-samples',
      includeBetrayalObjective: false,
    });
    const setupStart = logEvents(state, 'setupStart')[0]?.data;

    // This proves the plugin cannot silently substitute a different pack while
    // a match is running. The separate status test above is the explicit
    // boundary evidence that this fixture-backed pack is not retail content.
    expect(state.contentPackId).toBe(ACTIVE_PACK.pack.id);
    expect(state.contentVersion).toBe(ACTIVE_PACK.pack.version);
    expect(setupStart?.contentPack).toBe(`${ACTIVE_PACK.pack.id}@${ACTIVE_PACK.pack.version}`);
  });

  it('§18.1 Attract and betrayal-omission errata run through parse/validate/apply/redact paths', () => {
    let state = setupThroughPlugin('A14-PUBLIC-ACTIONS', {
      playerCount: 4,
      mainObjectiveId: 'mo-we-need-more-samples',
      includeBetrayalObjective: false,
    });
    const playerId = deadOfWinter.activePlayerOf(state)!;
    const survivor = Object.values(state.survivors).find(
      (candidate) => candidate.controllerId === playerId && candidate.location === COLONY,
    );
    expect(survivor).toBeDefined();

    const setupData = logEvents(state, 'secretObjectivesDealt')[0]?.data;
    expect(setupData).toMatchObject({ betrayalIncluded: false });

    const hiddenHandItem = state.players[playerId]!.hand[0]!;
    const otherPlayerId = state.seating.find((id) => id !== playerId)!;
    const ownerView = deadOfWinter.redactStateFor(state, playerId);
    const otherView = deadOfWinter.redactStateFor(state, otherPlayerId);
    expect(ownerView.players[playerId]!.hand).toContain(hiddenHandItem);
    expect(otherView.players[playerId]!.hand).toHaveLength(state.players[playerId]!.hand.length);
    expect(otherView.players[playerId]!.hand).not.toContain(hiddenHandItem);
    expect(otherView.items[hiddenHandItem]).toBeUndefined();
    expect(otherView.seed).toBe('');
    expect(otherView.settings.seed).toBe('');

    const schoolBeforeZero = zombiesAt(state, 'school');
    const zeroMoveDie = state.players[playerId]!.unusedDice[0]!;
    state = applyParsed(state, playerId, {
      type: 'attract',
      survivorId: survivor!.id,
      die: zeroMoveDie,
      from: 'school',
      count: 0,
    });
    expect(zombiesAt(state, 'school')).toBe(schoolBeforeZero);
    expect(state.players[playerId]!.usedDice).toContain(zeroMoveDie);

    const schoolBeforeOne = zombiesAt(state, 'school');
    const oneMoveDie = state.players[playerId]!.unusedDice[0]!;
    state = applyParsed(state, playerId, {
      type: 'attract',
      survivorId: survivor!.id,
      die: oneMoveDie,
      from: 'school',
      count: 2,
    });
    expect(schoolBeforeOne).toBe(1);
    expect(zombiesAt(state, 'school')).toBe(0);
    expect(zombiesAt(state, COLONY)).toBe(1);
    expect(logEvents(state, 'attract').at(-1)?.data).toMatchObject({
      from: 'school',
      to: COLONY,
      count: 1,
    });
  });
});
