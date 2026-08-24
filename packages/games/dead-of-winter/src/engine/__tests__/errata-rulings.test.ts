/**
 * A14 — the named §18 errata and card rulings which are not already directly
 * covered by the A5–A10 acceptance suites.
 *
 * These tests intentionally stop at the reducer boundary. Direct state edits
 * only arrange a compact board position or a deterministic random stream; the
 * behavior under test is driven through the public engine action/effect APIs.
 */

import { Rng } from '@tt/core';
import { describe, expect, it } from 'vitest';

import type {
  CrossroadsCardDefinition,
  ItemCardDefinition,
  MainObjectiveDefinition,
  SecretObjectiveDefinition,
} from '../../content/schema.js';
import { COLONY } from '../../content/primitives.js';
import type { GameState, PlayerId, SurvivorInstance } from '../../types.js';
import {
  advance,
  contentOf,
  killSurvivor,
  mainObjectiveSatisfied,
  placeSurvivor as spawnSurvivor,
  resolveOverrun,
  runColonyStep,
  secretObjectiveComplete,
  validateAction,
  zoneOf,
} from '../index.js';
import {
  NOW,
  act,
  addZombies,
  answerFirstLegal,
  choose,
  eventSequence,
  extendPack,
  grantItem,
  logEvents,
  pending,
  placeSurvivor,
  setDice,
  start,
  survivorsAt,
  survivorsOfPlayer,
  zombiesAt,
} from './helpers.js';

const active = (state: GameState): PlayerId => state.turn!.playerId;

function muteCrossroads(state: GameState): void {
  if (state.turn) state.turn.crossroadsTriggered = true;
}

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

function finishPlayerTurns(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 500 && current.phase === 'playerTurns'; guard++) {
    if (pending(current)) {
      current = answerFirstLegal(current);
      continue;
    }
    const playerId = current.turn!.playerId;
    muteCrossroads(current);
    current = act(current, playerId, { type: 'endTurn' });
  }
  return current;
}

const outsiderCard: ItemCardDefinition = {
  id: 'it-a14-outsider',
  name: 'A14 Outsider Card',
  text: 'A named outsider item.',
  symbols: ['tool'],
  deck: 'school',
  textKind: 'outsider',
  kind: 'oneShot',
  onPlay: { kind: 'noop' },
  nonCooperative: false,
  matureContent: false,
};

const hungerObjective: SecretObjectiveDefinition = {
  id: 'so-a14-hunger',
  name: 'Hunger',
  text: 'End with a food card.',
  kind: 'nonBetrayal',
  completion: {
    kind: 'holdsCards',
    player: { kind: 'effectController' },
    requirement: { symbols: ['food'] },
    atLeast: 1,
  },
  nonCooperative: false,
  matureContent: false,
};

const raidingPartyObjective: MainObjectiveDefinition = {
  id: 'mo-raiding-party',
  name: 'Raiding Party',
  standard: {
    text: 'Resolve the applicable Bev Russell option.',
    startingMorale: 10,
    startingRounds: 8,
    setup: [],
    counters: [{ id: 'bevRussellOptions', label: 'Bev Russell options', start: 0 }],
    completion: { kind: 'counter', counter: 'bevRussellOptions', atLeast: 1 },
  },
  hardcore: {
    text: 'Resolve the applicable Bev Russell option.',
    startingMorale: 8,
    startingRounds: 7,
    setup: [],
    counters: [{ id: 'bevRussellOptions', label: 'Bev Russell options', start: 0 }],
    completion: { kind: 'counter', counter: 'bevRussellOptions', atLeast: 1 },
  },
};

const bevRussellRaidingCard: CrossroadsCardDefinition = {
  id: 'xr-a14-bev-russell',
  name: 'Bev Russell',
  story: 'Bev points toward the raiding party.',
  trigger: { event: 'moveCompleted', destination: 'any' },
  options: [
    {
      id: 'raiding-party',
      text: 'Join the raiding party.',
      outcome: { kind: 'adjustCounter', counter: 'bevRussellOptions', amount: 1 },
    },
  ],
  matureContent: false,
  nonCooperative: false,
};

const A14_PACK = extendPack('errata-rulings', {
  crossroads: [bevRussellRaidingCard],
  items: [outsiderCard],
  mainObjectives: [raidingPartyObjective],
  secretObjectives: [hungerObjective],
});

describe('A14 §18.1 — remaining errata', () => {
  it('§18.1 Attract legally moves fewer than two zombies, including zero', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const survivor = survivorsOfPlayer(state, playerId)[0]!;
    addZombies(state, 'school', 1);
    setDice(state, playerId, [1, 1]);
    muteCrossroads(state);

    expect(
      validateAction(state, playerId, {
        type: 'attract',
        survivorId: survivor.id,
        die: 1,
        from: 'school',
        count: 0,
      }),
    ).toMatchObject({ ok: true });
    state = act(state, playerId, {
      type: 'attract',
      survivorId: survivor.id,
      die: 1,
      from: 'school',
      count: 0,
    });
    expect(zombiesAt(state, 'school')).toBe(1);

    state = act(state, playerId, {
      type: 'attract',
      survivorId: survivor.id,
      die: 1,
      from: 'school',
      count: 2,
    });
    expect(zombiesAt(state, 'school')).toBe(0);
    expect(zombiesAt(state, COLONY)).toBe(1);
    expect(logEvents(state, 'attract').at(-1)?.data).toMatchObject({ count: 1 });
  });
});

describe('A14 §18.2 — objectives and named objective semantics', () => {
  it('§18.2 Stockpile accepts multiple non-starter contributions during one turn', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    muteCrossroads(state);
    const first = grantItem(state, playerId, 'it-school-2');
    const second = grantItem(state, playerId, 'it-school-3');
    const starter = grantItem(state, playerId, 'it-st1');

    expect(validateAction(state, playerId, { type: 'contributeObjective', iids: [starter] })).toMatchObject({
      ok: false,
    });

    state = act(state, playerId, { type: 'contributeObjective', iids: [first] });
    state = act(state, playerId, { type: 'contributeObjective', iids: [second] });

    expect(state.mainObjective.contributions).toEqual([first, second]);
    expect(state.turn?.events.filter((event) => event.event === 'actionPerformed')).toHaveLength(2);
  });

  it('§18.2 introductory We Need More Samples starts at morale 6, six rounds, and three samples per starting player', () => {
    let state = start({
      playerCount: 4,
      settings: { mainObjectiveId: 'mo-we-need-more-samples' },
    });
    const side = contentOf(state).mainObjectives.get('mo-we-need-more-samples')!.standard;

    expect({ morale: state.colony.morale, rounds: state.colony.rounds }).toEqual({ morale: 6, rounds: 6 });
    expect(side.completion).toEqual({ kind: 'counterPerStartingPlayer', counter: 'samples', atLeast: 3 });
    expect(state.mainObjective.startingPlayerCount).toBe(4);
  });

  it('§18.2 main-objective completion waits for the colony-phase check', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    muteCrossroads(state);
    const cards = Array.from({ length: 6 }, () => grantItem(state, playerId, 'it-school-2'));
    state = act(state, playerId, { type: 'contributeObjective', iids: cards });

    expect(state.phase).toBe('playerTurns');
    expect(logEvents(state, 'mainObjectiveComplete')).toEqual([]);

    state = finishPlayerTurns(state);
    expect(state.phase).toBe('gameOver');
    expect(logEvents(state, 'mainObjectiveComplete')).toHaveLength(1);
    expect(eventSequence(state).lastIndexOf('mainObjectiveComplete')).toBeGreaterThan(
      eventSequence(state).lastIndexOf('objectiveContribution'),
    );
  });

  it('§18.2 Hunger counts food cards, not colony food tokens', () => {
    let state = start({
      pack: A14_PACK,
      playerCount: 4,
      settings: { mainObjectiveId: 'mo-stockpile' },
    });
    const playerId = active(state);
    state.players[playerId]!.secretObjectiveIds = [hungerObjective.id];
    state.colony.food = 10;

    state.players[playerId]!.hand = state.players[playerId]!.hand.filter(
      (iid) => !contentOf(state).items.get(state.items[iid]!.cardId)!.symbols.includes('food'),
    );
    expect(secretObjectiveComplete(state, playerId)).toBe(false);
    const foodCard = grantItem(state, playerId, 'it-canned-food');
    expect(state.players[playerId]!.hand).toContain(foodCard);
    expect(secretObjectiveComplete(state, playerId)).toBe(true);
  });

  it('§18.2 Hoarder requires strictly more cards than every other player', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    state.players[playerId]!.secretObjectiveIds = ['so-n1'];

    expect(secretObjectiveComplete(state, playerId)).toBe(false);
    grantItem(state, playerId, 'it-school-2');
    expect(secretObjectiveComplete(state, playerId)).toBe(true);
  });

  it('§18.2 Raiding Party counts the applicable Bev Russell option toward its objective', () => {
    let state = start({
      pack: A14_PACK,
      playerCount: 4,
      settings: { mainObjectiveId: raidingPartyObjective.id },
    });
    const playerId = active(state);
    const mover = survivorsOfPlayer(state, playerId)[0]!;
    state.turn!.crossroadsCardId = bevRussellRaidingCard.id;
    state.turn!.crossroadsTriggered = false;
    state.turn!.events = [];
    state.decks.crossroads = state.decks.crossroads.filter((id) => id !== bevRussellRaidingCard.id);
    muteCrossroads(state);
    state.turn!.crossroadsTriggered = false;
    nextRolls(state, [1]);

    expect(mainObjectiveSatisfied(state)).toBe(false);
    state = act(state, playerId, { type: 'moveSurvivor', survivorId: mover.id, to: 'school' });
    expect(pending(state)).toMatchObject({
      kind: 'effectOption',
      options: [{ id: 'raiding-party', legal: true }],
    });

    state = choose(state, playerId, pending(state)!.id, ['raiding-party']);
    expect(state.mainObjective.counters).toMatchObject({ bevRussellOptions: 1 });
    expect(mainObjectiveSatisfied(state)).toBe(true);
  });
});

describe('A14 §18.3 — survivors', () => {
  it('§18.3 Edward White uses a normal attack plus a second die and medicine to kill two extra zombies without exposure', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const edward = spawnSurvivor(state, NOW, playerId, 'sv-edward-white', 'school', false);
    addZombies(state, 'school', 3);
    const medicine = grantItem(state, playerId, 'it-first-aid');
    setDice(state, playerId, [3, 4]);
    nextRolls(state, [1]);
    muteCrossroads(state);

    state = act(state, playerId, { type: 'attackZombie', survivorId: edward.id, die: 3 });
    state = act(state, playerId, {
      type: 'useAbility',
      survivorId: edward.id,
      abilityId: 'edward-clear',
      die: 4,
    });
    if (pending(state)) {
      state = choose(state, playerId, pending(state)!.id, [medicine]);
    }

    expect(zombiesAt(state, 'school')).toBe(0);
    expect(logEvents(state, 'exposure')).toEqual([]);
    expect(logEvents(state, 'ability').at(-1)?.data).toMatchObject({ survivorId: edward.id });
  });

  it('§18.3 Edward White cannot use the two-zombie ability as a standalone no-attack action', () => {
    const state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const edward = spawnSurvivor(state, NOW, playerId, 'sv-edward-white', 'school', false);
    addZombies(state, 'school', 2);
    grantItem(state, playerId, 'it-first-aid');
    setDice(state, playerId, [4]);
    muteCrossroads(state);

    expect(
      validateAction(state, playerId, {
        type: 'useAbility',
        survivorId: edward.id,
        abilityId: 'edward-clear',
        die: 4,
      }),
    ).toMatchObject({ ok: false });
  });

  it('§18.3 John Price gains abilities only after a completed non-colony move and loses them after moving away', () => {
    type John = SurvivorInstance & { copiedAbilityIds?: string[] };
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const john = spawnSurvivor(state, NOW, playerId, 'sv-john-price', COLONY, false);
    spawnSurvivor(state, NOW, playerId, 'sv-buddy-davis', 'school', false);
    muteCrossroads(state);
    expect((john as John).copiedAbilityIds ?? []).toEqual([]);

    nextRolls(state, [1]);
    state = act(state, playerId, { type: 'moveSurvivor', survivorId: john.id, to: 'school' });
    expect((state.survivors[john.id] as John).copiedAbilityIds ?? []).toContain('buddy-heal');

    state.survivors[john.id]!.movedThisTurn = false;
    nextRolls(state, [1]);
    state = act(state, playerId, { type: 'moveSurvivor', survivorId: john.id, to: COLONY });
    expect((state.survivors[john.id] as John).copiedAbilityIds).toEqual([]);
  });

  it('§18.3 John Price may combine multiple abilities present at his location', () => {
    type John = SurvivorInstance & { copiedAbilityIds?: string[] };
    const state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const john = spawnSurvivor(state, NOW, playerId, 'sv-john-price', 'school', false);
    spawnSurvivor(state, NOW, playerId, 'sv-buddy-davis', 'school', false);
    spawnSurvivor(state, NOW, playerId, 'sv-forest-plum', 'school', false);
    advance(state, NOW);

    expect((john as John).copiedAbilityIds).toEqual(expect.arrayContaining(['buddy-heal', 'forest-sacrifice']));
  });

  it('§18.3 John Price may copy a once-per-round ability even after its original was used, but only once himself', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const john = spawnSurvivor(state, NOW, playerId, 'sv-john-price', 'school', false);
    const buddy = spawnSurvivor(state, NOW, playerId, 'sv-buddy-davis', 'school', false);
    advance(state, NOW);
    type John = SurvivorInstance & { copiedAbilityIds?: string[] };
    expect((state.survivors[john.id] as John).copiedAbilityIds ?? []).toContain('buddy-heal');
    buddy.usedThisRound.push('buddy-heal');
    muteCrossroads(state);

    expect(validateAction(state, playerId, {
      type: 'useAbility',
      survivorId: john.id,
      abilityId: 'buddy-heal',
    })).toMatchObject({ ok: true });
    state = act(state, playerId, {
      type: 'useAbility',
      survivorId: john.id,
      abilityId: 'buddy-heal',
    });
    while (pending(state)) state = answerFirstLegal(state);
    expect(validateAction(state, playerId, {
      type: 'useAbility',
      survivorId: john.id,
      abilityId: 'buddy-heal',
    })).toMatchObject({ ok: false });
  });

  it('§18.3 John Price copying Forest Plum treats John as the named survivor', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const john = spawnSurvivor(state, NOW, playerId, 'sv-john-price', COLONY, false);
    const forest = spawnSurvivor(state, NOW, playerId, 'sv-forest-plum', 'school', false);
    addZombies(state, 'school', 3);
    muteCrossroads(state);
    nextRolls(state, [1]);
    state = act(state, playerId, { type: 'moveSurvivor', survivorId: john.id, to: 'school' });
    state = act(state, playerId, {
      type: 'useAbility',
      survivorId: john.id,
      abilityId: 'forest-sacrifice',
    });

    expect(state.survivors[john.id]).toBeUndefined();
    expect(state.survivors[forest.id]).toBeDefined();
    expect(zombiesAt(state, 'school')).toBe(0);
  });

  it('§18.3 John Price kept alive by Buddy Davis dies after moving away with three wounds', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const john = spawnSurvivor(state, NOW, playerId, 'sv-john-price', 'school', false);
    spawnSurvivor(state, NOW, playerId, 'sv-buddy-davis', 'school', false);
    john.wounds = 3;
    john.movedThisTurn = false;
    muteCrossroads(state);
    nextRolls(state, [1]);
    state = act(state, playerId, { type: 'moveSurvivor', survivorId: john.id, to: 'grocery-store' });

    expect(state.survivors[john.id]).toBeUndefined();
  });

  it('§18.3 orphan reconciliation removes an unbacked standee and reports the content error', () => {
    const state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    state.survivors['orphan-a14'] = {
      id: 'orphan-a14',
      cardId: 'missing-survivor-card',
      controllerId: playerId,
      location: COLONY,
      wounds: 0,
      frostbite: 0,
      equipped: [],
      movedThisTurn: false,
      isLeader: false,
      usedThisTurn: [],
      usedThisRound: [],
      usedThisGame: [],
    };
    muteCrossroads(state);

    advance(state, NOW);

    expect(state.survivors['orphan-a14']).toBeUndefined();
    expect(logEvents(state, 'contentError').at(-1)?.data).toMatchObject({ survivorId: 'orphan-a14' });
  });
});

describe('A14 §18.4 — Crossroads Bev ruling', () => {
  it('§18.4 Bev Russell counts as present but cannot be selected as an overrun casualty', () => {
    const state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const normal = survivorsOfPlayer(state, playerId).find((survivor) => !survivor.isLeader)!;
    placeSurvivor(state, normal.id, 'school');
    const bev = spawnSurvivor(state, NOW, playerId, 'sv-bev-russell', 'school', false);
    runColonyStep(state, NOW, 'addZombies');
    advance(state, NOW);
    expect(logEvents(state, 'zombiePlacement').filter((entry) => entry.data?.location === 'school')).toHaveLength(2);
    state.locations['school']!.entrance.zombies = state.locations['school']!.entrance.capacity;
    state.locations['school']!.entrance.barricades = 0;
    muteCrossroads(state);

    resolveOverrun(state, NOW, 'school');
    advance(state, NOW);

    expect(state.survivors[bev.id]).toBeDefined();
    expect(state.survivors[normal.id]).toBeUndefined();
    expect(survivorsAt(state, 'school').map((survivor) => survivor.id)).toContain(bev.id);
  });
});

describe('A14 §18.5 — item rulings', () => {
  it('§18.5 EVENT and OUTSIDER text cards from item decks remain playable item cards', () => {
    let state = start({
      pack: A14_PACK,
      playerCount: 4,
      settings: { mainObjectiveId: 'mo-stockpile' },
    });
    const playerId = active(state);
    muteCrossroads(state);
    const eventCard = grantItem(state, playerId, 'it-hostage');
    const outsider = grantItem(state, playerId, outsiderCard.id);

    expect(contentOf(state).items.get('it-hostage')?.textKind).toBe('event');
    expect(contentOf(state).items.get(outsiderCard.id)?.textKind).toBe('outsider');
    state = act(state, playerId, { type: 'playItem', iid: eventCard });
    state = act(state, playerId, { type: 'playItem', iid: outsider });

    expect(zoneOf(state, eventCard)).toEqual({ kind: 'waste' });
    expect(zoneOf(state, outsider)).toEqual({ kind: 'waste' });
  });

  it('§18.5 permits two copies of the same item to be equipped to one survivor', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const survivor = survivorsOfPlayer(state, playerId)[0]!;
    muteCrossroads(state);
    const first = grantItem(state, playerId, 'it-baseball-bat');
    const second = grantItem(state, playerId, 'it-baseball-bat');

    state = act(state, playerId, { type: 'playItem', iid: first, targetSurvivorId: survivor.id });
    state = act(state, playerId, { type: 'playItem', iid: second, targetSurvivorId: survivor.id });

    expect(state.survivors[survivor.id]!.equipped).toEqual([first, second]);
  });

  it('§18.5 Baseball Bat killing two zombies causes two exposure rolls', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const survivor = survivorsOfPlayer(state, playerId)[0]!;
    const bat = grantItem(state, playerId, 'it-baseball-bat');
    addZombies(state, COLONY, 2);
    muteCrossroads(state);
    nextRolls(state, [1, 1]);
    state = act(state, playerId, { type: 'playItem', iid: bat, targetSurvivorId: survivor.id });
    state = act(state, playerId, {
      type: 'useAbility',
      survivorId: survivor.id,
      abilityId: 'bat-swing',
      itemIid: bat,
    });

    expect(zombiesAt(state, COLONY)).toBe(0);
    expect(logEvents(state, 'exposure')).toHaveLength(2);
  });

  it('§18.5 Megaphone uses Attract capacity rules and cannot overrun a full destination', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const megaphone = grantItem(state, playerId, 'it-megaphone');
    addZombies(state, 'school', 2);
    for (const entrance of state.colony.entrances) {
      entrance.zombies = entrance.capacity;
      entrance.barricades = 0;
    }
    muteCrossroads(state);

    state = act(state, playerId, { type: 'playItem', iid: megaphone });

    expect(zombiesAt(state, 'school')).toBe(2);
    expect(zombiesAt(state, COLONY)).toBe(state.colony.entrances.reduce((total, entrance) => total + entrance.capacity, 0));
    expect(logEvents(state, 'overrun')).toEqual([]);
  });

  it('§18.5 Switchblade and once-per-round state survive death, re-equip, and hand-off', () => {
    let state = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    const playerId = active(state);
    const giver = survivorsOfPlayer(state, playerId).find((survivor) => !survivor.isLeader)!;
    const receiver = survivorsOfPlayer(state, playerId).find((survivor) => survivor.id !== giver.id)!;
    const third = spawnSurvivor(state, NOW, playerId, 'sv-forest-plum', COLONY, false);
    const bat = grantItem(state, playerId, 'it-baseball-bat');
    addZombies(state, COLONY, 2);
    muteCrossroads(state);
    nextRolls(state, [1, 1]);
    state = act(state, playerId, { type: 'playItem', iid: bat, targetSurvivorId: giver.id });
    state = act(state, playerId, { type: 'useAbility', survivorId: giver.id, abilityId: 'bat-swing', itemIid: bat });
    expect(state.items[bat]!.usedThisRound).toContain('bat-swing');

    killSurvivor(state, NOW, giver.id, 'effect');
    advance(state, NOW);
    expect(zoneOf(state, bat)).toEqual({ kind: 'hand', playerId });

    state = act(state, playerId, { type: 'playItem', iid: bat, targetSurvivorId: receiver.id });
    expect(validateAction(state, playerId, { type: 'useAbility', survivorId: receiver.id, abilityId: 'bat-swing', itemIid: bat })).toMatchObject({ ok: false });
    state = act(state, playerId, { type: 'handOff', iid: bat, toSurvivorId: third.id });
    expect(validateAction(state, playerId, { type: 'useAbility', survivorId: third.id, abilityId: 'bat-swing', itemIid: bat })).toMatchObject({ ok: false });
  });
});
