/**
 * Strict A14 public-boundary evidence for the §18.4 crossroads rulings that
 * still needed fixture-free proof.
 *
 * This file deliberately knows only the GamePlugin contract. Every game here is
 * created by `deadOfWinter.createGame` (which registers the shipping BASE_PACK),
 * every decision is answered by an action that `deadOfWinter.validateAction`
 * accepted, and every observation is read from a state the plugin returned —
 * or, where the ruling is about what a client is shown, from
 * `deadOfWinter.redactStateFor`. No TEST_PACK, no engine helper, no mutation of
 * a returned state.
 *
 * Four §18.4 rulings are covered:
 *
 *  - "Resolve movement and its exposure before checking a movement trigger."
 *  - "`Outbreak` is voted on only by players with at least one survivor at the
 *    colony."
 *  - "The player holding/drawing `This Taste Funny` is not intended to trigger
 *    it themselves."
 *  - "Read all option outcomes before the affected player chooses" — including
 *    that an illegal option is *shown* and then *refused by the server*, rather
 *    than hidden.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameSettings, GameState, PendingChoice, PlayerId } from '../../types.js';

const NOW = 1_000;
const COLORS = ['ember', 'frost', 'moss', 'rust', 'violet'] as const;

/* ------------------------------------------------------------------ *
 * Public boundary
 * ------------------------------------------------------------------ */

function seats(count: number): SeatSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${index + 1}`,
    name: `P${index + 1}`,
    color: COLORS[index % COLORS.length]!,
    isBot: false,
  }));
}

function settings(patch: Record<string, unknown>): GameSettings {
  const parsed = deadOfWinter.parseSettingsPatch(patch);
  expect(parsed).not.toBeNull();
  const result = { ...deadOfWinter.defaultSettings(), ...parsed };
  expect(deadOfWinter.validateSettings(result, result.playerCount)).toMatchObject({ ok: true });
  return result;
}

function parseAction(raw: unknown): GameAction {
  const action = deadOfWinter.parseAction(raw);
  expect(action).not.toBeNull();
  return action!;
}

function legal(state: GameState, playerId: PlayerId, raw: unknown): boolean {
  return deadOfWinter.validateAction(state, playerId, parseAction(raw)).ok;
}

function applyPublic(state: GameState, playerId: PlayerId, raw: unknown): GameState {
  const action = parseAction(raw);
  const verdict = deadOfWinter.validateAction(state, playerId, action);
  if (!verdict.ok) throw new Error(`Public action rejected: ${verdict.reason}`);
  return deadOfWinter.applyAction(state, playerId, action, NOW);
}

function rejectPublic(state: GameState, playerId: PlayerId, raw: unknown, reason: RegExp): void {
  const action = parseAction(raw);
  const verdict = deadOfWinter.validateAction(state, playerId, action);
  expect(verdict).toMatchObject({ ok: false });
  if (!verdict.ok) expect(verdict.reason).toMatch(reason);
}

function context(label: string, seed: string): CreateGameContext {
  return {
    gameId: `strict-a14-crossroads-${label}-${seed}`,
    code: 'A14XR',
    hostId: 'p1' as PlayerId,
    seed,
    now: NOW,
  };
}

function create(seed: string, patch: Record<string, unknown>, playerCount: number): GameState {
  const gameSettings = settings({ ...patch, playerCount });
  return deadOfWinter.createGame(context('xr', seed), gameSettings, seats(playerCount));
}

function firstLegalOptions(choice: PendingChoice): string[] {
  const options = choice.options.filter((option) => option.legal);
  const count = Math.max(1, choice.minPicks ?? 1);
  expect(options.length).toBeGreaterThanOrEqual(count);
  return options.slice(0, count).map((option) => option.id);
}

/** Answers exactly one open decision — a vote commitment, or a pending choice. */
function settleOne(state: GameState): GameState {
  if (state.vote) {
    const voter = state.vote.electorate.find((id) => state.vote!.votes[id] === undefined);
    if (voter) return applyPublic(state, voter, { type: 'castVote', vote: false });
  }
  const choice = state.pendingChoices[0];
  if (!choice) return state;
  if (choice.playerId === null) {
    throw new Error(`Public choice '${choice.kind}' has no player and no open vote.`);
  }
  return applyPublic(state, choice.playerId, {
    type: 'resolveChoice',
    choiceId: choice.id,
    optionIds: firstLegalOptions(choice),
  });
}

/** Answers every decision the plugin currently exposes, including open votes. */
function settle(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 400; guard += 1) {
    if (!current.vote && current.pendingChoices.length === 0) return current;
    current = settleOne(current);
  }
  throw new Error('settle(): public decision queue did not settle');
}

/** Drives §4 setup to `playerTurns` using only plugin-visible options. */
function finishSetup(state: GameState): GameState {
  let current = state;
  for (let guard = 0; current.phase === 'setup' && guard < 200; guard += 1) {
    const choice = current.pendingChoices[0];
    expect(choice).toBeDefined();
    expect(choice!.playerId).not.toBeNull();
    current = applyPublic(current, choice!.playerId!, {
      type: 'resolveChoice',
      choiceId: choice!.id,
      optionIds: firstLegalOptions(choice!),
    });
  }
  expect(current.phase).toBe('playerTurns');
  expect(current.turn).not.toBeNull();
  return current;
}

function startGame(label: string, attempt: number, patch: Record<string, unknown>, playerCount: number) {
  return finishSetup(create(`A14-XR-${label}-${attempt}`, patch, playerCount));
}

/* ------------------------------------------------------------------ *
 * Reading the public projection
 * ------------------------------------------------------------------ */

function logIndex(
  state: GameState,
  event: string,
  from: number,
  predicate: (data: Record<string, unknown>) => boolean = () => true,
): number {
  return state.log.findIndex(
    (entry, index) => index >= from && entry.data?.event === event && predicate(entry.data),
  );
}

function logEvents(state: GameState, event: string) {
  return state.log.filter((entry) => entry.data?.event === event);
}

function zombiesAtColony(state: GameState): number {
  return state.colony.entrances.reduce((total, entrance) => total + entrance.zombies, 0);
}

function barricadesAtColony(state: GameState): number {
  return state.colony.entrances.reduce((total, entrance) => total + entrance.barricades, 0);
}

/**
 * True when an incoming colony zombie must land as a zombie, whichever
 * entrance §12's cycle picks — so a board delta is a clean observation.
 */
function everyColonyEntranceHasRoom(state: GameState): boolean {
  return state.colony.entrances.every(
    (entrance) => entrance.capacity - entrance.zombies - entrance.barricades > 0,
  );
}

/** Players the §18.4 electorate rule entitles to vote on `Outbreak`. */
function colonyElectorate(state: GameState): PlayerId[] {
  const present = new Set(
    Object.values(state.survivors)
      .filter((survivor) => survivor.location === 'colony')
      .map((survivor) => survivor.controllerId),
  );
  return state.seating.filter((id) => present.has(id) && !state.players[id]!.exiled);
}

/** The pending crossroads decision, if the plugin is showing one. */
function crossroadsChoice(state: GameState): PendingChoice | undefined {
  return state.pendingChoices.find(
    (choice) => choice.kind === 'effectOption' && choice.data?.source === 'crossroads',
  );
}

/* ------------------------------------------------------------------ *
 * §18.4 — "Resolve movement and its exposure before checking a movement
 * trigger."
 * ------------------------------------------------------------------ */

/** Base-pack crossroads whose trigger is a completed move. */
const MOVE_TRIGGERED = ['xr-move-test', 'xr-f24', 'xr-f25', 'xr-f26', 'xr-f27', 'xr-f28', 'xr-f29', 'xr-f30', 'xr-f73'];

interface MoveProbe {
  state: GameState;
  active: PlayerId;
  survivor: string;
  cardId: string;
  logBefore: number;
}

/**
 * Finds a real first turn whose held crossroads card triggers on a completed
 * move, then performs exactly one public `moveSurvivor` and hands back the
 * state the plugin returned, untouched.
 */
function probeMove(label: string, accept: (probe: MoveProbe) => boolean): MoveProbe {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const state = startGame(label, attempt, { mainObjectiveId: 'mo-stockpile' }, 3);
    const cardId = state.turn?.crossroadsCardId;
    if (!cardId || !MOVE_TRIGGERED.includes(cardId)) continue;
    // Nothing may already be pending, so the only decision the move can open is
    // the one the move itself caused.
    if (state.pendingChoices.length > 0) continue;
    const active = state.turn!.playerId;
    const survivor = Object.values(state.survivors).find(
      (candidate) => candidate.controllerId === active && candidate.location === 'colony',
    );
    if (!survivor) continue;
    const move = { type: 'moveSurvivor', survivorId: survivor.id, to: 'school' };
    if (!legal(state, active, move)) continue;
    const probe: MoveProbe = {
      state: applyPublic(state, active, move),
      active,
      survivor: survivor.id,
      cardId,
      logBefore: state.log.length,
    };
    if (accept(probe)) return probe;
  }
  throw new Error(`No naturally dealt public move-trigger setup found for '${label}'.`);
}

describe('strict A14 §18.4 movement resolves before its crossroads trigger', () => {
  it('applies the move and the wound its exposure caused before the card triggers', () => {
    // The exposure must have *done* something, so the ordering assertion below
    // covers the whole of "movement and its exposure", not just the roll.
    const probe = probeMove('move-before-trigger', (candidate) => {
      const moved = candidate.state.survivors[candidate.survivor];
      if (!moved || moved.location !== 'school') return false;
      if (!crossroadsChoice(candidate.state)) return false;
      const face = candidate.state.log
        .filter((entry, index) => index >= candidate.logBefore && entry.data?.event === 'exposure')
        .at(-1)?.data?.face;
      return face === 'wound' || face === 'frostbite';
    });
    const { state, survivor, cardId, logBefore } = probe;

    // The trigger has fired and the card is revealed, but nobody has answered
    // it yet — this is exactly the instant §18.4 legislates about.
    const choice = crossroadsChoice(state)!;
    expect(state.turn!.crossroadsTriggered).toBe(true);
    expect(choice.data).toMatchObject({ cardId, source: 'crossroads' });

    // 1. The movement is applied and the wound is on the survivor's card while
    //    the crossroads decision is still open.
    expect(state.survivors[survivor]!.location).toBe('school');
    expect(state.survivors[survivor]!.movedThisTurn).toBe(true);
    expect(state.survivors[survivor]!.wounds + state.survivors[survivor]!.frostbite).toBeGreaterThan(0);

    // 2. The move, the arrival exposure it queued, and the wound that exposure
    //    inflicted are all in the log ahead of the trigger. An engine that
    //    tested the trigger inline — before committing the move, or before
    //    resolving exposure — would order these the other way round.
    const move = logIndex(state, 'move', logBefore, (data) => data.survivorId === survivor);
    const exposure = logIndex(state, 'exposure', logBefore, (data) => data.survivorId === survivor);
    const wound = logIndex(state, 'wound', logBefore, (data) => data.survivorId === survivor);
    const triggered = logIndex(state, 'crossroadsTriggered', logBefore, (data) => data.cardId === cardId);
    expect(move).toBeGreaterThanOrEqual(0);
    expect(state.log[move]!.data).toMatchObject({ to: 'school' });
    expect(exposure).toBeGreaterThan(move);
    expect(wound).toBeGreaterThan(exposure);
    expect(triggered).toBeGreaterThan(wound);

    // 3. The move is the only completed action so far, so the trigger cannot
    //    have come from anything else this turn.
    expect(logEvents(state, 'crossroadsTriggered')).toHaveLength(1);
    expect(state.log[triggered]!.data).toMatchObject({ cardId });
  });

  it('does not trigger when the arrival exposure kills the mover, though the move itself resolved', () => {
    const probe = probeMove(
      'move-death-cancels-trigger',
      (candidate) => candidate.state.survivors[candidate.survivor] === undefined,
    );
    const { state, survivor, cardId, logBefore } = probe;

    // The movement resolved: it is in the log, and so is the exposure roll that
    // killed the mover on arrival.
    const move = logIndex(state, 'move', logBefore, (data) => data.survivorId === survivor);
    const exposure = logIndex(state, 'exposure', logBefore, (data) => data.survivorId === survivor);
    const died = logIndex(state, 'survivorDied', logBefore, (data) => data.survivorId === survivor);
    expect(state.log[move]!.data).toMatchObject({ to: 'school' });
    expect(exposure).toBeGreaterThan(move);
    expect(state.log[exposure]!.data).toMatchObject({ face: 'bitten' });
    expect(died).toBeGreaterThan(exposure);

    // Because the trigger is tested only after movement *and* exposure have
    // resolved, the mover is gone by then and the card does not trigger.
    expect(state.turn!.crossroadsTriggered).toBe(false);
    expect(crossroadsChoice(state)).toBeUndefined();
    expect(logEvents(state, 'crossroadsTriggered')).toHaveLength(0);

    // §10: an untriggered card is still held, and goes to the bottom of the
    // deck when the turn ends rather than being removed from the game.
    expect(state.turn!.crossroadsCardId).toBe(cardId);
    expect(state.decks.crossroads).not.toContain(cardId);
    const ended = settle(applyPublic(settle(state), probe.active, { type: 'endTurn' }));
    expect(ended.decks.crossroads.filter((id) => id === cardId)).toEqual([cardId]);
    expect(ended.decks.crossroads.at(-1)).toBe(cardId);
    expect(logEvents(ended, 'crossroadsTriggered').some((entry) => entry.data?.cardId === cardId)).toBe(
      false,
    );
  });
});

/* ------------------------------------------------------------------ *
 * §18.4 — "`Outbreak` is voted on only by players with at least one survivor
 * at the colony."
 * ------------------------------------------------------------------ */

interface OutbreakSetup {
  state: GameState;
  electorate: PlayerId[];
  absent: PlayerId[];
}

/**
 * Plays real turns until `Outbreak` is the held card on a turn where at least
 * one seated player has no survivor left at the colony.
 *
 * The absence is produced legally: on p2's turns, p2 walks every colony
 * survivor out to the school through the public move action.
 */
function outbreakWithAbsentPlayer(): OutbreakSetup {
  const victim = 'p2' as PlayerId;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    let state = startGame('outbreak-electorate', attempt, { mainObjectiveId: 'mo-stockpile' }, 3);

    for (let step = 0; step < 400; step += 1) {
      if (state.phase !== 'playerTurns') break;

      // Checked before anything is answered, so the card's own decision is
      // still open when the position is captured.
      if (state.turn?.crossroadsCardId === 'xr-outbreak' && crossroadsChoice(state)) {
        const electorate = colonyElectorate(state);
        const absent = state.seating.filter((id) => !electorate.includes(id));
        const anyExiled = state.seating.some((id) => state.players[id]!.exiled);
        // A full electorate proves nothing — it would be indistinguishable from
        // "everyone votes" — and a full colony would hide the onFail zombie.
        if (electorate.length > 0 && absent.length > 0 && !anyExiled && everyColonyEntranceHasRoom(state)) {
          return { state, electorate, absent };
        }
      }

      if (state.vote || state.pendingChoices.length > 0) {
        state = settleOne(state);
        continue;
      }

      const active = state.turn!.playerId;
      if (active === victim) {
        const stayer = Object.values(state.survivors).find(
          (candidate) => candidate.controllerId === victim && candidate.location === 'colony',
        );
        const move = stayer && { type: 'moveSurvivor', survivorId: stayer.id, to: 'school' };
        if (move && legal(state, victim, move)) {
          state = applyPublic(state, victim, move);
          continue;
        }
      }
      state = applyPublic(state, active, { type: 'endTurn' });
    }
  }
  throw new Error('No public Outbreak turn with an absent player found.');
}

describe('strict A14 §18.4 Outbreak is voted on only by players with a colony survivor', () => {
  it('seats exactly the colony-present players, refuses the absent one, and finishes without them', () => {
    const setup = outbreakWithAbsentPlayer();
    let state = setup.state;
    const { electorate, absent } = setup;
    const active = state.turn!.playerId;

    // Sanity on the position the search found: somebody really is away.
    expect(absent.length).toBeGreaterThan(0);
    expect(electorate.length).toBeGreaterThan(0);
    for (const id of absent) {
      expect(
        Object.values(state.survivors).some(
          (survivor) => survivor.controllerId === id && survivor.location === 'colony',
        ),
      ).toBe(false);
    }

    // The card's single option is taken by the active player; the vote it
    // creates is where the §18.4 electorate ruling lives.
    const choice = crossroadsChoice(state)!;
    expect(choice.data).toMatchObject({ cardId: 'xr-outbreak' });
    expect(choice.options.map((option) => option.id)).toEqual(['quarantine']);
    const zombiesBefore = zombiesAtColony(state);
    state = applyPublic(state, choice.playerId!, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: ['quarantine'],
    });

    expect(state.vote).not.toBeNull();
    expect([...state.vote!.electorate].sort()).toEqual([...electorate].sort());
    for (const id of absent) expect(state.vote!.electorate).not.toContain(id);

    const voteChoice = state.pendingChoices.find((candidate) => candidate.kind === 'vote');
    expect(voteChoice?.playerId).toBeNull();
    expect(voteChoice?.data).toMatchObject({ electorate: state.vote!.electorate });

    // The server refuses a vote from a player with nobody at the colony.
    for (const id of absent) {
      rejectPublic(state, id, { type: 'castVote', vote: true }, /not eligible to vote/i);
    }
    // Entitlement is decided by colony presence alone — not by seat, and not by
    // being the player whose turn revealed the card.
    expect(state.vote!.electorate.includes(active)).toBe(
      Object.values(state.survivors).some(
        (survivor) => survivor.controllerId === active && survivor.location === 'colony',
      ),
    );

    // Only the entitled players vote, and the vote nonetheless completes: the
    // electorate defines both who may answer and when the count is done.
    for (let index = 0; index < electorate.length; index += 1) {
      expect(state.vote).not.toBeNull();
      state = applyPublic(state, electorate[index]!, { type: 'castVote', vote: false });
    }
    expect(state.vote).toBeNull();

    const revealed = logEvents(state, 'voteRevealed').at(-1)!;
    expect(revealed.data).toMatchObject({ yes: 0, no: electorate.length });
    expect(Object.keys(revealed.data!.votes as Record<string, boolean>).sort()).toEqual(
      [...electorate].sort(),
    );

    // A unanimous "no" runs Outbreak's onFail branch, so the board moved.
    expect(zombiesAtColony(state)).toBe(zombiesBefore + 1);
  });
});

/* ------------------------------------------------------------------ *
 * §18.4 — "The player holding/drawing `This Taste Funny` is not intended to
 * trigger it themselves."
 * ------------------------------------------------------------------ */

interface TasteFunnySetup {
  state: GameState;
  active: PlayerId;
  holder: PlayerId;
  survivor: string;
}

/**
 * Finds a first turn holding `This Taste Funny`, walks the active player's
 * survivor out to the library, and performs the search that the card triggers
 * on — every step through a validated public action.
 */
function tasteFunnyTurn(): TasteFunnySetup {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    let state = startGame('taste-funny', attempt, { mainObjectiveId: 'mo-stockpile' }, 3);
    if (state.turn?.crossroadsCardId !== 'xr-this-taste-funny') continue;
    if (state.pendingChoices.length > 0) continue;
    const active = state.turn!.playerId;
    const holder = state.turn!.crossroadsHolderId;
    const survivor = Object.values(state.survivors).find(
      (candidate) => candidate.controllerId === active && candidate.location === 'colony',
    );
    if (!survivor) continue;

    const move = { type: 'moveSurvivor', survivorId: survivor.id, to: 'library' };
    if (!legal(state, active, move)) continue;
    state = applyPublic(state, active, move);
    // A move is not a search: the card must still be waiting.
    if (state.pendingChoices.length > 0) continue;
    if (state.survivors[survivor.id]?.location !== 'library') continue;
    if (state.turn!.crossroadsTriggered) continue;
    return { state, active, holder, survivor: survivor.id };
  }
  throw new Error('No public This Taste Funny search turn found.');
}

describe('strict A14 §18.4 This Taste Funny is never triggered by its holder', () => {
  it('is held by the seat to the active player’s right, who can neither trigger nor answer it', () => {
    const setup = tasteFunnyTurn();
    let state = setup.state;
    const { active, holder, survivor } = setup;

    // §10: the card is drawn and kept by the player on the active player's
    // right — structurally never the player it can apply to.
    expect(holder).not.toBe(active);
    const order = state.seating;
    expect(holder).toBe(order[(order.indexOf(active) - 1 + order.length) % order.length]);

    // The holder cannot take the very action the card triggers on, because a
    // crossroads card is only ever held during somebody else's turn. That is
    // the whole mechanism behind the ruling: there is no legal action sequence
    // in which the holder's own `search` reaches the trigger.
    const holderSurvivor = Object.values(state.survivors).find(
      (candidate) => candidate.controllerId === holder,
    );
    expect(holderSurvivor).toBeDefined();
    rejectPublic(
      state,
      holder,
      { type: 'moveSurvivor', survivorId: holderSurvivor!.id, to: 'library' },
      /not your turn/i,
    );
    rejectPublic(
      state,
      holder,
      { type: 'search', survivorId: holderSurvivor!.id, die: 6 },
      /not your turn/i,
    );
    // Nothing has triggered yet: a move is not the search this card watches for.
    expect(state.turn!.crossroadsTriggered).toBe(false);
    expect(logEvents(state, 'crossroadsTriggered')).toHaveLength(0);

    // The identity stays secret from the active player until it triggers, and
    // visible to the holder — §3's crossroads redaction.
    expect(deadOfWinter.redactStateFor(state, active).turn!.crossroadsCardId).toBe('hidden:crossroads');
    expect(deadOfWinter.redactStateFor(state, holder).turn!.crossroadsCardId).toBe(
      'xr-this-taste-funny',
    );

    // The *active* player searches, and that is what fires the card.
    const die = state.players[active]!.unusedDice.find((value) =>
      legal(state, active, { type: 'search', survivorId: survivor, die: value }),
    );
    expect(die).toBeDefined();
    state = applyPublic(state, active, { type: 'search', survivorId: survivor, die });
    const searchChoice = state.pendingChoices[0]!;
    expect(searchChoice.kind).toBe('searchDecision');
    const drawn = state.search!.drawn[0]!;
    state = applyPublic(state, active, {
      type: 'resolveChoice',
      choiceId: searchChoice.id,
      optionIds: [`keep:${drawn}`],
    });

    const triggered = logEvents(state, 'crossroadsTriggered').at(-1)!;
    expect(triggered.data).toMatchObject({ cardId: 'xr-this-taste-funny' });
    // The card resolves for the active player, not for the holder who drew it.
    expect(triggered.playerId).toBe(active);
    expect(triggered.playerId).not.toBe(holder);

    const choice = crossroadsChoice(state)!;
    expect(choice.playerId).toBe(active);
    expect(choice.playerId).not.toBe(holder);
    rejectPublic(
      state,
      holder,
      { type: 'resolveChoice', choiceId: choice.id, optionIds: ['eat'] },
      /not yours/i,
    );

    // The active player takes the outcome, and it lands on the colony.
    const foodBefore = state.colony.food;
    state = applyPublic(state, active, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: ['eat'],
    });
    expect(state.colony.food).toBe(foodBefore + 1);
    expect(state.turn!.crossroadsTriggered).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * §18.4 — "Read all option outcomes before the affected player chooses."
 * ------------------------------------------------------------------ */

/**
 * Finds a first turn holding `Gatehouse Rattle` while the colony holds no
 * zombies, so its first option's condition is genuinely unmet.
 */
function gatehouseRattleTurn(): GameState {
  for (let attempt = 0; attempt < 4_000; attempt += 1) {
    const state = startGame('read-all-options', attempt, { mainObjectiveId: 'mo-stockpile' }, 4);
    if (state.turn?.crossroadsCardId !== 'xr-f3') continue;
    if (zombiesAtColony(state) !== 0) continue;
    if (!crossroadsChoice(state)) continue;
    return state;
  }
  throw new Error('No public Gatehouse Rattle setup with an empty colony found.');
}

describe('strict A14 §18.4 every crossroads option is read out, and illegal ones are refused', () => {
  it('shows both options with their outcomes, marks the unmet one illegal, and the server rejects it', () => {
    let state = gatehouseRattleTurn();
    const chooser = state.turn!.playerId;
    const choice = crossroadsChoice(state)!;

    // The condition that makes one option illegal is a real board fact.
    expect(zombiesAtColony(state)).toBe(0);

    // Both options are present — the illegal one is shown, not hidden.
    expect(choice.playerId).toBe(chooser);
    expect(choice.prompt).toBe('Gatehouse Rattle');
    expect(choice.options.map((option) => option.id)).toEqual(['check-hinge', 'bar-door']);
    expect(choice.options[0]).toMatchObject({ legal: false });
    expect(choice.options[0]!.reason).toBeTruthy();
    expect(choice.options[1]).toMatchObject({ legal: true });
    expect(choice.options.every((option) => option.label.length > 0)).toBe(true);

    // "Read all option outcomes": the reveal log carries the full card text for
    // every option, and the chooser's own client view carries every outcome.
    const triggered = logEvents(state, 'crossroadsTriggered').at(-1)!;
    expect(triggered.data).toMatchObject({ cardId: 'xr-f3' });
    const readOut = triggered.data!.options as { id: string; text: string }[];
    expect(readOut.map((option) => option.id)).toEqual(['check-hinge', 'bar-door']);
    // The read-out is the whole card: the same text the chooser is offered, for
    // the unmet option as much as for the legal one.
    expect(readOut.map((option) => option.text)).toEqual(choice.options.map((option) => option.label));
    expect(readOut.every((option) => option.text.length > 0)).toBe(true);

    const chooserView = deadOfWinter.redactStateFor(state, chooser);
    const shownToChooser = chooserView.pendingChoices.find((candidate) => candidate.id === choice.id)!;
    expect(shownToChooser.options.map((option) => option.id)).toEqual(['check-hinge', 'bar-door']);
    expect(Object.keys(shownToChooser.outcomes ?? {}).sort()).toEqual(['bar-door', 'check-hinge']);
    expect(shownToChooser.options[0]).toMatchObject({ legal: false });

    // Every other seat sees the same two options, so the table can read the
    // whole card, but not the outcomes.
    const other = state.seating.find((id) => id !== chooser)!;
    const shownToOther = deadOfWinter
      .redactStateFor(state, other)
      .pendingChoices.find((candidate) => candidate.id === choice.id)!;
    expect(shownToOther.options.map((option) => option.id)).toEqual(['check-hinge', 'bar-door']);
    expect(shownToOther.outcomes).toBeUndefined();

    // Legality is enforced by the server, not by hiding the option from a
    // client that could simply send it anyway.
    rejectPublic(
      state,
      chooser,
      { type: 'resolveChoice', choiceId: choice.id, optionIds: ['check-hinge'] },
      /conditions for this option are not met/i,
    );
    // Refusing it changed nothing: the decision is still open and unanswered.
    expect(crossroadsChoice(state)!.id).toBe(choice.id);

    // Nor may another player answer it in the illegal option's place.
    rejectPublic(
      state,
      other,
      { type: 'resolveChoice', choiceId: choice.id, optionIds: ['bar-door'] },
      /not yours/i,
    );

    const barricadesBefore = barricadesAtColony(state);
    state = applyPublic(state, chooser, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: ['bar-door'],
    });
    expect(barricadesAtColony(state)).toBe(barricadesBefore + 1);
    expect(crossroadsChoice(state)).toBeUndefined();
    expect(zombiesAtColony(state)).toBe(0);
  });
});
