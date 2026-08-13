/**
 * §23 acceptance criteria A3 and A4.
 *
 *   A3. "Dice are group resources, new survivors do not grant mid-round dice,
 *        and frostbite deaths occur after dice are rolled but before that
 *        player's actions."
 *   A4. "Every die and no-die action enforces thresholds, locations,
 *        capacities, move limits, exile restrictions, and card timing."
 *
 * Every expectation below is taken from `dead-of-winter-gameplay-requirements.md`
 * — §6, §7, §8 and §13 in particular. Where the engine disagrees with that
 * document the test is left failing on purpose: the document is authoritative,
 * the engine is not.
 *
 * Legality is asserted through `validateAction`, not only through a thrown
 * `applyAction`, because a rejection for the *wrong* reason is itself a bug.
 * Every prohibition is paired with the same action made legal, so no test can
 * pass merely because everything is illegal.
 */

import { describe, expect, it } from 'vitest';

import { COLONY } from '../../content/primitives.js';
import type { GameAction, GameState, LocationId, PlayerId, SurvivorInstance } from '../../types.js';
import {
  addSurvivorToPlayer,
  contentOf,
  freeSurvivorSpaces,
  placeSurvivor as spawnSurvivor,
  pushFrame,
  turnOrder,
  validateAction,
} from '../index.js';
import {
  NOW,
  act,
  addZombies,
  answerFirstLegal,
  barricadesAt,
  grantItem,
  pending,
  placeSurvivor,
  setDice,
  start,
  survivorsOfPlayer,
  zombiesAt,
} from './helpers.js';

/* ------------------------------------------------------------------ *
 * Local scaffolding
 * ------------------------------------------------------------------ */

type Verdict = ReturnType<typeof validateAction>;

const ACCEPTED = '(accepted)';

const why = (verdict: Verdict): string => (verdict.ok ? ACCEPTED : verdict.reason);

/**
 * Asserts an action is illegal *and* that the engine names the right rule, then
 * confirms `applyAction` refuses it too. Leaves `state` untouched.
 */
function rejects(state: GameState, playerId: PlayerId, action: GameAction, rule: RegExp): void {
  const verdict = validateAction(state, playerId, action);
  expect(why(verdict)).toMatch(rule);
  expect(verdict.ok).toBe(false);
  expect(() => act(state, playerId, action)).toThrow();
}

/** Asserts an action is legal and performs it, returning the resulting state. */
function accepts(state: GameState, playerId: PlayerId, action: GameAction): GameState {
  expect(why(validateAction(state, playerId, action))).toBe(ACCEPTED);
  return act(state, playerId, action);
}

/** Asserts an action is legal without performing it. */
function isLegal(state: GameState, playerId: PlayerId, action: GameAction): void {
  expect(why(validateAction(state, playerId, action))).toBe(ACCEPTED);
}

/**
 * A four-player game on a fixed main objective.
 *
 * `mo-stockpile` is pinned because a seeded objective pick would otherwise
 * change starting morale, starting zombies and the on-kill hook from test to
 * test. Nothing here depends on the objective beyond that stability, except the
 * two §8.3 contribution tests, which need its non-starter requirement.
 */
function game(): GameState {
  return start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
}

const active = (state: GameState): PlayerId => state.turn!.playerId;

const other = (state: GameState, notThis: PlayerId): PlayerId =>
  state.seating.find((id) => id !== notThis)!;

/**
 * Marks the active player's held crossroads card as already resolved.
 *
 * Scaffolding, not an expectation: these tests are about dice and action
 * legality, and a randomly drawn card that triggers on `turnStart`, `move` or
 * `search` would otherwise inject a pending choice into the middle of one.
 */
function muteCrossroads(state: GameState): GameState {
  if (state.turn) state.turn.crossroadsTriggered = true;
  return state;
}

/** Drives play until the round counter advances. */
function nextRound(state: GameState): GameState {
  const from = state.round;
  let s = state;
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'gameOver') throw new Error('nextRound(): the game ended first');
    if (s.round > from) return s;
    if (pending(s)) {
      s = answerFirstLegal(s);
      continue;
    }
    if (s.turn) {
      muteCrossroads(s);
      s = act(s, s.turn.playerId, { type: 'endTurn' });
      continue;
    }
    throw new Error(`nextRound(): stuck in phase '${s.phase}'`);
  }
  throw new Error('nextRound(): did not settle');
}

/** Drives play until `playerId` is the active player and nothing is pending. */
function turnOf(state: GameState, playerId: PlayerId): GameState {
  let s = state;
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'gameOver') throw new Error('turnOf(): the game ended first');
    if (pending(s)) {
      s = answerFirstLegal(s);
      continue;
    }
    if (s.turn?.playerId === playerId) return s;
    if (!s.turn) throw new Error(`turnOf(): stuck in phase '${s.phase}'`);
    muteCrossroads(s);
    s = act(s, s.turn.playerId, { type: 'endTurn' });
  }
  throw new Error('turnOf(): did not settle');
}

/** Index of the first log entry whose `data.event` matches, or -1. */
function logIndex(state: GameState, event: string, playerId?: PlayerId): number {
  return state.log.findIndex((entry) => {
    const data = entry.data as { event?: string; playerId?: string } | undefined;
    if (data?.event !== event) return false;
    return playerId === undefined || data.playerId === playerId || entry.playerId === playerId;
  });
}

const dieOf = (state: GameState, playerId: PlayerId): number[] => state.players[playerId]!.unusedDice;

/* ================================================================== *
 * §6 — dice are a group resource
 * ================================================================== */

describe('§6 action dice are a group resource', () => {
  it('§6 gives every player one die plus one die for every survivor they control', () => {
    const s = game();
    for (const id of s.seating) {
      const survivors = survivorsOfPlayer(s, id).length;
      expect(survivors).toBe(2); // §4.10 keeps two
      expect(dieOf(s, id).length).toBe(1 + survivors);
      expect(s.players[id]!.usedDice).toEqual([]);
    }
  });

  it('§6 lets either of a player\'s survivors spend any die from that one pool', () => {
    let s = game();
    const p = active(s);
    const [first, second] = survivorsOfPlayer(s, p);
    expect(first!.controllerId).toBe(p);
    expect(second!.controllerId).toBe(p);
    setDice(s, p, [2, 5]);

    // Barricade is an "any result" action (§7.4), so the only question the
    // engine can be answering here is whose pool the die came from.
    s = accepts(s, p, { type: 'barricade', survivorId: first!.id, die: 5 });
    s = accepts(s, p, { type: 'barricade', survivorId: second!.id, die: 2 });

    expect(dieOf(s, p)).toEqual([]);
    expect(s.players[p]!.usedDice.sort()).toEqual([2, 5]);
    expect(barricadesAt(s, COLONY)).toBe(2);
  });

  it('§6 lets one survivor use multiple dice and perform multiple actions', () => {
    let s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    setDice(s, p, [1, 2, 3]);

    for (const die of [1, 2, 3]) {
      s = accepts(s, p, { type: 'barricade', survivorId: survivor.id, die });
    }
    expect(dieOf(s, p)).toEqual([]);
    expect(barricadesAt(s, COLONY)).toBe(3);
  });

  it('§6 refuses a die that is in another player\'s pool', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    setDice(s, p, [2]);
    setDice(s, q, [6]);
    expect(dieOf(s, q)).toContain(6);
    expect(dieOf(s, p)).not.toContain(6);

    const survivor = survivorsOfPlayer(s, p)[0]!;
    rejects(s, p, { type: 'barricade', survivorId: survivor.id, die: 6 }, /no such unused die/i);
    isLegal(s, p, { type: 'barricade', survivorId: survivor.id, die: 2 });
  });

  it('§7 moves a spent die from the unused pool to the used pool', () => {
    let s = game();
    const p = active(s);
    setDice(s, p, [4, 4]);
    const survivor = survivorsOfPlayer(s, p)[0]!;

    s = accepts(s, p, { type: 'barricade', survivorId: survivor.id, die: 4 });
    expect(dieOf(s, p)).toEqual([4]);
    expect(s.players[p]!.usedDice).toEqual([4]);
  });

  it('§6 clears both pools and rerolls at the next Roll Action Dice step', () => {
    let s = game();
    const p = active(s);
    setDice(s, p, [1, 1, 1]);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    s = accepts(s, p, { type: 'barricade', survivorId: survivor.id, die: 1 });
    expect(s.players[p]!.usedDice.length).toBe(1);

    s = nextRound(s);
    expect(s.players[p]!.usedDice).toEqual([]);
    expect(dieOf(s, p).length).toBe(1 + survivorsOfPlayer(s, p).length);
  });
});

/* ================================================================== *
 * §13/§18.3 — a survivor added mid-turn
 * ================================================================== */

describe('§13 a survivor added during a turn', () => {
  it('§13 grants no additional action die when it arrives', () => {
    const s = game();
    const p = active(s);
    const before = dieOf(s, p).length;
    const survivorsBefore = survivorsOfPlayer(s, p).length;

    expect(addSurvivorToPlayer(s, NOW, p)).toBe(true);

    expect(survivorsOfPlayer(s, p).length).toBe(survivorsBefore + 1);
    expect(dieOf(s, p).length).toBe(before);
  });

  it('§13 may act immediately in the current controller\'s turn', () => {
    let s = game();
    const p = active(s);
    const known = new Set(survivorsOfPlayer(s, p).map((x) => x.id));
    addSurvivorToPlayer(s, NOW, p);
    const fresh = survivorsOfPlayer(s, p).find((x) => !known.has(x.id))!;
    expect(fresh.location).toBe(COLONY);
    setDice(s, p, [3]);

    s = accepts(s, p, { type: 'barricade', survivorId: fresh.id, die: 3 });
    expect(barricadesAt(s, COLONY)).toBe(1);
  });

  it('§18.3 grants its die only at the next round\'s dice step', () => {
    let s = game();
    const p = active(s);
    addSurvivorToPlayer(s, NOW, p);
    const count = survivorsOfPlayer(s, p).length;
    expect(count).toBe(3);

    s = nextRound(s);
    expect(survivorsOfPlayer(s, p).length).toBe(count);
    expect(dieOf(s, p).length).toBe(1 + count);
  });

  it('§13 refuses to add a survivor when the colony has no empty survivor space', () => {
    const s = game();
    const p = active(s);
    // §2.3: helpless survivors occupy colony survivor spaces too.
    const standing = Object.values(s.survivors).filter((x) => x.location === COLONY).length;
    s.colony.helpless = s.colony.survivorSpaces - standing;
    expect(freeSurvivorSpaces(s, COLONY)).toBe(0);
    const before = survivorsOfPlayer(s, p).length;

    expect(addSurvivorToPlayer(s, NOW, p)).toBe(false);
    expect(survivorsOfPlayer(s, p).length).toBe(before);
  });
});

/* ================================================================== *
 * §6/§9 — frostbite death timing
 * ================================================================== */

describe('§6 frostbite deaths at turn start', () => {
  /** Sets up the next player to lose a survivor to frostbite on their turn. */
  function doomNextPlayer(state: GameState): {
    victimId: PlayerId;
    doomed: SurvivorInstance;
  } {
    const order = turnOrder(state);
    const victimId = order[1]!;
    const doomed = survivorsOfPlayer(state, victimId)[0]!;
    // Two wounds already, one of them frostbite: §9.1's turn-start frostbite
    // wound is the third, and §9.1 kills at three of any mix.
    doomed.wounds = 1;
    doomed.frostbite = 1;
    return { victimId, doomed };
  }

  it('§9.1 adds one regular wound at turn start while a frostbite token remains', () => {
    let s = game();
    const order = turnOrder(s);
    const victimId = order[1]!;
    const survivor = survivorsOfPlayer(s, victimId)[0]!;
    survivor.frostbite = 1;
    expect(survivor.wounds).toBe(0);

    muteCrossroads(s);
    s = act(s, active(s), { type: 'endTurn' });

    expect(s.turn!.playerId).toBe(victimId);
    const after = s.survivors[survivor.id]!;
    expect(after.frostbite).toBe(1);
    expect(after.wounds).toBe(1);
  });

  it('§6 a survivor doomed by frostbite still contributed its die this round', () => {
    let s = game();
    const { victimId, doomed } = doomNextPlayer(s);
    // Precondition: the dice were rolled at §5.1 step 2, while the survivor lived.
    expect(dieOf(s, victimId).length).toBe(1 + survivorsOfPlayer(s, victimId).length);
    const rolled = dieOf(s, victimId).length;

    muteCrossroads(s);
    s = act(s, active(s), { type: 'endTurn' });

    expect(s.survivors[doomed.id]).toBeUndefined();
    expect(survivorsOfPlayer(s, victimId).length).toBe(1);
    expect(dieOf(s, victimId).length).toBe(rolled);
  });

  it('§6 kills the frostbitten survivor after the dice roll and before the player may act', () => {
    let s = game();
    const { victimId, doomed } = doomNextPlayer(s);
    muteCrossroads(s);
    s = act(s, active(s), { type: 'endTurn' });

    const diceAt = logIndex(s, 'diceRolled', victimId);
    const turnAt = logIndex(s, 'turnStart', victimId);
    const deathAt = s.log.findIndex(
      (e) => (e.data as { event?: string; survivorId?: string } | undefined)?.survivorId === doomed.id
        && (e.data as { event?: string })?.event === 'survivorDied',
    );
    expect(diceAt).toBeGreaterThanOrEqual(0);
    expect(deathAt).toBeGreaterThanOrEqual(0);
    expect(diceAt).toBeLessThan(turnAt);
    expect(turnAt).toBeLessThan(deathAt);

    // §6 step 3: the death is complete before the controller is given the clock.
    expect(s.turn!.playerId).toBe(victimId);
    expect(s.pendingChoices).toEqual([]);
    setDice(s, victimId, [6]);
    rejects(
      s,
      victimId,
      { type: 'barricade', survivorId: doomed.id, die: 6 },
      /not on the board/i,
    );
  });
});

/* ================================================================== *
 * §7 — thresholds are minimums
 * ================================================================== */

describe('§7 die thresholds are met-or-exceeded', () => {
  /** Puts a named fixture survivor under `playerId`'s control at `location`. */
  function spawn(
    state: GameState,
    playerId: PlayerId,
    cardId: string,
    // Annotated: defaulting to COLONY alone would narrow the parameter to the
    // literal 'colony' and reject every non-colony location.
    location: LocationId = COLONY,
  ) {
    return spawnSurvivor(state, NOW, playerId, cardId, location, false);
  }

  it('§7.1 rejects an attack on a die below the survivor\'s attack threshold', () => {
    const s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    expect(contentOf(s).survivors.get('sv-loretta-clay')!.attackThreshold).toBe(4);
    addZombies(s, COLONY, 1);
    expect(zombiesAt(s, COLONY)).toBe(1);
    setDice(s, p, [3]);

    rejects(s, p, { type: 'attackZombie', survivorId: loretta.id, die: 3 }, /4 or better/);
  });

  it('§7.1 accepts an attack on a die that exactly meets the threshold', () => {
    let s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    addZombies(s, COLONY, 1);
    setDice(s, p, [4]);

    s = accepts(s, p, { type: 'attackZombie', survivorId: loretta.id, die: 4 });
    expect(zombiesAt(s, COLONY)).toBe(0);
  });

  it('§7.1 accepts an attack on a die above the threshold', () => {
    let s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    addZombies(s, COLONY, 1);
    setDice(s, p, [6]);

    s = accepts(s, p, { type: 'attackZombie', survivorId: loretta.id, die: 6 });
    expect(zombiesAt(s, COLONY)).toBe(0);
  });

  it('§18.1 rejects Loretta Clay\'s ability on a 3', () => {
    const s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    const ability = contentOf(s).survivors.get('sv-loretta-clay')!.ability!;
    expect(ability.dieThreshold).toBe(4);
    setDice(s, p, [3]);

    rejects(
      s,
      p,
      { type: 'useAbility', survivorId: loretta.id, abilityId: 'loretta-fix', die: 3 },
      /4 or better/,
    );
  });

  it('§18.1 accepts Loretta Clay\'s ability on a 4', () => {
    let s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    setDice(s, p, [4]);

    s = accepts(s, p, {
      type: 'useAbility',
      survivorId: loretta.id,
      abilityId: 'loretta-fix',
      die: 4,
    });
    expect(barricadesAt(s, COLONY)).toBe(1);
  });

  it('§18.1 accepts Loretta Clay\'s ability on a 5 — the threshold is 4+, not exactly 4', () => {
    let s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    setDice(s, p, [5]);
    expect(dieOf(s, p)).not.toContain(4); // no 4 is available to fall back on

    s = accepts(s, p, {
      type: 'useAbility',
      survivorId: loretta.id,
      abilityId: 'loretta-fix',
      die: 5,
    });
    expect(barricadesAt(s, COLONY)).toBe(1);
  });

  it('§7.3 rejects a search on a die below the survivor\'s search threshold', () => {
    const s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay', 'school');
    expect(contentOf(s).survivors.get('sv-loretta-clay')!.searchThreshold).toBe(4);
    expect(s.locations['school']!.deck.length).toBeGreaterThan(0);
    setDice(s, p, [3]);

    rejects(s, p, { type: 'search', survivorId: loretta.id, die: 3 }, /4 or better/);
  });

  it('§7.3 accepts a search on a die that meets the search threshold', () => {
    let s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay', 'school');
    setDice(s, p, [4]);

    s = accepts(s, p, { type: 'search', survivorId: loretta.id, die: 4 });
    expect(pending(s)!.kind).toBe('searchDecision');
  });

  it('§7.2 measures a survivor attack against the attacker\'s threshold', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    const target = survivorsOfPlayer(s, q)[0]!;
    expect(target.location).toBe(COLONY);
    expect(loretta.location).toBe(COLONY);
    setDice(s, p, [3, 4]);

    rejects(
      s,
      p,
      { type: 'attackSurvivor', survivorId: loretta.id, die: 3, targetId: target.id },
      /4 or better/,
    );
    isLegal(s, p, { type: 'attackSurvivor', survivorId: loretta.id, die: 4, targetId: target.id });
  });

  it('§18.5 Switchblade lowers the die an attack requires without replacing the attack', () => {
    let s = game();
    const p = active(s);
    const loretta = spawn(s, p, 'sv-loretta-clay');
    addZombies(s, COLONY, 1);
    setDice(s, p, [3]);
    // Precondition: a 3 is not enough on its own.
    rejects(s, p, { type: 'attackZombie', survivorId: loretta.id, die: 3 }, /4 or better/);

    const iid = grantItem(s, p, 'it-switchblade');
    s = accepts(s, p, { type: 'playItem', iid, targetSurvivorId: loretta.id });
    expect(s.survivors[loretta.id]!.equipped).toContain(iid);

    s = accepts(s, p, { type: 'attackZombie', survivorId: loretta.id, die: 3 });
    expect(zombiesAt(s, COLONY)).toBe(0);
  });

  it('§7.4 barricade accepts any unused die', () => {
    const s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    setDice(s, p, [1]);
    isLegal(s, p, { type: 'barricade', survivorId: survivor.id, die: 1 });
  });

  it('§7.6 attract accepts any unused die', () => {
    const s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    addZombies(s, 'school', 1);
    setDice(s, p, [1]);
    isLegal(s, p, {
      type: 'attract',
      survivorId: survivor.id,
      die: 1,
      from: 'school',
      count: 1,
    });
  });
});

/* ================================================================== *
 * §7/§8 — location requirements
 * ================================================================== */

describe('§7/§8 location requirements', () => {
  it('§7.3 rejects a search at the colony and accepts the same search outside it', () => {
    const s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    expect(survivor.location).toBe(COLONY);
    const threshold = contentOf(s).survivors.get(survivor.cardId)!.searchThreshold;
    setDice(s, p, [6]);
    expect(6).toBeGreaterThanOrEqual(threshold); // the die is not the obstacle

    rejects(s, p, { type: 'search', survivorId: survivor.id, die: 6 }, /§7\.3/);

    placeSurvivor(s, survivor.id, 'library');
    isLegal(s, p, { type: 'search', survivorId: survivor.id, die: 6 });
  });

  it('§7.5 rejects clean waste when the player controls no survivor at the colony', () => {
    let s = game();
    const p = active(s);
    // A non-empty waste pile, produced legally by playing a card (§8.1).
    const iid = grantItem(s, p, 'it-st1');
    setDice(s, p, [1, 1]);
    s = accepts(s, p, { type: 'playItem', iid });
    expect(s.colony.waste.length).toBeGreaterThan(0);

    for (const survivor of survivorsOfPlayer(s, p)) placeSurvivor(s, survivor.id, 'school');
    expect(survivorsOfPlayer(s, p).every((x) => x.location !== COLONY)).toBe(true);
    rejects(s, p, { type: 'cleanWaste', die: 1 }, /§7\.5/);

    placeSurvivor(s, survivorsOfPlayer(s, p)[0]!.id, COLONY);
    const wasteBefore = s.colony.waste.length;
    s = accepts(s, p, { type: 'cleanWaste', die: 1 });
    expect(s.colony.waste.length).toBeLessThan(wasteBefore);
  });

  it('§7.1 rejects an attack where the survivor stands with no zombie', () => {
    const s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    addZombies(s, 'school', 1);
    expect(zombiesAt(s, COLONY)).toBe(0);
    expect(zombiesAt(s, 'school')).toBe(1);
    setDice(s, p, [6]);

    rejects(s, p, { type: 'attackZombie', survivorId: survivor.id, die: 6 }, /no zombie/i);

    placeSurvivor(s, survivor.id, 'school');
    isLegal(s, p, { type: 'attackZombie', survivorId: survivor.id, die: 6 });
  });

  it('§7.1 lets a colony attack choose a zombie at any entrance', () => {
    const s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    setDice(s, p, [6]);
    const entrance = s.colony.entrances[3]!;
    entrance.zombies = 1;
    expect(s.colony.entrances[0]!.zombies).toBe(0);

    isLegal(s, p, { type: 'attackZombie', survivorId: survivor.id, die: 6 });
    isLegal(s, p, {
      type: 'attackZombie',
      survivorId: survivor.id,
      die: 6,
      entrance: entrance.index,
    });
    rejects(
      s,
      p,
      { type: 'attackZombie', survivorId: survivor.id, die: 6, entrance: 1 },
      /no zombie/i,
    );
  });

  it('§7.2 rejects attacking a survivor at another location', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    const attacker = spawnSurvivor(s, NOW, p, 'sv-loretta-clay', COLONY, false);
    const target = survivorsOfPlayer(s, q)[0]!;
    placeSurvivor(s, target.id, 'school');
    setDice(s, p, [6]);

    rejects(
      s,
      p,
      { type: 'attackSurvivor', survivorId: attacker.id, die: 6, targetId: target.id },
      /somewhere else/i,
    );

    placeSurvivor(s, target.id, COLONY);
    isLegal(s, p, { type: 'attackSurvivor', survivorId: attacker.id, die: 6, targetId: target.id });
  });

  it('§7.2 rejects attacking a survivor you control yourself', () => {
    const s = game();
    const p = active(s);
    const [attacker, mine] = survivorsOfPlayer(s, p);
    setDice(s, p, [6]);

    rejects(
      s,
      p,
      { type: 'attackSurvivor', survivorId: attacker!.id, die: 6, targetId: mine!.id },
      /your own survivor/i,
    );
  });

  it('§7.7 rejects an ability used away from its printed location', () => {
    const s = game();
    const p = active(s);
    const loretta = spawnSurvivor(s, NOW, p, 'sv-loretta-clay', 'school', false);
    expect(contentOf(s).survivors.get('sv-loretta-clay')!.ability!.location).toBe(COLONY);
    setDice(s, p, [5]);

    rejects(
      s,
      p,
      { type: 'useAbility', survivorId: loretta.id, abilityId: 'loretta-fix', die: 5 },
      /only works at colony/i,
    );

    placeSurvivor(s, loretta.id, COLONY);
    isLegal(s, p, { type: 'useAbility', survivorId: loretta.id, abilityId: 'loretta-fix', die: 5 });
  });

  it('§7.7 rejects one survivor borrowing another survivor\'s ability', () => {
    const s = game();
    const p = active(s);
    spawnSurvivor(s, NOW, p, 'sv-loretta-clay', COLONY, false);
    const bystander = survivorsOfPlayer(s, p)[0]!;
    setDice(s, p, [5]);

    rejects(
      s,
      p,
      { type: 'useAbility', survivorId: bystander.id, abilityId: 'loretta-fix', die: 5 },
      /§7\.7/,
    );
  });

  it('§7.6 rejects an attract that draws from the survivor\'s own location', () => {
    const s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    addZombies(s, COLONY, 1);
    addZombies(s, 'school', 1);
    setDice(s, p, [2]);

    rejects(
      s,
      p,
      { type: 'attract', survivorId: survivor.id, die: 2, from: COLONY, count: 1 },
      /§7\.6/,
    );
    isLegal(s, p, { type: 'attract', survivorId: survivor.id, die: 2, from: 'school', count: 1 });
  });
});

/* ================================================================== *
 * §2.5/§7/§12 — capacities
 * ================================================================== */

describe('§2.5/§12 capacity limits', () => {
  it('§8.4 rejects a move to a location whose survivor spaces are full', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    const capacity = s.locations['school']!.survivorCapacity;
    for (let i = 0; i < capacity; i++) {
      spawnSurvivor(s, NOW, q, `sv-f${i + 1}`, 'school', false);
    }
    expect(freeSurvivorSpaces(s, 'school')).toBe(0);
    expect(freeSurvivorSpaces(s, 'library')).toBeGreaterThan(0);

    const mover = survivorsOfPlayer(s, p)[0]!;
    rejects(s, p, { type: 'moveSurvivor', survivorId: mover.id, to: 'school' }, /empty survivor space/i);
    isLegal(s, p, { type: 'moveSurvivor', survivorId: mover.id, to: 'library' });
  });

  it('§7.4 rejects a barricade where the entrance spaces are all occupied', () => {
    const s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    placeSurvivor(s, survivor.id, 'school');
    const entrance = s.locations['school']!.entrance;
    addZombies(s, 'school', entrance.capacity);
    expect(entrance.zombies).toBe(entrance.capacity);
    setDice(s, p, [1]);

    rejects(s, p, { type: 'barricade', survivorId: survivor.id, die: 1 }, /§7\.4/);
  });

  it('§7.4 accepts a barricade while one entrance space remains, and refuses the next', () => {
    let s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    placeSurvivor(s, survivor.id, 'school');
    const capacity = s.locations['school']!.entrance.capacity;
    addZombies(s, 'school', capacity - 1);
    setDice(s, p, [1, 2]);

    s = accepts(s, p, { type: 'barricade', survivorId: survivor.id, die: 1 });
    const entrance = s.locations['school']!.entrance;
    expect(entrance.barricades).toBe(1);
    // §2.5: barricades and zombies are mutually exclusive occupants of a space.
    expect(entrance.zombies + entrance.barricades).toBe(entrance.capacity);

    rejects(s, p, { type: 'barricade', survivorId: survivor.id, die: 2 }, /§7\.4/);
  });

  it('§2.5 refuses a second barricade at a colony entrance already sharing its space with a zombie', () => {
    let s = game();
    const p = active(s);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    const entrance = s.colony.entrances[0]!;
    entrance.zombies = 1;
    expect(entrance.capacity).toBe(2);
    setDice(s, p, [1, 2, 3]);

    s = accepts(s, p, { type: 'barricade', survivorId: survivor.id, die: 1, entrance: 1 });
    const after = s.colony.entrances[0]!;
    expect(after.zombies).toBe(1);
    expect(after.barricades).toBe(1);

    rejects(s, p, { type: 'barricade', survivorId: survivor.id, die: 2, entrance: 1 }, /§7\.4/);
    // Another entrance still has room, so the action itself is not exhausted.
    isLegal(s, p, { type: 'barricade', survivorId: survivor.id, die: 2, entrance: 2 });
  });

  it('§7.3 offers the noise option only while an empty noise space remains', () => {
    let s = game();
    const p = active(s);
    const loretta = spawnSurvivor(s, NOW, p, 'sv-loretta-clay', 'school', false);
    setDice(s, p, [4, 4]);

    const open = accepts(s, p, { type: 'search', survivorId: loretta.id, die: 4 });
    const openNoise = pending(open)!.options.find((o) => o.id === 'noise')!;
    expect(openNoise.legal).toBe(true);

    s.locations['school']!.noise = s.locations['school']!.noiseSpaces;
    const full = accepts(s, p, { type: 'search', survivorId: loretta.id, die: 4 });
    const fullNoise = pending(full)!.options.find((o) => o.id === 'noise')!;
    expect(fullNoise.legal).toBe(false);
    expect(fullNoise.reason ?? '').toMatch(/§7\.3/);
  });
});

/* ================================================================== *
 * §8.4 — move limits
 * ================================================================== */

describe('§8.4 movement', () => {
  it('§8.4 lets a survivor move at most once per turn', () => {
    let s = game();
    const p = active(s);
    const mover = survivorsOfPlayer(s, p)[0]!;
    expect(mover.movedThisTurn).toBe(false);
    muteCrossroads(s);

    s = accepts(s, p, { type: 'moveSurvivor', survivorId: mover.id, to: 'school' });
    const moved = s.survivors[mover.id];
    expect(moved, 'the mover must survive its arrival exposure for this test to mean anything')
      .toBeDefined();
    expect(moved!.location).toBe('school');
    expect(moved!.movedThisTurn).toBe(true);

    rejects(s, p, { type: 'moveSurvivor', survivorId: mover.id, to: 'library' }, /§8\.4/);
  });

  it('§8.4 applies the move limit per survivor, not per turn', () => {
    let s = game();
    const p = active(s);
    const [first, second] = survivorsOfPlayer(s, p);
    muteCrossroads(s);

    s = accepts(s, p, { type: 'moveSurvivor', survivorId: first!.id, to: 'school' });
    expect(s.survivors[second!.id]!.movedThisTurn).toBe(false);
    isLegal(s, p, { type: 'moveSurvivor', survivorId: second!.id, to: 'library' });
  });

  it('§8.4 refuses a move to the location the survivor already occupies', () => {
    const s = game();
    const p = active(s);
    const mover = survivorsOfPlayer(s, p)[0]!;
    rejects(s, p, { type: 'moveSurvivor', survivorId: mover.id, to: COLONY }, /already there/i);
  });

  it('§6/§8.4 restores the move allowance when the controller next takes a turn', () => {
    let s = game();
    const p = active(s);
    const mover = survivorsOfPlayer(s, p)[0]!;
    muteCrossroads(s);
    s = accepts(s, p, { type: 'moveSurvivor', survivorId: mover.id, to: 'school' });
    expect(s.survivors[mover.id]!.movedThisTurn).toBe(true);

    s = turnOf(nextRound(s), p);
    expect(s.turn!.playerId).toBe(p);
    expect(s.survivors[mover.id]!.movedThisTurn).toBe(false);
    isLegal(s, p, { type: 'moveSurvivor', survivorId: mover.id, to: 'library' });
  });
});

/* ================================================================== *
 * §14 — exile restrictions
 * ================================================================== */

describe('§14.2 exile restrictions', () => {
  /** Marks `playerId` exiled and puts their survivors outside the walls. */
  function exile(state: GameState, playerId: PlayerId): void {
    state.players[playerId]!.exiled = true;
    for (const survivor of survivorsOfPlayer(state, playerId)) {
      placeSurvivor(state, survivor.id, 'school');
    }
  }

  it('§14.2 refuses to move an exiled survivor into the colony', () => {
    const s = game();
    const p = active(s);
    exile(s, p);
    const survivor = survivorsOfPlayer(s, p)[0]!;
    expect(survivor.location).toBe('school');
    expect(freeSurvivorSpaces(s, COLONY)).toBeGreaterThan(0);

    rejects(s, p, { type: 'moveSurvivor', survivorId: survivor.id, to: COLONY }, /§14\.2/);
    isLegal(s, p, { type: 'moveSurvivor', survivorId: survivor.id, to: 'library' });
  });

  it('§14.2 refuses a crisis contribution from an exiled player', () => {
    const s = game();
    const p = active(s);
    const iid = grantItem(s, p, 'it-st1');
    expect(s.crisis.cardId).toBeTruthy();
    isLegal(s, p, { type: 'contributeCrisis', iids: [iid] });

    exile(s, p);
    rejects(s, p, { type: 'contributeCrisis', iids: [iid] }, /§14\.2/);
  });

  it('§14.2 refuses colony food spending by an exiled player', () => {
    const s = game();
    const p = active(s);
    s.colony.food = 3;
    setDice(s, p, [2]);
    isLegal(s, p, { type: 'spendFood', die: 2, count: 1 });

    exile(s, p);
    rejects(s, p, { type: 'spendFood', die: 2, count: 1 }, /§14\.2/);
  });

  it('§14.2 still lets an exiled player request cards', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    exile(s, p);
    expect(s.players[q]!.hand.length).toBeGreaterThan(0);

    isLegal(s, p, { type: 'requestCards', fromPlayerId: q });
  });

  it('§8.3 still lets an exiled player contribute to the main objective', () => {
    const s = game();
    const p = active(s);
    exile(s, p);
    const iid = grantItem(s, p, 'it-school-2');

    isLegal(s, p, { type: 'contributeObjective', iids: [iid] });
  });

  it('§8.8 still lets an exiled player initiate an exile vote', () => {
    const s = game();
    const p = active(s);
    exile(s, p);

    isLegal(s, p, { type: 'nominateExile', targetPlayerId: other(s, p) });
  });

  it('§14.2 refuses a vote cast by an exiled player', () => {
    let s = game();
    const p = active(s);
    const q = other(s, p);
    const exiled = s.seating.find((id) => id !== p && id !== q)!;
    exile(s, exiled);

    s = accepts(s, p, { type: 'nominateExile', targetPlayerId: q });
    expect(s.vote).toBeTruthy();
    expect(s.vote!.electorate).not.toContain(exiled);

    rejects(s, exiled, { type: 'castVote', vote: true }, /§14\.2/);
    isLegal(s, q, { type: 'castVote', vote: false });
  });
});

/* ================================================================== *
 * §8 — no-die actions
 * ================================================================== */

describe('§8 no-die actions', () => {
  it('§8.5 refuses to raise a die above six', () => {
    const s = game();
    const p = active(s);
    s.colony.food = 5;
    setDice(s, p, [5, 4]);

    rejects(s, p, { type: 'spendFood', die: 5, count: 2 }, /§8\.5/);
    isLegal(s, p, { type: 'spendFood', die: 4, count: 2 });
  });

  it('§8.5 raises exactly one die and removes exactly that much food', () => {
    let s = game();
    const p = active(s);
    s.colony.food = 5;
    setDice(s, p, [4, 4]);

    s = accepts(s, p, { type: 'spendFood', die: 4, count: 2 });
    expect(s.colony.food).toBe(3);
    expect(dieOf(s, p).sort()).toEqual([4, 6]);
  });

  it('§8.5 refuses food spending with no unused die to raise', () => {
    const s = game();
    const p = active(s);
    s.colony.food = 5;
    setDice(s, p, []);

    rejects(s, p, { type: 'spendFood', die: 3, count: 1 }, /no such unused die/i);
  });

  it('§8.5 refuses to spend more food than the colony holds', () => {
    const s = game();
    const p = active(s);
    s.colony.food = 1;
    setDice(s, p, [2]);

    rejects(s, p, { type: 'spendFood', die: 2, count: 2 }, /less food/i);
  });

  it('§8.3/§18.2 refuses a starter card where the objective wants non-starter cards', () => {
    const s = game();
    const p = active(s);
    expect(s.mainObjective.cardId).toBe('mo-stockpile');
    const starter = grantItem(s, p, 'it-st1');
    const scavenged = grantItem(s, p, 'it-school-2');

    rejects(s, p, { type: 'contributeObjective', iids: [starter] }, /§8\.3/);
    isLegal(s, p, { type: 'contributeObjective', iids: [scavenged] });
  });

  it('§8.7 refuses a hand-off between survivors at different locations', () => {
    let s = game();
    const p = active(s);
    const [giver, receiver] = survivorsOfPlayer(s, p);
    const iid = grantItem(s, p, 'it-baseball-bat');
    s = accepts(s, p, { type: 'playItem', iid, targetSurvivorId: giver!.id });
    expect(s.survivors[giver!.id]!.equipped).toContain(iid);

    placeSurvivor(s, receiver!.id, 'school');
    rejects(s, p, { type: 'handOff', iid, toSurvivorId: receiver!.id }, /§8\.7/);

    placeSurvivor(s, receiver!.id, COLONY);
    isLegal(s, p, { type: 'handOff', iid, toSurvivorId: receiver!.id });
  });

  it('§8.7 refuses to hand off a card that is not equipped', () => {
    const s = game();
    const p = active(s);
    const iid = grantItem(s, p, 'it-baseball-bat');
    const receiver = survivorsOfPlayer(s, p)[1]!;

    rejects(s, p, { type: 'handOff', iid, toSurvivorId: receiver.id }, /§8\.7/);
  });

  it('§8.6 refuses a request addressed to the requester or to an empty hand', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    rejects(s, p, { type: 'requestCards', fromPlayerId: p }, /somebody else/i);

    s.players[q]!.hand = [];
    rejects(s, p, { type: 'requestCards', fromPlayerId: q }, /no cards/i);
  });

  it('§8.6 accepts a request without any co-location requirement', () => {
    let s = game();
    const p = active(s);
    const q = other(s, p);
    for (const survivor of survivorsOfPlayer(s, q)) placeSurvivor(s, survivor.id, 'hospital');

    s = accepts(s, p, { type: 'requestCards', fromPlayerId: q });
    expect(pending(s)!.kind).toBe('requestResponse');
    expect(pending(s)!.playerId).toBe(q);
  });

  it('§8.8 refuses a self-nomination', () => {
    const s = game();
    const p = active(s);
    rejects(s, p, { type: 'nominateExile', targetPlayerId: p }, /§8\.8/);
    isLegal(s, p, { type: 'nominateExile', targetPlayerId: other(s, p) });
  });

  it('§8.8 closes the vote once every eligible voter has committed', () => {
    let s = game();
    const p = active(s);
    const q = other(s, p);
    s = accepts(s, p, { type: 'nominateExile', targetPlayerId: q });
    const electorate = [...s.vote!.electorate];
    expect(electorate.length).toBe(4); // §8.8: the nominated player votes too

    for (const voter of electorate) s = act(s, voter, { type: 'castVote', vote: false });

    expect(s.vote).toBeNull();
    expect(s.players[q]!.exiled).toBe(false);
    expect(s.pendingChoices.filter((c) => c.kind === 'vote')).toEqual([]);
  });

  it('§8.8 allows only one nomination per player per turn', () => {
    let s = game();
    const p = active(s);
    const q = other(s, p);
    const r = s.seating.find((id) => id !== p && id !== q)!;
    s = accepts(s, p, { type: 'nominateExile', targetPlayerId: q });
    for (const voter of [...s.vote!.electorate]) {
      s = act(s, voter, { type: 'castVote', vote: false });
    }
    expect(s.vote).toBeNull();

    rejects(s, p, { type: 'nominateExile', targetPlayerId: r }, /§8\.8/);
  });

  it('§15 refuses a second vote from the same player', () => {
    let s = game();
    const p = active(s);
    const q = other(s, p);
    s = accepts(s, p, { type: 'nominateExile', targetPlayerId: q });

    s = act(s, p, { type: 'castVote', vote: true });
    rejects(s, p, { type: 'castVote', vote: false }, /§15/);
  });
});

/* ================================================================== *
 * §8.1/§17 — card timing
 * ================================================================== */

describe('§8.1 card timing', () => {
  it('§8.1 refuses an ordinary item play while an effect is still resolving', () => {
    const s = game();
    const p = active(s);
    const iid = grantItem(s, p, 'it-st1');
    isLegal(s, p, { type: 'playItem', iid });

    // §17: an ordered atomic effect that ordinary item play may not interrupt.
    pushFrame(s, [{ kind: 'noop' }]);
    expect(s.effectStack.some((f) => f.queue.length > 0)).toBe(true);

    rejects(s, p, { type: 'playItem', iid }, /§8\.1/);
  });

  it('§5 refuses an item play while a decision is outstanding', () => {
    let s = game();
    const p = active(s);
    const iid = grantItem(s, p, 'it-st1');
    const searcher = spawnSurvivor(s, NOW, p, 'sv-loretta-clay', 'school', false);
    setDice(s, p, [4]);

    s = accepts(s, p, { type: 'search', survivorId: searcher.id, die: 4 });
    expect(pending(s)!.kind).toBe('searchDecision');

    rejects(s, p, { type: 'playItem', iid }, /§5|§8\.1/);
  });

  it('§8.1 refuses an item play on another player\'s turn', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    const iid = grantItem(s, q, 'it-st1');

    rejects(s, q, { type: 'playItem', iid }, /not your turn/i);
    expect(s.turn!.playerId).toBe(p);
  });

  it('§8.1 refuses an item that is not in the player\'s hand', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    const iid = grantItem(s, q, 'it-st1');

    rejects(s, p, { type: 'playItem', iid }, /not in your hand/i);
  });

  it('§8.1 requires an EQUIP card to name a survivor its player controls', () => {
    const s = game();
    const p = active(s);
    const q = other(s, p);
    const iid = grantItem(s, p, 'it-baseball-bat');

    rejects(s, p, { type: 'playItem', iid }, /choose a survivor/i);
    rejects(
      s,
      p,
      { type: 'playItem', iid, targetSurvivorId: survivorsOfPlayer(s, q)[0]!.id },
      /do not control/i,
    );
    isLegal(s, p, { type: 'playItem', iid, targetSurvivorId: survivorsOfPlayer(s, p)[0]!.id });
  });

  it('§8.1 lets a player play any number of cards in their own turn', () => {
    let s = game();
    const p = active(s);
    const first = grantItem(s, p, 'it-st1');
    const second = grantItem(s, p, 'it-st2');

    s = accepts(s, p, { type: 'playItem', iid: first });
    s = accepts(s, p, { type: 'playItem', iid: second });
    expect(s.colony.waste).toContain(first);
    expect(s.colony.waste).toContain(second);
  });

  it('§7.7 restores a once-per-round ability at the start of the next round', () => {
    let s = game();
    const p = active(s);
    const buddy = spawnSurvivor(s, NOW, p, 'sv-buddy-davis', COLONY, false);
    const ability = contentOf(s).survivors.get('sv-buddy-davis')!.ability!;
    expect(ability.usage).toBe('oncePerRound');
    expect(ability.dieThreshold).toBeNull();
    survivorsOfPlayer(s, p)[0]!.wounds = 1;

    s = accepts(s, p, { type: 'useAbility', survivorId: buddy.id, abilityId: 'buddy-heal' });
    while (pending(s)) s = answerFirstLegal(s);
    rejects(
      s,
      p,
      { type: 'useAbility', survivorId: buddy.id, abilityId: 'buddy-heal' },
      /used up this round/i,
    );

    s = turnOf(nextRound(s), p);
    expect(s.round).toBe(2);
    // §7.7: the used state is retained "for the entire round" — and no longer.
    isLegal(s, p, { type: 'useAbility', survivorId: buddy.id, abilityId: 'buddy-heal' });
  });
});
