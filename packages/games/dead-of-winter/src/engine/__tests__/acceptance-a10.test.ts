/**
 * §23.10 acceptance criterion and §14 exile.
 *
 * The design document is authoritative.  These tests deliberately drive the
 * public reducer/effect APIs, with direct state edits used only to arrange a
 * compact board position or a deterministic random stream.  Every §14 clause
 * is called out below; the one clause that has no public action representation
 * is an explicit pending FAIL rather than an invented test-only API.
 */

import { Rng } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { COLONY, NON_COLONY_LOCATIONS } from '../../content/primitives.js';
import type { SecretObjectiveDefinition } from '../../content/schema.js';
import type { EngineEffect, GameAction, GameState, PlayerId } from '../../types.js';
import {
  advance,
  freeSurvivorSpaces,
  pushFrame,
  redactStateFor,
  checkTwoExileLoss,
  secretObjectiveComplete,
  validateAction,
  zoneOf,
} from '../index.js';
import {
  NOW,
  act,
  addZombies,
  choose,
  grantItem,
  logEvents,
  pending,
  placeSurvivor,
  setDice,
  extendPack,
  start,
  survivorsOfPlayer,
} from './helpers.js';

const noRevealExile: SecretObjectiveDefinition = {
  id: 'so-x-no-reveal',
  name: 'Cast Out Without a Reveal',
  text: 'Remain outside the walls.',
  kind: 'exiled',
  revealsOriginalObjective: false,
  completion: {
    kind: 'controlsSurvivors',
    player: { kind: 'effectController' },
    atLeast: 1,
  },
  nonCooperative: false,
  matureContent: false,
};

const A10_PACK = extendPack('acceptance-a10', { secretObjectives: [noRevealExile] });

const game = (): GameState => {
  const state = start({
    playerCount: 4,
    seed: 'ACCEPTANCE-A10',
    settings: { mainObjectiveId: 'mo-stockpile' },
    pack: A10_PACK,
  });
  quietTurn(state);
  return state;
};

const active = (state: GameState): PlayerId => state.turn!.playerId;

function quietTurn(state: GameState): void {
  if (state.turn) state.turn.crossroadsTriggered = true;
}

/** Positions the persisted RNG cursor before an exact sequence of d6 rolls. */
function nextRolls(state: GameState, expected: number[]): void {
  for (let cursor = 0; cursor < 100_000; cursor++) {
    const rng = new Rng(state.seed, cursor);
    if (expected.every((value) => rng.die(6) === value)) {
      state.rngCursor = cursor;
      return;
    }
  }
  throw new Error(`No RNG cursor found for d6 sequence ${expected.join(',')}`);
}

function rejects(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  rule: RegExp,
): void {
  const verdict = validateAction(state, playerId, action);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.reason).toMatch(rule);
  expect(() => act(state, playerId, action)).toThrow(rule);
}

/** Passes a real simultaneous exile vote and returns at its relocation choice. */
function passExileVote(
  state: GameState,
  nomineeId: PlayerId,
  exiledObjectiveId = 'so-x1',
): GameState {
  if (state.decks.exiledObjectives[0] !== exiledObjectiveId) {
    state.decks.exiledObjectives.unshift(exiledObjectiveId);
  }
  const nominatorId = active(state);
  if (nominatorId === nomineeId) {
    throw new Error('passExileVote(): nominee must differ from the active nominator');
  }
  let next = act(state, nominatorId, {
    type: 'nominateExile',
    targetPlayerId: nomineeId,
  });
  const electorate = [...next.vote!.electorate];
  for (const voterId of electorate) {
    next = act(next, voterId, { type: 'castVote', vote: true });
  }
  return next;
}

function resolveRelocations(state: GameState, destinations?: string[]): GameState {
  let next = state;
  let i = 0;
  while (pending(next)) {
    const choice = pending(next)!;
    expect(choice.kind).toBe('exileRelocate');
    const destination =
      destinations?.[i] ?? choice.options.find((option) => option.legal)!.id;
    next = choose(next, choice.playerId!, choice.id, [destination]);
    i += 1;
  }
  return next;
}

function runEffects(
  state: GameState,
  effects: EngineEffect[],
  controllerId?: PlayerId,
): void {
  pushFrame(state, effects, controllerId ? { controllerId } : {});
  advance(state, NOW);
}

describe('§14.1 exile vote result, objective attachment, and relocation', () => {
  it('§14.1 passes a real vote, draws and attaches an exiled objective, and reveals a non-betrayer original when required', () => {
    let state = game();
    const nomineeId = state.seating.find((id) => id !== active(state))!;
    const originalObjectiveId = 'so-n2';
    state.players[nomineeId]!.secretObjectiveIds = [originalObjectiveId];
    state.players[nomineeId]!.revealedObjectiveIds = [];
    state.decks.exiledObjectives.unshift('so-x1');
    const deckAfterSetup = [...state.decks.exiledObjectives];

    state = passExileVote(state, nomineeId);

    expect(state.vote).toBeNull();
    expect(state.players[nomineeId]).toMatchObject({
      exiled: true,
      exiledObjectiveId: 'so-x1',
      secretObjectiveIds: [originalObjectiveId],
      revealedObjectiveIds: [originalObjectiveId],
    });
    expect(state.decks.exiledObjectives).toEqual(deckAfterSetup.slice(1));
    expect(pending(state)).toMatchObject({
      kind: 'exileRelocate',
      playerId: nomineeId,
    });
    expect(logEvents(state, 'exiled').at(-1)!.data).toMatchObject({
      playerId: nomineeId,
      exiledObjectiveId: 'so-x1',
    });
    expect(logEvents(state, 'objectiveRevealed').at(-1)!.data).toMatchObject({
      playerId: nomineeId,
      objectiveId: originalObjectiveId,
    });
  });

  it('§14.1 does not reveal a betrayer objective merely because the exiled card requires revelation', () => {
    let state = game();
    const nomineeId = state.seating.find((id) => id !== active(state))!;
    state.players[nomineeId]!.secretObjectiveIds = ['so-b1'];
    state.players[nomineeId]!.revealedObjectiveIds = [];

    state = passExileVote(state, nomineeId, 'so-x1');

    expect(state.players[nomineeId]!.exiledObjectiveId).toBe('so-x1');
    expect(state.players[nomineeId]!.revealedObjectiveIds).toEqual([]);
    expect(logEvents(state, 'objectiveRevealed')).toEqual([]);
  });

  it('§14.1 preserves an exiled objective that does not request revelation and redacts it publicly', () => {
    let state = game();
    const nomineeId = state.seating.find((id) => id !== active(state))!;
    state.players[nomineeId]!.secretObjectiveIds = ['so-n2'];
    state.players[nomineeId]!.revealedObjectiveIds = [];

    state = passExileVote(state, nomineeId, 'so-x-no-reveal');

    expect(state.players[nomineeId]!.exiledObjectiveId).toBe('so-x-no-reveal');
    expect(state.players[nomineeId]!.revealedObjectiveIds).toEqual([]);
    expect(logEvents(state, 'objectiveRevealed')).toEqual([]);
    expect(redactStateFor(state, nomineeId).players[nomineeId]!.exiledObjectiveId).toBe(
      'so-x-no-reveal',
    );
    for (const viewerId of state.seating.filter((id) => id !== nomineeId)) {
      expect(redactStateFor(state, viewerId).players[nomineeId]!.exiledObjectiveId).toBe(
        'hidden:objective',
      );
    }
  });

  it('§14.1 relocates every colony survivor, rolls exposure, and does not spend the move allowance', () => {
    let state = game();
    const nomineeId = state.seating.find((id) => id !== active(state))!;
    const stranded = survivorsOfPlayer(state, nomineeId);
    expect(stranded).toHaveLength(2);
    state.colony.helpless = 2;
    stranded.forEach((survivor) => {
      survivor.movedThisTurn = false;
    });
    nextRolls(state, [4, 1]);

    state = passExileVote(state, nomineeId);
    state = choose(state, nomineeId, pending(state)!.id, ['school']);
    expect(pending(state)).toMatchObject({
      kind: 'exileRelocate',
      playerId: nomineeId,
    });
    state = choose(state, nomineeId, pending(state)!.id, ['library']);

    expect(survivorsOfPlayer(state, nomineeId).map((s) => s.location)).toEqual(
      expect.arrayContaining(['school', 'library']),
    );
    expect(state.colony.helpless).toBe(2);
    expect(survivorsOfPlayer(state, nomineeId).every((s) => !s.movedThisTurn)).toBe(true);
    expect(logEvents(state, 'exposure').slice(-2).map((entry) => entry.data)).toEqual([
      expect.objectContaining({ face: 'wound' }),
      expect.objectContaining({ face: 'blank' }),
    ]);
    expect(logEvents(state, 'exileRelocationComplete').at(-1)!.data).toMatchObject({
      playerId: nomineeId,
    });
  });

  it('§14.1 swaps into a vacated outside space when all outside spaces are full, with no exposure or move cost', () => {
    let state = game();
    const nomineeId = state.seating.find((id) => id !== active(state))!;
    const nomineeSurvivors = survivorsOfPlayer(state, nomineeId);
    const exiledSurvivor = nomineeSurvivors[0]!;
    state.players[nomineeId]!.leaderSurvivorId = exiledSurvivor.id;
    exiledSurvivor.isLeader = true;
    exiledSurvivor.movedThisTurn = false;
    nomineeSurvivors[1]!.movedThisTurn = false;

    const normalSurvivors = Object.values(state.survivors).filter(
      (survivor) => survivor.controllerId !== nomineeId,
    );
    expect(normalSurvivors.length).toBeGreaterThanOrEqual(NON_COLONY_LOCATIONS.length);
    NON_COLONY_LOCATIONS.forEach((location, index) => {
      state.locations[location]!.survivorCapacity = 1;
      placeSurvivor(state, normalSurvivors[index]!.id, location);
      normalSurvivors[index]!.movedThisTurn = false;
    });
    expect(NON_COLONY_LOCATIONS.every((location) => freeSurvivorSpaces(state, location) === 0)).toBe(
      true,
    );
    expect(freeSurvivorSpaces(state, COLONY)).toBeGreaterThan(0);
    const exposureBefore = logEvents(state, 'exposure').length;

    state = passExileVote(state, nomineeId);

    const swapChoice = pending(state)!;
    expect(swapChoice.kind).toBe('exileSwap');
    const recalledId = swapChoice.options[0]!.id;
    const recalled = state.survivors[recalledId]!;
    const vacated = recalled.location;
    state = choose(state, nomineeId, swapChoice.id, [recalledId]);

    expect(state.survivors[exiledSurvivor.id]!.location).toBe(vacated);
    expect(state.survivors[recalledId]!.location).toBe(COLONY);
    expect(state.survivors[exiledSurvivor.id]!.movedThisTurn).toBe(false);
    expect(state.survivors[recalledId]!.movedThisTurn).toBe(false);
    expect(pending(state)).toMatchObject({ kind: 'exileSwap', playerId: nomineeId });
    const secondSwap = pending(state)!;
    const secondRecalledId = secondSwap.options.find((option) => option.id !== recalledId)!.id;
    const secondVacated = state.survivors[secondRecalledId]!.location;
    state = choose(state, nomineeId, secondSwap.id, [secondRecalledId]);
    expect(state.survivors[nomineeSurvivors[1]!.id]!.location).toBe(secondVacated);
    expect(state.survivors[secondRecalledId]!.location).toBe(COLONY);
    expect(state.survivors[nomineeSurvivors[1]!.id]!.movedThisTurn).toBe(false);
    expect(state.survivors[secondRecalledId]!.movedThisTurn).toBe(false);
    expect(logEvents(state, 'exposure')).toHaveLength(exposureBefore);
    expect(logEvents(state, 'exileSwap')[0]!.data).toMatchObject({
      exiledSurvivorId: exiledSurvivor.id,
      recalledSurvivorId: recalledId,
      location: vacated,
    });
    expect(logEvents(state, 'exileSwap').at(-1)!.data).toMatchObject({
      exiledSurvivorId: nomineeSurvivors[1]!.id,
      recalledSurvivorId: secondRecalledId,
      location: secondVacated,
    });
    expect(pending(state)).toBeUndefined();
  });

  it('§14.1 adjusts the secret-objective test by requiring the attached exiled objective in addition to the original', () => {
    let state = game();
    const nomineeId = state.seating.find((id) => id !== active(state))!;
    state.players[nomineeId]!.secretObjectiveIds = ['so-n2'];
    nextRolls(state, [1, 1]);

    state = passExileVote(state, nomineeId, 'so-x1');
    state = resolveRelocations(state);

    expect(state.players[nomineeId]!.secretObjectiveIds).toEqual(['so-n2']);
    expect(state.players[nomineeId]!.exiledObjectiveId).toBe('so-x1');
    expect(survivorsOfPlayer(state, nomineeId)).toHaveLength(2);
    expect(secretObjectiveComplete(state, nomineeId)).toBe(true);

    // The exiled objective is satisfied by one survivor, but the retained
    // original `so-n2` requires two; attachment therefore is not replacement.
    delete state.survivors[survivorsOfPlayer(state, nomineeId)[0]!.id];
    expect(survivorsOfPlayer(state, nomineeId)).toHaveLength(1);
    expect(secretObjectiveComplete(state, nomineeId)).toBe(false);
  });
});

describe('§14.2 prohibitions and card/morale consequences', () => {
  it('§14.2 blocks colony food tokens, crisis cards, colony moves, votes, and helpless additions for an exiled player', () => {
    let state = game();
    const exiledId = active(state);
    const targetId = state.seating.find((id) => id !== exiledId)!;
    state.players[exiledId]!.exiled = true;
    for (const survivor of survivorsOfPlayer(state, exiledId)) placeSurvivor(state, survivor.id, 'school');

    state.colony.food = 3;
    setDice(state, exiledId, [2]);
    rejects(state, exiledId, { type: 'spendFood', die: 2, count: 1 }, /§14\.2/);

    const crisisCard = grantItem(state, exiledId, 'it-st1');
    expect(state.crisis.cardId).toBeTruthy();
    rejects(state, exiledId, { type: 'contributeCrisis', iids: [crisisCard] }, /§14\.2/);

    const survivor = survivorsOfPlayer(state, exiledId)[0]!;
    rejects(state, exiledId, { type: 'moveSurvivor', survivorId: survivor.id, to: COLONY }, /§14\.2/);
    expect(validateAction(state, exiledId, { type: 'moveSurvivor', survivorId: survivor.id, to: 'library' }).ok).toBe(
      true,
    );

    state = act(state, exiledId, { type: 'nominateExile', targetPlayerId: targetId });
    expect(state.vote!.electorate).not.toContain(exiledId);
    rejects(state, exiledId, { type: 'castVote', vote: true }, /§14\.2/);

    // The effect is legal for a non-exiled controller, but is ignored for the
    // exiled controller as required by §14.2.
    const helplessBefore = state.colony.helpless;
    state.vote = null;
    state.pendingChoices = [];
    runEffects(state, [{ kind: 'addHelpless', count: 1 }], exiledId);
    expect(state.colony.helpless).toBe(helplessBefore);
    runEffects(state, [{ kind: 'addHelpless', count: 1 }], targetId);
    expect(state.colony.helpless).toBe(helplessBefore + 1);
  });

  it('§14.2 removes a normally played food card from the game', () => {
    let state = game();
    const exiledId = active(state);
    state.players[exiledId]!.exiled = true;
    const foodBefore = state.colony.food;
    const foodCard = grantItem(state, exiledId, 'it-canned-food');
    const wasteBefore = [...state.colony.waste];

    state = act(state, exiledId, { type: 'playItem', iid: foodCard });

    expect(state.colony.food).toBe(foodBefore + 2);
    expect(zoneOf(state, foodCard)).toEqual({ kind: 'removedFromGame' });
    expect(state.colony.waste).toEqual(wasteBefore);
  });

  it('§14.2 lets an exiled player remove a food card to raise one unused die by one', () => {
    let state = game();
    const exiledId = active(state);
    state.players[exiledId]!.exiled = true;
    const foodCard = grantItem(state, exiledId, 'it-canned-food');
    setDice(state, exiledId, [3, 6]);
    const foodBefore = state.colony.food;
    const wasteBefore = [...state.colony.waste];

    state = act(state, exiledId, { type: 'playFoodForDie', iid: foodCard, die: 3 });

    expect(state.players[exiledId]!.unusedDice).toEqual([4, 6]);
    expect(state.colony.food).toBe(foodBefore);
    expect(state.colony.waste).toEqual(wasteBefore);
    expect(zoneOf(state, foodCard)).toEqual({ kind: 'removedFromGame' });
    expect(logEvents(state, 'foodCardForDie').at(-1)!.data).toMatchObject({
      iid: foodCard,
      die: 4,
    });

    const cappedFood = grantItem(state, exiledId, 'it-canned-food');
    setDice(state, exiledId, [6]);
    rejects(state, exiledId, { type: 'playFoodForDie', iid: cappedFood, die: 6 }, /above six/);
    setDice(state, exiledId, [2]);
    rejects(state, exiledId, { type: 'playFoodForDie', iid: cappedFood, die: 3 }, /no such unused die/);
    const nonFood = grantItem(state, exiledId, 'it-hostage');
    setDice(state, exiledId, [3]);
    rejects(state, exiledId, { type: 'playFoodForDie', iid: nonFood, die: 3 }, /Only a food card/);
    const otherId = state.seating.find((id) => id !== exiledId)!;
    const otherFood = grantItem(state, otherId, 'it-canned-food');
    rejects(state, exiledId, { type: 'playFoodForDie', iid: otherFood, die: 2 }, /not in your hand/);

    state.players[exiledId]!.exiled = false;
    const nonExiledFood = grantItem(state, exiledId, 'it-canned-food');
    rejects(
      state,
      exiledId,
      { type: 'playFoodForDie', iid: nonExiledFood, die: 3 },
      /Only an exiled player/,
    );
  });

  it('§14.2 does not reduce morale when an exiled survivor dies', () => {
    let state = game();
    const exiledId = active(state);
    state.players[exiledId]!.exiled = true;
    const victim = survivorsOfPlayer(state, exiledId)[0]!;
    placeSurvivor(state, victim.id, 'school');
    addZombies(state, 'school', 1);
    setDice(state, exiledId, [6]);
    nextRolls(state, [6]);
    const moraleBefore = state.colony.morale;

    state = act(state, exiledId, { type: 'attackZombie', survivorId: victim.id, die: 6 });

    expect(state.survivors[victim.id]).toBeUndefined();
    expect(logEvents(state, 'survivorDied').at(-1)!.data).toMatchObject({
      survivorId: victim.id,
      cause: 'bite',
    });
    expect(state.colony.morale).toBe(moraleBefore);
  });
});

describe('§14.2 allowed exiled interactions', () => {
  it('§14.2 lets an exiled player initiate a vote, request a card without co-location, and receive the requested card as an immediate play', () => {
    let state = game();
    const exiledId = active(state);
    const donorId = state.seating.find((id) => id !== exiledId)!;
    state.players[exiledId]!.exiled = true;
    placeSurvivor(state, survivorsOfPlayer(state, exiledId)[0]!.id, 'school');
    placeSurvivor(state, survivorsOfPlayer(state, donorId)[0]!.id, 'library');
    const requested = grantItem(state, donorId, 'it-st1');

    expect(validateAction(state, exiledId, { type: 'nominateExile', targetPlayerId: donorId }).ok).toBe(true);
    state = act(state, exiledId, { type: 'nominateExile', targetPlayerId: donorId });
    state.vote = null;
    state.pendingChoices = [];

    expect(validateAction(state, exiledId, { type: 'requestCards', fromPlayerId: donorId }).ok).toBe(true);
    state = act(state, exiledId, { type: 'requestCards', fromPlayerId: donorId });
    expect(pending(state)).toMatchObject({
      kind: 'requestResponse',
      playerId: donorId,
      private: true,
    });
    state = choose(state, donorId, pending(state)!.id, [requested]);

    expect(state.players[donorId]!.hand).not.toContain(requested);
    expect(state.request).toBeNull();
    expect(zoneOf(state, requested)).toEqual({ kind: 'removedFromGame' });
    expect(logEvents(state, 'requestGranted').at(-1)!.data).toMatchObject({
      requesterId: exiledId,
      targetId: donorId,
      iid: requested,
    });
  });

  it('§14.2 permits a hand-off from an exiled survivor to a non-exiled survivor at the same non-colony location', () => {
    let state = game();
    const exiledId = active(state);
    const receiverId = state.seating.find((id) => id !== exiledId)!;
    state.players[exiledId]!.exiled = true;
    const giver = survivorsOfPlayer(state, exiledId)[0]!;
    const receiver = survivorsOfPlayer(state, receiverId)[0]!;
    placeSurvivor(state, giver.id, 'school');
    placeSurvivor(state, receiver.id, 'school');
    const item = grantItem(state, exiledId, 'it-baseball-bat');

    state = act(state, exiledId, {
      type: 'playItem',
      iid: item,
      targetSurvivorId: giver.id,
    });
    expect(state.survivors[giver.id]!.equipped).toContain(item);
    expect(validateAction(state, exiledId, { type: 'handOff', iid: item, toSurvivorId: receiver.id }).ok).toBe(
      true,
    );
    state = act(state, exiledId, {
      type: 'handOff',
      iid: item,
      toSurvivorId: receiver.id,
    });
    expect(pending(state)).toMatchObject({ kind: 'handOffConsent', playerId: receiverId });
    state = choose(state, receiverId, pending(state)!.id, ['accept']);

    expect(state.survivors[giver.id]!.equipped).not.toContain(item);
    expect(state.survivors[receiver.id]!.equipped).toContain(item);
    expect(zoneOf(state, item)).toEqual({ kind: 'equipped', survivorId: receiver.id });
  });

  it('§14.2 permits a non-exiled survivor to hand an item to an exiled survivor with consent', () => {
    let state = game();
    const giverId = active(state);
    const exiledId = state.seating.find((id) => id !== giverId)!;
    state.players[exiledId]!.exiled = true;
    const giver = survivorsOfPlayer(state, giverId)[0]!;
    const receiver = survivorsOfPlayer(state, exiledId)[0]!;
    placeSurvivor(state, giver.id, 'school');
    placeSurvivor(state, receiver.id, 'school');
    const item = grantItem(state, giverId, 'it-baseball-bat');

    state = act(state, giverId, { type: 'playItem', iid: item, targetSurvivorId: giver.id });
    state = act(state, giverId, { type: 'handOff', iid: item, toSurvivorId: receiver.id });
    expect(pending(state)).toMatchObject({ kind: 'handOffConsent', playerId: exiledId });
    state = choose(state, exiledId, pending(state)!.id, ['accept']);

    expect(state.survivors[giver.id]!.equipped).not.toContain(item);
    expect(state.survivors[receiver.id]!.equipped).toContain(item);
    expect(zoneOf(state, item)).toEqual({ kind: 'equipped', survivorId: receiver.id });
  });

  it('§14.2 permits an exiled player to add an eligible card face up to the main objective', () => {
    let state = game();
    const exiledId = active(state);
    state.players[exiledId]!.exiled = true;
    const contribution = grantItem(state, exiledId, 'it-school-2');

    expect(validateAction(state, exiledId, { type: 'contributeObjective', iids: [contribution] }).ok).toBe(true);
    state = act(state, exiledId, { type: 'contributeObjective', iids: [contribution] });

    expect(state.mainObjective.contributions).toEqual([contribution]);
    expect(zoneOf(state, contribution)).toEqual({ kind: 'objective' });
    for (const viewerId of [...state.seating, null] as (PlayerId | null)[]) {
      expect(redactStateFor(state, viewerId).mainObjective.contributions).toEqual([contribution]);
    }
  });

  it('§13/§14.2 places a newly added survivor for an exiled player at a chosen non-colony location without granting a mid-round die', () => {
    let state = game();
    const exiledId = active(state);
    state.players[exiledId]!.exiled = true;
    const diceBefore = [...state.players[exiledId]!.unusedDice];
    const known = new Set(survivorsOfPlayer(state, exiledId).map((survivor) => survivor.id));
    state.decks.survivors = ['sv-f24', ...state.decks.survivors];

    runEffects(
      state,
      [{ kind: 'addSurvivor', to: { kind: 'ref', id: exiledId }, count: 1 }],
      exiledId,
    );

    expect(pending(state)).toMatchObject({
      kind: 'lastSurvivorPlacement',
      playerId: exiledId,
      private: true,
    });
    expect(pending(state)!.options.map((option) => option.id)).not.toContain(COLONY);
    const choice = pending(state)!;
    state = choose(state, exiledId, choice.id, ['school']);
    const added = survivorsOfPlayer(state, exiledId).find((survivor) => !known.has(survivor.id))!;

    expect(added.location).toBe('school');
    expect(added.location).not.toBe(COLONY);
    expect(added.movedThisTurn).toBe(false);
    expect(state.players[exiledId]!.unusedDice).toEqual(diceBefore);
  });
});

describe('§14.2 immediate two-loyal-exiles loss', () => {
  it('ends immediately when two exiled players have no betrayal objective, using hidden authoritative objectives', () => {
    let state = game();
    const firstNominatorId = active(state);
    const firstNominee = state.seating.find((id) => id !== firstNominatorId)!;
    // Keep the endgame result itself an all-lose result: equal hands do not
    // satisfy Hoarder, while the two exiled players still remain loyal.
    for (const playerId of state.seating) state.players[playerId]!.secretObjectiveIds = ['so-n1'];
    state.decks.exiledObjectives = ['so-x1', 'so-x2'];
    nextRolls(state, [1, 1]);

    state = passExileVote(state, firstNominee, 'so-x1');
    state = resolveRelocations(state);
    expect(state.phase).toBe('playerTurns');
    expect(state.players[firstNominee]!.exiled).toBe(true);

    // End the first nominator's turn through the reducer. The next active
    // player is therefore a genuinely fresh nominator, not a test-only reset
    // of §8.8's once-per-turn flag.
    state = act(state, firstNominatorId, { type: 'endTurn' });
    quietTurn(state);
    const secondNominatorId = active(state);
    const secondNominee = state.seating.find(
      (id) => id !== secondNominatorId && id !== firstNominee,
    )!;
    state = passExileVote(state, secondNominee, 'so-x2');

    expect(state.players[secondNominee]!.exiled).toBe(true);
    expect(state.colony.morale).toBe(0);
    expect(state.phase).toBe('gameOver');
    expect(state.pendingChoices).toEqual([]);
    expect(state.effectStack).toEqual([]);
    expect(state.outcome).toMatchObject({
      reason: 'twoNonBetrayerExiles',
      winners: [],
    });
    expect(logEvents(state, 'twoNonBetrayerExiles').at(-1)!.data).toMatchObject({
      event: 'twoNonBetrayerExiles',
    });
  });

  it('does not apply the two-loyal-exiles loss when one exiled player is a betrayer', () => {
    const state = game();
    const [firstExile, secondExile] = state.seating.slice(0, 2);
    state.players[firstExile]!.exiled = true;
    state.players[secondExile]!.exiled = true;
    state.players[firstExile]!.secretObjectiveIds = ['so-n2'];
    state.players[secondExile]!.secretObjectiveIds = ['so-b1'];
    const moraleBefore = state.colony.morale;

    expect(checkTwoExileLoss(state, NOW)).toBe(false);
    expect(state.phase).not.toBe('gameOver');
    expect(state.colony.morale).toBe(moraleBefore);
    expect(logEvents(state, 'twoNonBetrayerExiles')).toEqual([]);
  });
});
