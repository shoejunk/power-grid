/**
 * §23 A11 and the §18.5 item rulings that are not already covered elsewhere.
 *
 * These tests intentionally use the public reducer/effect APIs. Direct state
 * edits only arrange compact board positions; the behavior under test still
 * goes through validation, action application, and the effect driver.
 */

import { Rng } from '@tt/core';
import { describe, expect, it } from 'vitest';

import type { ItemCardDefinition } from '../../content/schema.js';
import type { EngineEffect, GameAction, GameState, PlayerId } from '../../types.js';
import {
  abilityAvailable,
  advance,
  contentOf,
  findAbility,
  pushFrame,
  validateAction,
  zoneOf,
} from '../index.js';
import {
  NOW,
  act,
  addZombies,
  choose,
  extendPack,
  grantItem,
  logEvents,
  pending,
  placeSurvivor,
  setDice,
  start,
  survivorsOfPlayer,
  zombiesAt,
} from './helpers.js';

const outsider: ItemCardDefinition = {
  id: 'it-a11-outsider',
  name: 'A11 Outsider Item',
  text: 'A location-deck item with OUTSIDER text.',
  symbols: ['tool'],
  deck: 'school',
  textKind: 'outsider',
  kind: 'oneShot',
  onPlay: { kind: 'noop' },
  nonCooperative: false,
  matureContent: false,
};

const atomicCard: ItemCardDefinition = {
  id: 'it-a11-atomic-sequence',
  name: 'A11 Atomic Sequence',
  text: 'Resolve the choice, then adjust the colony.',
  symbols: ['tool'],
  deck: 'starter',
  textKind: 'normal',
  kind: 'oneShot',
  onPlay: {
    kind: 'sequence',
    effects: [
      {
        kind: 'choice',
        prompt: 'Resolve the atomic card effect.',
        chooser: { kind: 'effectController' },
        options: [{ id: 'continue', text: 'Continue.', outcome: { kind: 'noop' } }],
      },
      { kind: 'adjustFood', amount: 1 },
      { kind: 'adjustMorale', amount: -1 },
    ],
  },
  nonCooperative: false,
  matureContent: false,
};

const A11_PACK = extendPack('acceptance-a11', { items: [outsider, atomicCard] });

function game(pack = A11_PACK, mainObjectiveId: 'mo-stockpile' | 'mo-we-need-more-samples' = 'mo-stockpile'): GameState {
  const state = start({
    playerCount: 4,
    seed: 'ACCEPTANCE-A11',
    settings: { mainObjectiveId },
    pack,
  });
  if (state.turn) state.turn.crossroadsTriggered = true;
  return state;
}

const active = (state: GameState): PlayerId => state.turn!.playerId;

function rejects(state: GameState, playerId: PlayerId, action: GameAction, rule: RegExp): void {
  const verdict = validateAction(state, playerId, action);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.reason).toMatch(rule);
  expect(() => act(state, playerId, action)).toThrow(rule);
}

/** Positions the authoritative RNG cursor before an exact d6 sequence. */
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

function runEffects(state: GameState, effects: EngineEffect[]): void {
  pushFrame(state, effects);
  advance(state, NOW);
}

describe('§23 A11 — atomic card effects and narrow overrides', () => {
  it('§17 refuses ordinary item play while a real card-play sequence is paused, then completes every step', () => {
    let state = game();
    const playerId = active(state);
    const atomic = grantItem(state, playerId, atomicCard.id);
    const interruptingItem = grantItem(state, playerId, 'it-st1');
    const foodBefore = state.colony.food;
    const moraleBefore = state.colony.morale;

    state = act(state, playerId, { type: 'playItem', iid: atomic });
    expect(pending(state)).toMatchObject({ kind: 'effectOption', playerId });
    expect(state.effectStack.at(-1)!.queue).toHaveLength(2);

    rejects(
      state,
      playerId,
      { type: 'playItem', iid: interruptingItem },
      /decision is still outstanding|effect is still resolving|§5|§8\.1/,
    );

    state = choose(state, playerId, pending(state)!.id, ['continue']);
    expect(state.effectStack).toEqual([]);
    expect(state.colony.food).toBe(foodBefore + 1);
    expect(state.colony.morale).toBe(moraleBefore - 1);
    expect(zoneOf(state, atomic)).toEqual({ kind: 'waste' });
  });

  it('§17/§18.3 rejects standalone Edward White use, then combines one attack with two exposure-free non-attack kills', () => {
    let state = game(A11_PACK, 'mo-stockpile');
    const playerId = active(state);
    const edward = survivorsOfPlayer(state, playerId)[0]!;
    edward.cardId = 'sv-edward-white';
    placeSurvivor(state, edward.id, 'school');
    addZombies(state, 'school', 3);
    const medicine = grantItem(state, playerId, 'it-first-aid');

    setDice(state, playerId, [3]);
    rejects(
      state,
      playerId,
      { type: 'useAbility', survivorId: edward.id, abilityId: 'edward-clear', die: 3 },
      /§18\.3|normal attack|second qualifying die|standalone/i,
    );

    setDice(state, playerId, [3, 3]);
    const exposureBefore = logEvents(state, 'exposure').length;

    state = act(state, playerId, { type: 'attackZombie', survivorId: edward.id, die: 3 });
    expect(zombiesAt(state, 'school')).toBe(2);
    expect(logEvents(state, 'zombieKilled').at(-1)!.data).toMatchObject({
      location: 'school',
      isAttack: true,
    });
    expect(logEvents(state, 'exposure').slice(exposureBefore)).toHaveLength(0);

    state = act(state, playerId, {
      type: 'useAbility',
      survivorId: edward.id,
      abilityId: 'edward-clear',
      die: 3,
    });
    while (pending(state)) {
      const choice = pending(state)!;
      expect(choice.kind).toBe('effectOption');
      expect(choice.options.some((option) => option.id === medicine)).toBe(true);
      state = choose(state, playerId, choice.id, [medicine]);
    }

    expect(zombiesAt(state, 'school')).toBe(0);
    expect(logEvents(state, 'zombieKilled').slice(-3).map((entry) => entry.data)).toEqual([
      expect.objectContaining({ location: 'school', isAttack: true }),
      expect.objectContaining({ location: 'school', isAttack: false }),
      expect.objectContaining({ location: 'school', isAttack: false }),
    ]);
    expect(logEvents(state, 'exposure').slice(exposureBefore)).toHaveLength(0);
    expect(zoneOf(state, medicine)).toEqual({ kind: 'waste' });
  });
});

describe('§18.5 named item rulings', () => {
  it('§18.5 permits duplicate Baseball Bat equips on one survivor', () => {
    let state = game();
    const playerId = active(state);
    const survivor = survivorsOfPlayer(state, playerId)[0]!;
    const first = grantItem(state, playerId, 'it-baseball-bat');
    const second = grantItem(state, playerId, 'it-baseball-bat');

    state = act(state, playerId, { type: 'playItem', iid: first, targetSurvivorId: survivor.id });
    state = act(state, playerId, { type: 'playItem', iid: second, targetSurvivorId: survivor.id });

    expect(state.survivors[survivor.id]!.equipped).toEqual(expect.arrayContaining([first, second]));
    expect(state.survivors[survivor.id]!.equipped).toHaveLength(2);
  });

  it('§18.5 Baseball Bat killing two zombies produces two exposure rolls', () => {
    let state = game();
    const playerId = active(state);
    const survivor = survivorsOfPlayer(state, playerId)[0]!;
    const bat = grantItem(state, playerId, 'it-baseball-bat');
    state = act(state, playerId, { type: 'playItem', iid: bat, targetSurvivorId: survivor.id });
    addZombies(state, 'colony', 2);
    nextRolls(state, [1, 1]);
    const exposureBefore = logEvents(state, 'exposure').length;

    state = act(state, playerId, {
      type: 'useAbility',
      survivorId: survivor.id,
      abilityId: 'bat-swing',
      itemIid: bat,
    });

    expect(zombiesAt(state, 'colony')).toBe(0);
    expect(logEvents(state, 'zombieKilled').slice(-2).every((entry) => entry.data?.['isAttack'] === false)).toBe(true);
    expect(logEvents(state, 'exposure').slice(exposureBefore)).toHaveLength(2);
    expect(state.items[bat]!.usedThisRound).toEqual(['bat-swing']);
  });

  it('§18.5 preserves the EVENT/OUTSIDER item identity across starter and location decks', () => {
    let state = game(A11_PACK);
    const playerId = active(state);
    const event = grantItem(state, playerId, 'it-hostage');
    const outsiderItem = grantItem(state, playerId, outsider.id);
    const content = contentOf(state);

    expect(content.items.get('it-hostage')).toMatchObject({ deck: 'starter', textKind: 'event' });
    expect(content.items.get(outsider.id)).toMatchObject({ deck: 'school', textKind: 'outsider' });
    expect(state.items[event]!.cardId).toBe('it-hostage');
    expect(state.items[outsiderItem]!.cardId).toBe(outsider.id);

    state = act(state, playerId, { type: 'playItem', iid: event });
    state = act(state, playerId, { type: 'playItem', iid: outsiderItem });
    expect(zoneOf(state, event)).toEqual({ kind: 'waste' });
    expect(zoneOf(state, outsiderItem)).toEqual({ kind: 'waste' });
    expect(state.items[outsiderItem]!.cardId).toBe(outsider.id);
  });

  it('§18.5 Megaphone capacity moves only into currently free Attract spaces', () => {
    let state = game();
    const playerId = active(state);
    const survivor = survivorsOfPlayer(state, playerId)[0]!;
    const colonyCapacity = state.colony.entrances.reduce((sum, entrance) => sum + entrance.capacity, 0);
    addZombies(state, 'colony', colonyCapacity - 1);
    addZombies(state, 'school', 2);
    setDice(state, playerId, [1]);

    state = act(state, playerId, {
      type: 'attract',
      survivorId: survivor.id,
      die: 1,
      from: 'school',
      count: 2,
    });

    expect(zombiesAt(state, 'school')).toBe(1);
    expect(zombiesAt(state, 'colony')).toBe(colonyCapacity);
    expect(logEvents(state, 'zombiePlacement')).toEqual([]);
    expect(logEvents(state, 'overrun')).toEqual([]);
  });

  it('§18.5 playing Megaphone into a full destination performs zero movement without an overrun', () => {
    let state = game();
    const playerId = active(state);
    const survivor = survivorsOfPlayer(state, playerId)[0]!;
    const megaphone = grantItem(state, playerId, 'it-megaphone');
    const colonyCapacity = state.colony.entrances.reduce((sum, entrance) => sum + entrance.capacity, 0);
    addZombies(state, 'school', 2);
    for (const entrance of state.colony.entrances) {
      entrance.zombies = entrance.capacity;
      entrance.barricades = 0;
    }

    state = act(state, playerId, {
      type: 'playItem',
      iid: megaphone,
      targetSurvivorId: survivor.id,
    });

    expect(zombiesAt(state, 'school')).toBe(2);
    expect(zombiesAt(state, survivor.location)).toBe(colonyCapacity);
    expect(logEvents(state, 'zombiePlacement')).toEqual([]);
    expect(logEvents(state, 'overrun')).toEqual([]);
    expect(zoneOf(state, megaphone)).toEqual({ kind: 'waste' });
  });
});

describe('§18.5 once-per-round state is attached to the item instance', () => {
  it('survives item ability use, survivor death, hand return, re-equip, and handoff', () => {
    let state = game();
    const playerId = active(state);
    const otherPlayerId = state.seating.find((id) => id !== playerId)!;
    const doomed = survivorsOfPlayer(state, playerId).find((survivor) => !survivor.isLeader)!;
    const reEquippedTo = survivorsOfPlayer(state, playerId).find((survivor) => survivor.id !== doomed.id)!;
    const handedTo = survivorsOfPlayer(state, otherPlayerId)[0]!;
    const bat = grantItem(state, playerId, 'it-baseball-bat');

    state = act(state, playerId, { type: 'playItem', iid: bat, targetSurvivorId: doomed.id });
    state = act(state, playerId, {
      type: 'useAbility',
      survivorId: doomed.id,
      abilityId: 'bat-swing',
      itemIid: bat,
    });
    expect(state.items[bat]!.usedThisRound).toEqual(['bat-swing']);

    runEffects(state, [{ kind: 'i.kill', survivorId: doomed.id, cause: 'effect' }]);
    expect(state.survivors[doomed.id]).toBeUndefined();
    expect(zoneOf(state, bat)).toEqual({ kind: 'hand', playerId });

    state = act(state, playerId, { type: 'playItem', iid: bat, targetSurvivorId: reEquippedTo.id });
    expect(zoneOf(state, bat)).toEqual({ kind: 'equipped', survivorId: reEquippedTo.id });
    const reEquipLookup = findAbility(state, reEquippedTo.id, 'bat-swing', bat);
    expect(reEquipLookup).not.toBeNull();
    expect(abilityAvailable(state, reEquipLookup!).ok).toBe(false);

    state = act(state, playerId, { type: 'handOff', iid: bat, toSurvivorId: handedTo.id });
    expect(pending(state)).toMatchObject({ kind: 'handOffConsent', playerId: otherPlayerId });
    state = choose(state, otherPlayerId, pending(state)!.id, ['accept']);
    expect(zoneOf(state, bat)).toEqual({ kind: 'equipped', survivorId: handedTo.id });
    const handoffLookup = findAbility(state, handedTo.id, 'bat-swing', bat);
    expect(handoffLookup).not.toBeNull();
    expect(abilityAvailable(state, handoffLookup!).ok).toBe(false);
  });
});
