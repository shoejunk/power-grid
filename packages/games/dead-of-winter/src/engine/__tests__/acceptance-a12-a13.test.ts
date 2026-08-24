/**
 * §23 A12/A13 and the §18.2 objective rulings that belong to this boundary.
 * These tests use the reducer's public actions for turn, colony, combat, vote,
 * and game-end transitions; direct state edits only arrange compact fixtures.
 */

import { Rng } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { NON_COLONY_LOCATIONS } from '../../content/primitives.js';
import type {
  ItemCardDefinition,
  MainObjectiveDefinition,
  SecretObjectiveDefinition,
} from '../../content/schema.js';
import type { GameState, PlayerId } from '../../types.js';
import {
  contentOf,
  mainObjectiveSatisfied,
  placeSurvivor as addSurvivor,
  redactStateFor,
  secretObjectiveComplete,
  validateAction,
} from '../index.js';
import {
  NOW,
  act,
  addZombies,
  choose,
  eventSequence,
  extendPack,
  grantItem,
  logEvents,
  pending,
  placeSurvivor,
  setDice,
  start,
  survivorsOfPlayer,
} from './helpers.js';

const raidingParty: MainObjectiveDefinition = {
  id: 'mo-raiding-party',
  name: 'Raiding Party',
  standard: {
    text: 'Have a survivor at the police station.',
    startingMorale: 8,
    startingRounds: 8,
    setup: [],
    completion: {
      kind: 'survivorsAt',
      location: { kind: 'fixed', location: 'police-station' },
      atLeast: 1,
    },
  },
  hardcore: {
    text: 'Have a survivor at the police station.',
    startingMorale: 6,
    startingRounds: 7,
    setup: [],
    completion: {
      kind: 'survivorsAt',
      location: { kind: 'fixed', location: 'police-station' },
      atLeast: 1,
    },
  },
};

const lastRound: MainObjectiveDefinition = {
  id: 'mo-last-round',
  name: 'Last Round',
  standard: {
    text: 'Survive one round.',
    startingMorale: 10,
    startingRounds: 1,
    setup: [],
    completion: { kind: 'roundsSurvived', atLeast: 1 },
  },
  hardcore: {
    text: 'Survive one round.',
    startingMorale: 8,
    startingRounds: 1,
    setup: [],
    completion: { kind: 'roundsSurvived', atLeast: 1 },
  },
};

const moraleBoundary: MainObjectiveDefinition = {
  id: 'mo-morale-boundary',
  name: 'Morale Boundary',
  standard: {
    text: 'The objective is already complete.',
    startingMorale: 1,
    startingRounds: 8,
    setup: [],
    completion: { kind: 'always' },
  },
  hardcore: {
    text: 'The objective is already complete.',
    startingMorale: 1,
    startingRounds: 7,
    setup: [],
    completion: { kind: 'always' },
  },
};

const hunger: SecretObjectiveDefinition = {
  id: 'so-hunger',
  name: 'Hunger',
  text: 'End the game holding food cards.',
  kind: 'nonBetrayal',
  completion: {
    kind: 'holdsCards',
    player: { kind: 'effectController' },
    requirement: { symbols: ['food'] },
    atLeast: 2,
  },
  nonCooperative: false,
  matureContent: false,
};

/** A real reducer-playable card used to reach morale zero without pushFrame. */
const moraleLossCard: ItemCardDefinition = {
  id: 'it-a12-morale-loss',
  name: 'A12 Morale Loss',
  text: 'Reduce morale by one.',
  symbols: ['tool'],
  deck: 'school',
  textKind: 'normal',
  kind: 'oneShot',
  onPlay: { kind: 'adjustMorale', amount: -1 },
  nonCooperative: false,
  matureContent: false,
};

const A12_A13_PACK = extendPack('acceptance-a12-a13', {
  items: [moraleLossCard],
  mainObjectives: [raidingParty, lastRound, moraleBoundary],
  secretObjectives: [hunger],
});

function game(mainObjectiveId = 'mo-stockpile'): GameState {
  const state = start({
    playerCount: 4,
    seed: 'ACCEPTANCE-A12-A13',
    settings: { mainObjectiveId },
    pack: A12_A13_PACK,
  });
  if (state.turn) state.turn.crossroadsTriggered = true;
  return state;
}

function gameWithPlayers(mainObjectiveId: string, playerCount: number): GameState {
  const state = start({
    playerCount,
    seed: `ACCEPTANCE-A12-A13-${playerCount}`,
    settings: { mainObjectiveId },
    pack: A12_A13_PACK,
  });
  if (state.turn) state.turn.crossroadsTriggered = true;
  return state;
}

function active(state: GameState): PlayerId {
  return state.turn!.playerId;
}

/** Finish only the current player-turn phase through public endTurn actions. */
function finishPlayerTurns(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 20; guard += 1) {
    if (next.phase !== 'playerTurns') return next;
    const playerId = next.turn?.playerId;
    if (!playerId) throw new Error('finishPlayerTurns(): player turn disappeared');
    next = act(next, playerId, { type: 'endTurn' });
    // Crossroads are outside this criterion; keep every newly begun turn quiet.
    if (next.turn) next.turn.crossroadsTriggered = true;
  }
  throw new Error('finishPlayerTurns(): did not settle');
}

/** Positions the persisted RNG cursor before an exact d6 sequence. */
function nextRolls(state: GameState, expected: number[]): void {
  for (let cursor = 0; cursor < 100_000; cursor += 1) {
    const rng = new Rng(state.seed, cursor);
    if (expected.every((value) => rng.die(6) === value)) {
      state.rngCursor = cursor;
      return;
    }
  }
  throw new Error(`No RNG cursor found for d6 sequence ${expected.join(',')}`);
}

function completeStockpile(state: GameState): GameState {
  const playerId = active(state);
  const contributions = Array.from({ length: 6 }, (_, index) =>
    grantItem(state, playerId, `it-school-${(index % 10) + 1}`),
  );
  return act(state, playerId, { type: 'contributeObjective', iids: contributions });
}

/** Passes an actual exile vote and resolves every public relocation choice. */
function exileThroughActions(state: GameState, targetId: PlayerId): GameState {
  state.decks.exiledObjectives.unshift('so-x1');
  const nominatorId = active(state);
  let next = act(state, nominatorId, { type: 'nominateExile', targetPlayerId: targetId });
  for (const voterId of [...next.vote!.electorate]) {
    next = act(next, voterId, { type: 'castVote', vote: true });
  }
  while (pending(next)) {
    const choice = pending(next)!;
    if (choice.kind === 'exileRelocate') {
      const destination = choice.options.find((option) => option.legal)!.id;
      next = choose(next, choice.playerId!, choice.id, [destination]);
    } else if (choice.kind === 'biteResponse') {
      const response = choice.options.find((option) => option.legal)!.id;
      next = choose(next, choice.playerId!, choice.id, [response]);
    } else if (choice.kind === 'lastSurvivorPlacement' || choice.kind === 'exileSwap') {
      const option = choice.options.find((candidate) => candidate.legal)!.id;
      next = choose(next, choice.playerId!, choice.id, [option]);
    } else {
      throw new Error(`exileThroughActions(): unexpected pending choice '${choice.kind}'`);
    }
  }
  return next;
}

describe('§18.2 Stockpile, public contributions, and non-starter requirements', () => {
  it('accepts multiple Stockpile cards in one turn and keeps every contribution face up', () => {
    let state = game();
    const playerId = active(state);
    const starter = grantItem(state, playerId, 'it-st1');
    const contributions = Array.from({ length: 6 }, (_, index) =>
      grantItem(state, playerId, `it-school-${(index % 10) + 1}`),
    );

    const rejected = validateAction(state, playerId, {
      type: 'contributeObjective',
      iids: [starter],
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toMatch(/does not qualify|§8\.3/);

    state = act(state, playerId, { type: 'contributeObjective', iids: contributions });

    expect(state.mainObjective.contributions).toEqual(contributions);
    expect(state.mainObjective.contributionsThisTurn).toBe(6);
    expect(mainObjectiveSatisfied(state)).toBe(true);
    for (const viewerId of [...state.seating, null] as (PlayerId | null)[]) {
      const view = redactStateFor(state, viewerId);
      expect(view.mainObjective.contributions).toEqual(contributions);
      expect(contributions.every((iid) => view.items[iid]?.cardId === state.items[iid]!.cardId)).toBe(
        true,
      );
    }
  });
});

describe('§23 A12 — natural objective timing and failure suppression', () => {
  it('checks Stockpile only after all player endTurn actions enter the colony phase', () => {
    let state = completeStockpile(game());

    expect(state.phase).toBe('playerTurns');
    expect(state.outcome).toBeNull();
    expect(logEvents(state, 'mainObjectiveComplete')).toEqual([]);
    expect(mainObjectiveSatisfied(state)).toBe(true);

    state = finishPlayerTurns(state);

    expect(state.phase).toBe('gameOver');
    expect(state.outcome).toMatchObject({ reason: 'mainObjective', mainObjectiveComplete: true });
    const events = eventSequence(state);
    expect(events.lastIndexOf('colonyPhase')).toBeLessThan(events.lastIndexOf('mainObjectiveComplete'));
  });

  it('uses a public item action to reach morale zero and suppresses the natural objective check', () => {
    let state = game('mo-morale-boundary');
    const playerId = active(state);
    const lossCard = grantItem(state, playerId, 'it-a12-morale-loss');
    expect(mainObjectiveSatisfied(state)).toBe(true);

    state = act(state, playerId, { type: 'playItem', iid: lossCard });

    expect(state.outcome).toMatchObject({ reason: 'morale', mainObjectiveComplete: false });
    expect(logEvents(state, 'mainObjectiveComplete')).toEqual([]);
  });

  it('lets the last round expire naturally after the pre-check, without checking the objective again', () => {
    const state = finishPlayerTurns(game('mo-last-round'));

    expect(state.outcome).toMatchObject({ reason: 'rounds', mainObjectiveComplete: false });
    expect(state.mainObjective.counters).toEqual({});
    expect(logEvents(state, 'mainObjectiveComplete')).toEqual([]);
    expect(logEvents(state, 'roundTracker').at(-1)!.data).toMatchObject({ rounds: 0, survived: 1 });
  });
});

describe('§18.2 We Need More Samples', () => {
  it('uses the introductory morale, round, setup-zombie, and starting-player values', () => {
    const state = game('mo-we-need-more-samples');

    expect({
      morale: state.colony.morale,
      rounds: state.colony.rounds,
      startingPlayers: state.mainObjective.startingPlayerCount,
      counters: state.mainObjective.counters,
    }).toEqual({ morale: 6, rounds: 6, startingPlayers: 4, counters: { samples: 0 } });
    for (const location of NON_COLONY_LOCATIONS) {
      expect(state.locations[location]!.entrance.zombies).toBe(1);
    }
  });

  it('uses twelve real kill paths for three successful samples per starting player', () => {
    let state = game('mo-we-need-more-samples');
    const playerId = active(state);
    const killer = survivorsOfPlayer(state, playerId)[0]!;
    placeSurvivor(state, killer.id, 'school');

    for (let kill = 1; kill <= 12; kill += 1) {
      addZombies(state, 'school', 1);
      setDice(state, playerId, [6]);
      nextRolls(state, [6, 1]); // successful sample, then blank exposure
      state = act(state, playerId, { type: 'attackZombie', survivorId: killer.id, die: 6 });
      if (kill === 11) expect(mainObjectiveSatisfied(state)).toBe(false);
    }

    expect(state.mainObjective.counters.samples).toBe(12);
    expect(mainObjectiveSatisfied(state)).toBe(true);
    const rolls = logEvents(state, 'effectRoll').filter((entry) => entry.data?.['store'] === 'sample');
    expect(rolls).toHaveLength(12);
    expect(eventSequence(state).lastIndexOf('effectRoll')).toBeLessThan(
      eventSequence(state).lastIndexOf('exposure'),
    );
  });

  it('uses the exact 4+ sample boundary on a real kill', () => {
    let state = game('mo-we-need-more-samples');
    const playerId = active(state);
    const killer = survivorsOfPlayer(state, playerId)[0]!;
    placeSurvivor(state, killer.id, 'school');
    addZombies(state, 'school', 1);
    setDice(state, playerId, [6]);
    nextRolls(state, [3, 1]); // 3 is below the erratum's 4+ threshold

    state = act(state, playerId, { type: 'attackZombie', survivorId: killer.id, die: 6 });

    expect(state.mainObjective.counters.samples).toBe(0);
    expect(logEvents(state, 'effectRoll').at(-1)!.data).toMatchObject({ store: 'sample', value: 3 });
    expect(logEvents(state, 'exposure').at(-1)!.data).toMatchObject({ face: 'blank', roll: 1 });

    addZombies(state, 'school', 1);
    setDice(state, playerId, [6]);
    nextRolls(state, [4, 1]); // 4 is the first successful sample face
    state = act(state, playerId, { type: 'attackZombie', survivorId: killer.id, die: 6 });

    expect(state.mainObjective.counters.samples).toBe(1);
    expect(logEvents(state, 'effectRoll').at(-1)!.data).toMatchObject({ store: 'sample', value: 4 });
  });

  it('scales the real-kill threshold from three starting players, not four', () => {
    let state = gameWithPlayers('mo-we-need-more-samples', 3);
    const playerId = active(state);
    const killer = survivorsOfPlayer(state, playerId)[0]!;
    placeSurvivor(state, killer.id, 'school');

    expect(state.mainObjective.startingPlayerCount).toBe(3);
    for (let kill = 1; kill <= 9; kill += 1) {
      addZombies(state, 'school', 1);
      setDice(state, playerId, [6]);
      nextRolls(state, [6, 1]);
      state = act(state, playerId, { type: 'attackZombie', survivorId: killer.id, die: 6 });
      if (kill === 8) expect(mainObjectiveSatisfied(state)).toBe(false);
    }

    expect(state.mainObjective.counters.samples).toBe(9);
    expect(mainObjectiveSatisfied(state)).toBe(true);
  });

  it('runs the mandatory sample check before the exposure roll on a real kill', () => {
    let state = game('mo-we-need-more-samples');
    const playerId = active(state);
    const killer = survivorsOfPlayer(state, playerId)[0]!;
    placeSurvivor(state, killer.id, 'school');
    addZombies(state, 'school', 1);
    setDice(state, playerId, [6]);
    nextRolls(state, [6, 1]);

    state = act(state, playerId, { type: 'attackZombie', survivorId: killer.id, die: 6 });

    expect(state.mainObjective.counters.samples).toBe(1);
    expect(logEvents(state, 'effectRoll').at(-1)!.data).toMatchObject({ store: 'sample', value: 6 });
    expect(logEvents(state, 'exposure').at(-1)!.data).toMatchObject({
      survivorId: killer.id,
      roll: 1,
      face: 'blank',
    });
    expect(eventSequence(state).lastIndexOf('effectRoll')).toBeLessThan(
      eventSequence(state).lastIndexOf('exposure'),
    );
  });
});

describe('§18.2 named objective interpretations', () => {
  it('uses the actual Bev Russell definition for Raiding Party', () => {
    const state = game('mo-raiding-party');
    const bev = contentOf(state).survivors.get('sv-bev-russell');
    expect(bev).toMatchObject({ name: 'Bev Russell', cannotBeKilled: true });

    addSurvivor(state, NOW, active(state), 'sv-bev-russell', 'police-station', false);

    expect(mainObjectiveSatisfied(state)).toBe(true);
    expect(state.phase).toBe('playerTurns');
  });

  it('Hunger evaluates food cards in the public end-game result, not food tokens', () => {
    let state = game('mo-morale-boundary');
    const playerId = active(state);
    state.players[playerId]!.secretObjectiveIds = ['so-hunger'];
    state.players[playerId]!.hand = [];
    state.colony.food = 20;

    expect(secretObjectiveComplete(state, playerId)).toBe(false);

    grantItem(state, playerId, 'it-canned-food');
    grantItem(state, playerId, 'it-canned-food');
    state.colony.food = 0;
    const moraleLoss = grantItem(state, playerId, moraleLossCard.id);
    state = act(state, playerId, { type: 'playItem', iid: moraleLoss });

    expect(state.phase).toBe('gameOver');
    expect(state.outcome).toMatchObject({ reason: 'morale', mainObjectiveComplete: false });
    expect(state.outcome!.winners).toContain(playerId);
    expect(state.outcome!.results.find((result) => result.playerId === playerId)).toMatchObject({
      won: true,
      objectiveComplete: true,
    });
  });

  it('Hoarder requires strictly more cards than every other player', () => {
    const state = game();
    const first = state.seating[0]!;
    const second = state.seating[1]!;
    state.players[first]!.secretObjectiveIds = ['so-n1'];
    state.players[second]!.secretObjectiveIds = ['so-n1'];
    const firstExtra = grantItem(state, first, 'it-st1');
    const secondExtra = grantItem(state, second, 'it-st2');

    expect(secretObjectiveComplete(state, first)).toBe(false);
    expect(secretObjectiveComplete(state, second)).toBe(false);
    state.players[second]!.hand = state.players[second]!.hand.filter((iid) => iid !== secondExtra);
    expect(state.players[first]!.hand).toContain(firstExtra);
    expect(secretObjectiveComplete(state, first)).toBe(true);
  });
});

describe('§16/A13 — natural winners, all-lose, and hidden objectives', () => {
  it('does not end early when a secret objective is already complete', () => {
    let state = game();
    const playerId = active(state);
    state.players[playerId]!.secretObjectiveIds = ['so-n2'];
    expect(secretObjectiveComplete(state, playerId)).toBe(true);

    state = act(state, playerId, { type: 'endTurn' });

    expect(state.phase).toBe('playerTurns');
    expect(state.outcome).toBeNull();
  });

  it('evaluates multiple winners after the main objective ends through normal turns', () => {
    let state = game();
    const first = state.seating[0]!;
    const second = state.seating[1]!;
    const third = state.seating[2]!;
    const fourth = state.seating[3]!;
    state.players[first]!.secretObjectiveIds = ['so-n2'];
    state.players[second]!.secretObjectiveIds = ['so-n2'];
    state.players[third]!.secretObjectiveIds = ['so-n1'];
    state.players[fourth]!.secretObjectiveIds = ['so-n1'];

    state = completeStockpile(state);
    state = finishPlayerTurns(state);

    expect(state.outcome!.winners).toEqual([first, second]);
    expect(state.outcome!.results.filter((result) => result.won).map((result) => result.playerId)).toEqual([
      first,
      second,
    ]);
  });

  it('evaluates an all-lose result after the main objective ends through normal turns', () => {
    let state = game();
    for (const playerId of state.seating) state.players[playerId]!.secretObjectiveIds = ['so-n1'];

    state = completeStockpile(state);
    state = finishPlayerTurns(state);

    expect(state.outcome!.winners).toEqual([]);
    expect(state.outcome!.results.every((result) => !result.won && !result.objectiveComplete)).toBe(
      true,
    );
  });

  it('awards a betrayal winner after natural morale game-over evaluation', () => {
    let state = game('mo-morale-boundary');
    const betrayer = active(state);
    for (const playerId of state.seating) {
      state.players[playerId]!.secretObjectiveIds = playerId === betrayer ? ['so-b1'] : ['so-n1'];
    }
    const lossCard = grantItem(state, betrayer, 'it-a12-morale-loss');

    state = act(state, betrayer, { type: 'playItem', iid: lossCard });

    expect(state.outcome).toMatchObject({ reason: 'morale', winners: [betrayer] });
    expect(state.outcome!.results.find((result) => result.playerId === betrayer)).toMatchObject({
      won: true,
      objectiveComplete: true,
      secretObjectiveIds: ['so-b1'],
    });
  });

  it('awards a player whose original and exiled objectives both complete at natural game end', () => {
    let state = game();
    const nominatorId = active(state);
    const targetId = state.seating.find((id) => id !== nominatorId)!;
    state.players[targetId]!.secretObjectiveIds = ['so-n3'];
    for (const playerId of state.seating) {
      if (playerId !== targetId) state.players[playerId]!.secretObjectiveIds = ['so-n1'];
    }

    nextRolls(state, [1, 1]); // Keep both real relocation exposures blank.
    state = exileThroughActions(state, targetId);
    const exiledObjectiveId = state.players[targetId]!.exiledObjectiveId!;
    expect(exiledObjectiveId).toBe('so-x1');
    expect(secretObjectiveComplete(state, targetId)).toBe(true);

    state = completeStockpile(state);
    state = finishPlayerTurns(state);

    expect(state.outcome).toMatchObject({ reason: 'mainObjective', winners: [targetId] });
    expect(state.outcome!.results.find((result) => result.playerId === targetId)).toMatchObject({
      won: true,
      objectiveComplete: true,
      secretObjectiveIds: ['so-n3'],
      exiledObjectiveId,
    });
  });

  it('redacts an actual exiled objective until natural game end, then reveals it', () => {
    let state = game();
    const nominatorId = active(state);
    const targetId = state.seating.find((id) => id !== nominatorId)!;
    const otherId = state.seating.find((id) => id !== nominatorId && id !== targetId)!;
    state.players[targetId]!.secretObjectiveIds = ['so-n2'];
    state = exileThroughActions(state, targetId);

    const exiledObjectiveId = state.players[targetId]!.exiledObjectiveId!;
    expect(state.players[targetId]!.exiled).toBe(true);
    expect(redactStateFor(state, otherId).players[targetId]!.exiledObjectiveId).toBe('hidden:objective');
    expect(redactStateFor(state, otherId).players[nominatorId]!.secretObjectiveIds.every((id) => id.startsWith('hidden:'))).toBe(
      true,
    );

    state = completeStockpile(state);
    state = finishPlayerTurns(state);

    expect(state.phase).toBe('gameOver');
    expect(redactStateFor(state, otherId).players[targetId]!.exiledObjectiveId).toBe(exiledObjectiveId);
    expect(redactStateFor(state, null).players[targetId]!.exiledObjectiveId).toBe(exiledObjectiveId);
  });
});
