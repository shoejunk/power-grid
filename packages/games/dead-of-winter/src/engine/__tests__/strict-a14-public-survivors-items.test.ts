/**
 * Strict A14 public-boundary evidence for the survivor and item rulings which
 * still need fixture-free proof.
 *
 * This file deliberately knows only the GamePlugin contract. Every survivor,
 * item, zombie, die, wound, and replacement used here comes from setup or an
 * action accepted by `deadOfWinter`; no TEST_PACK, engine helper, or returned
 * state mutation is allowed.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameSettings, GameState, PendingChoice, PlayerId } from '../../types.js';

const NOW = 1_000;
const COLORS = ['ember', 'frost', 'moss', 'rust', 'violet'] as const;

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
  return { ...deadOfWinter.defaultSettings(), ...parsed };
}

function parseAction(raw: unknown): GameAction {
  const action = deadOfWinter.parseAction(raw);
  expect(action).not.toBeNull();
  return action!;
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
    gameId: `strict-a14-public-${label}-${seed}`,
    code: 'A14PUB',
    hostId: 'p1' as PlayerId,
    seed,
    now: NOW,
  };
}

function create(seed: string, patch: Record<string, unknown>, playerCount: number): GameState {
  const gameSettings = settings({ ...patch, playerCount });
  return deadOfWinter.createGame(context('catalog', seed), gameSettings, seats(playerCount));
}

function firstLegalOptions(choice: PendingChoice, preferred: readonly string[] = []): string[] {
  const legal = choice.options.filter((option) => option.legal);
  const count = Math.max(1, choice.minPicks ?? 1);
  expect(legal.length).toBeGreaterThanOrEqual(count);
  return [...preferred, ...legal.map((option) => option.id)]
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, count);
}

/** Resolve only decisions exposed by the plugin, including simultaneous votes. */
function settle(state: GameState, preferred: readonly string[] = []): GameState {
  let current = state;
  for (let guard = 0; guard < 300; guard += 1) {
    if (current.vote) {
      const voter = current.vote.electorate.find((id) => current.vote!.votes[id] === undefined);
      if (voter) {
        current = applyPublic(current, voter, { type: 'castVote', vote: false });
        continue;
      }
    }

    const choice = current.pendingChoices[0];
    if (!choice) return current;
    if (choice.playerId === null) {
      throw new Error(`Public choice '${choice.kind}' has no player and no open vote.`);
    }
    current = applyPublic(current, choice.playerId, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: firstLegalOptions(choice, preferred),
    });
  }
  throw new Error('settle(): public decision queue did not settle');
}

function finishSetup(state: GameState, preferredCards: readonly string[] = []): GameState {
  let current = state;
  for (let guard = 0; current.phase === 'setup' && guard < 100; guard += 1) {
    const choice = current.pendingChoices[0];
    expect(choice).toBeDefined();
    expect(choice!.playerId).not.toBeNull();

    let optionIds: string[];
    if (choice!.kind === 'setupKeepSurvivors') {
      const preferred = preferredCards
        .map((cardId) => choice!.options.find((option) => option.id === cardId)?.id)
        .filter((id): id is string => id !== undefined);
      optionIds = [...preferred, ...firstLegalOptions(choice!)]
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, choice!.minPicks ?? 1);
    } else {
      optionIds = firstLegalOptions(choice!);
    }

    current = applyPublic(current, choice!.playerId!, {
      type: 'resolveChoice',
      choiceId: choice!.id,
      optionIds,
    });
  }
  expect(current.phase).toBe('playerTurns');
  return current;
}

interface GroupSetup {
  state: GameState;
  owner: PlayerId;
}

/**
 * Finds a naturally dealt setup in which one player's keep choice contains
 * every requested survivor, then answers every setup choice through the plugin.
 */
function setupGroupForSeed(
  seed: string,
  patch: Record<string, unknown>,
  playerCount: number,
  requiredCards: readonly string[],
): GroupSetup | null {
  const initial = create(seed, patch, playerCount);
  const target = initial.pendingChoices.find(
    (choice) =>
      choice.kind === 'setupKeepSurvivors' &&
      requiredCards.every((cardId) => choice.options.some((option) => option.id === cardId)),
  );
  if (!target || target.playerId === null) return null;

  let current = initial;
  for (let guard = 0; current.phase === 'setup' && guard < 100; guard += 1) {
    const choice = current.pendingChoices[0];
    if (!choice || choice.playerId === null) return null;

    if (choice.kind === 'setupKeepSurvivors') {
      const preferred = choice.playerId === target.playerId ? requiredCards : [];
      const preferredIds = preferred
        .map((cardId) => choice.options.find((option) => option.id === cardId)?.id)
        .filter((id): id is string => id !== undefined);
      const count = choice.minPicks ?? 1;
      const optionIds = [...preferredIds, ...firstLegalOptions(choice)]
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, count);
      if (optionIds.length !== count) return null;
      current = applyPublic(current, choice.playerId, {
        type: 'resolveChoice',
        choiceId: choice.id,
        optionIds,
      });
    } else {
      current = applyPublic(current, choice.playerId, {
        type: 'resolveChoice',
        choiceId: choice.id,
        optionIds: firstLegalOptions(choice),
      });
    }
  }

  if (current.phase !== 'playerTurns') return null;
  const owner = target.playerId as PlayerId;
  const owned = Object.values(current.survivors).filter((survivor) => survivor.controllerId === owner);
  if (!requiredCards.every((cardId) => owned.some((survivor) => survivor.cardId === cardId))) return null;
  return { state: current, owner };
}

function setupAnyForSeed(seed: string, patch: Record<string, unknown>, playerCount: number): GameState {
  return finishSetup(create(seed, patch, playerCount));
}

function survivorId(state: GameState, playerId: PlayerId, cardId: string): string | undefined {
  return Object.values(state.survivors).find(
    (survivor) => survivor.controllerId === playerId && survivor.cardId === cardId,
  )?.id;
}

function itemId(state: GameState, playerId: PlayerId, cardId: string): string | undefined {
  return state.players[playerId]!.hand.find((iid) => state.items[iid]?.cardId === cardId);
}

function itemInHand(state: GameState, playerId: PlayerId, iid: string): boolean {
  return state.players[playerId]!.hand.includes(iid);
}

function equippedTo(state: GameState, survivor: string, iid: string): boolean {
  return state.survivors[survivor]?.equipped.includes(iid) ?? false;
}

function eventLog(state: GameState, event: string) {
  return state.log.filter((entry) => entry.data?.event === event);
}

function reachTurn(state: GameState, playerId: PlayerId): GameState {
  let current = settle(state);
  for (let guard = 0; guard < 300; guard += 1) {
    if (current.phase === 'gameOver') throw new Error('The public search reached game over.');
    if (current.phase === 'playerTurns' && current.activePlayerId === playerId) return current;
    const active = current.activePlayerId;
    if (!active) throw new Error('The public game has no active player.');
    current = applyPublic(current, active, { type: 'endTurn' });
    current = settle(current);
  }
  throw new Error(`Could not reach ${playerId}'s public turn.`);
}

function completeRound(state: GameState): GameState {
  const startingRound = state.round;
  let current = settle(state);
  for (let guard = 0; guard < 500; guard += 1) {
    if (current.phase === 'gameOver') throw new Error('The public round ended the game unexpectedly.');
    if (current.round > startingRound) return current;
    const active = current.activePlayerId;
    if (!active) throw new Error('The public round has no active player.');
    current = applyPublic(current, active, { type: 'endTurn' });
    current = settle(current);
  }
  throw new Error('completeRound(): public round did not finish');
}

function moveAndSettle(state: GameState, playerId: PlayerId, survivor: string, to: string): GameState {
  return settle(applyPublic(state, playerId, { type: 'moveSurvivor', survivorId: survivor, to }));
}

function groupForSeed(
  label: string,
  patch: Record<string, unknown>,
  playerCount: number,
  requiredCards: readonly string[],
  accept: (candidate: GroupSetup) => GroupSetup | null = (candidate) => candidate,
): GroupSetup {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const candidate = setupGroupForSeed(
      `A14-STRICT-${label}-${attempt}`,
      patch,
      playerCount,
      requiredCards,
    );
    if (!candidate) continue;
    const accepted = accept(candidate);
    if (accepted) return accepted;
  }
  throw new Error(`No naturally dealt public setup found for '${label}'.`);
}

function itemGame(
  label: string,
  patch: Record<string, unknown>,
  playerCount: number,
  cardId: string,
  accept: (state: GameState, owner: PlayerId, iid: string) => boolean = () => true,
): { state: GameState; owner: PlayerId; iid: string } {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const state = setupAnyForSeed(`A14-STRICT-${label}-${attempt}`, patch, playerCount);
    for (const owner of state.seating) {
      const iid = itemId(state, owner, cardId);
      if (iid && accept(state, owner, iid)) return { state, owner, iid };
    }
  }
  throw new Error(`No naturally dealt public item setup found for '${label}'.`);
}

describe('strict A14 §18.3 survivor rulings through the public BASE_PACK boundary', () => {
  it('Edward White rejects a standalone ability, then combines a normal attack with two exposure-free kills', () => {
    let found: { state: GameState; owner: PlayerId; edward: string; medicine: string } | undefined;

    for (let attempt = 0; attempt < 2_000 && !found; attempt += 1) {
      const candidate = setupGroupForSeed(
        `A14-STRICT-edward-combo-${attempt}`,
        { mainObjectiveId: 'mo-stockpile' },
        3,
        ['sv-edward-white'],
      );
      if (!candidate) continue;

      let state = completeRound(settle(candidate.state));
      state = reachTurn(state, candidate.owner);
      const edward = survivorId(state, candidate.owner, 'sv-edward-white');
      const medicine = itemId(state, candidate.owner, 'it-first-aid');
      if (!edward || !medicine) continue;
      if (state.colony.entrances.reduce((total, entrance) => total + entrance.zombies, 0) < 3) continue;
      if (state.players[candidate.owner]!.unusedDice.filter((die) => die >= 3).length < 2) continue;
      found = { state, owner: candidate.owner, edward, medicine };
    }

    expect(found).toBeDefined();
    let state = found!.state;
    const { owner, edward, medicine } = found!;
    const qualifyingDie = state.players[owner]!.unusedDice.find((die) => die >= 3)!;
    rejectPublic(
      state,
      owner,
      { type: 'useAbility', survivorId: edward, abilityId: 'edward-clear', die: qualifyingDie },
      /normal attack|§18\.3/i,
    );

    const exposureBefore = eventLog(state, 'exposure').length;
    const attackDie = state.players[owner]!.unusedDice.find((die) => die >= 3)!;
    state = applyPublic(state, owner, { type: 'attackZombie', survivorId: edward, die: attackDie });
    expect(state.survivors[edward]?.edwardAttackPending).toBe(true);

    const abilityDie = state.players[owner]!.unusedDice.find((die) => die >= 3)!;
    state = applyPublic(state, owner, {
      type: 'useAbility',
      survivorId: edward,
      abilityId: 'edward-clear',
      die: abilityDie,
    });
    state = settle(state, [medicine]);

    expect(state.colony.entrances.reduce((total, entrance) => total + entrance.zombies, 0)).toBe(0);
    expect(eventLog(state, 'zombieKilled').slice(-3).map((entry) => entry.data)).toEqual([
      expect.objectContaining({ isAttack: true }),
      expect.objectContaining({ isAttack: false }),
      expect.objectContaining({ isAttack: false }),
    ]);
    expect(eventLog(state, 'exposure').slice(exposureBefore)).toEqual([]);
    expect(itemInHand(state, owner, medicine)).toBe(false);
    expect(state.colony.waste).toContain(medicine);
  });

  it('John Price gains after a completed non-colony move and loses copied abilities after moving away', () => {
    let found: { state: GameState; owner: PlayerId; john: string; buddy: string } | undefined;

    for (let attempt = 0; attempt < 2_000 && !found; attempt += 1) {
      const candidate = setupGroupForSeed(
        `A14-STRICT-john-movement-${attempt}`,
        { mainObjectiveId: 'mo-stockpile' },
        3,
        ['sv-john-price', 'sv-buddy-davis'],
      );
      if (!candidate) continue;
      let state = reachTurn(settle(candidate.state), candidate.owner);
      const john = survivorId(state, candidate.owner, 'sv-john-price');
      const buddy = survivorId(state, candidate.owner, 'sv-buddy-davis');
      if (!john || !buddy) continue;
      if ((state.survivors[john]!.copiedAbilityIds ?? []).length !== 0) continue;

      state = moveAndSettle(state, candidate.owner, buddy, 'school');
      if (!state.survivors[john] || !state.survivors[buddy]) continue;
      expect(state.survivors[john]!.copiedAbilityIds ?? []).toEqual([]);
      state = moveAndSettle(state, candidate.owner, john, 'school');
      if (!state.survivors[john] || !state.survivors[buddy]) continue;
      if (!(state.survivors[john]!.copiedAbilityIds ?? []).includes('buddy-heal')) continue;
      found = { state, owner: candidate.owner, john, buddy };
    }

    expect(found).toBeDefined();
    let state = found!.state;
    const { owner, john, buddy } = found!;
    expect(state.survivors[john]!.copiedAbilityIds).toContain('buddy-heal');

    state = reachTurn(applyPublic(state, owner, { type: 'endTurn' }), owner);
    state = moveAndSettle(state, owner, john, 'colony');
    expect(state.survivors[john]!.location).toBe('colony');
    expect(state.survivors[john]!.copiedAbilityIds).toEqual([]);
    expect(state.survivors[buddy]!.location).toBe('school');
  });

  it('John Price combines copied abilities, keeps his own once-per-round window, and names John for Forest Plum', () => {
    let found: { state: GameState; owner: PlayerId; john: string; buddy: string; forest: string } | undefined;

    for (let attempt = 0; attempt < 2_000 && !found; attempt += 1) {
      const candidate = setupGroupForSeed(
        `A14-STRICT-john-combination-${attempt}`,
        { mode: 'cooperative', mainObjectiveId: 'mo-stockpile' },
        2,
        ['sv-john-price', 'sv-buddy-davis', 'sv-forest-plum'],
      );
      if (!candidate) continue;
      let state = reachTurn(settle(candidate.state), candidate.owner);
      const john = survivorId(state, candidate.owner, 'sv-john-price');
      const buddy = survivorId(state, candidate.owner, 'sv-buddy-davis');
      const forest = survivorId(state, candidate.owner, 'sv-forest-plum');
      if (!john || !buddy || !forest) continue;
      if ((state.survivors[john]!.copiedAbilityIds ?? []).length !== 0) continue;

      state = moveAndSettle(state, candidate.owner, buddy, 'school');
      if (!state.survivors[john] || !state.survivors[buddy]) continue;
      state = moveAndSettle(state, candidate.owner, forest, 'school');
      if (!state.survivors[john] || !state.survivors[forest]) continue;
      state = moveAndSettle(state, candidate.owner, john, 'school');
      if (!state.survivors[john]) continue;
      const copied = state.survivors[john]!.copiedAbilityIds ?? [];
      if (!copied.includes('buddy-heal') || !copied.includes('forest-sacrifice')) continue;
      found = { state, owner: candidate.owner, john, buddy, forest };
    }

    expect(found).toBeDefined();
    let state = found!.state;
    const { owner, john, buddy, forest } = found!;
    expect(state.survivors[john]!.copiedAbilityIds).toEqual(
      expect.arrayContaining(['buddy-heal', 'forest-sacrifice']),
    );

    state = settle(
      applyPublic(state, owner, {
        type: 'useAbility',
        survivorId: buddy,
        abilityId: 'buddy-heal',
      }),
    );
    expect(state.survivors[buddy]!.usedThisRound).toContain('buddy-heal');

    const johnCopy = parseAction({
      type: 'useAbility',
      survivorId: john,
      abilityId: 'buddy-heal',
    });
    expect(deadOfWinter.validateAction(state, owner, johnCopy)).toMatchObject({ ok: true });
    state = settle(deadOfWinter.applyAction(state, owner, johnCopy, NOW));
    expect(state.survivors[john]!.usedThisRound).toContain('buddy-heal');
    rejectPublic(state, owner, { type: 'useAbility', survivorId: john, abilityId: 'buddy-heal' }, /used up this round/i);

    state = settle(
      applyPublic(state, owner, {
        type: 'useAbility',
        survivorId: john,
        abilityId: 'forest-sacrifice',
      }),
    );
    expect(state.survivors[john]).toBeUndefined();
    expect(state.survivors[forest]).toBeDefined();
  });
});

describe('strict A14 §13/§18.3 survivor timing through the public BASE_PACK boundary', () => {
  it('a naturally dealt Wanderer adds a survivor who may move later in the same turn', () => {
    let found: { state: GameState; owner: PlayerId; iid: string; added: string } | undefined;

    for (let attempt = 0; attempt < 2_000 && !found; attempt += 1) {
      let state = setupAnyForSeed(
        `A14-STRICT-added-survivor-${attempt}`,
        { mainObjectiveId: 'mo-stockpile' },
        3,
      );
      state = settle(state);
      const owner = state.seating.find((playerId) => itemId(state, playerId, 'it-wanderer'));
      if (!owner) continue;
      const iid = itemId(state, owner, 'it-wanderer');
      if (!iid) continue;
      state = reachTurn(state, owner);
      const before = new Set(Object.keys(state.survivors));
      state = settle(applyPublic(state, owner, { type: 'playItem', iid }));
      const added = Object.values(state.survivors).find(
        (survivor) => survivor.controllerId === owner && !before.has(survivor.id),
      );
      if (!added || added.location !== 'colony' || added.movedThisTurn) continue;
      const die = state.players[owner]!.unusedDice[0];
      if (die === undefined) continue;
      const move = parseAction({ type: 'moveSurvivor', survivorId: added.id, to: 'school' });
      if (!deadOfWinter.validateAction(state, owner, move).ok) continue;
      state = settle(deadOfWinter.applyAction(state, owner, move, NOW));
      if (state.survivors[added.id]?.location !== 'school') continue;
      found = { state, owner, iid, added: added.id };
    }

    expect(found).toBeDefined();
    expect(eventLog(found!.state, 'survivorAdded').at(-1)?.data).toMatchObject({
      survivorId: found!.added,
      playerId: found!.owner,
      location: 'colony',
    });
    expect(found!.state.survivors[found!.added]!.location).toBe('school');
    expect(found!.state.colony.waste).toContain(found!.iid);
  });

  it('documents the orphan-standee public-boundary blocker without fabricating an orphan fixture', () => {
    const state = settle(setupAnyForSeed('A14-STRICT-orphan-boundary', { mainObjectiveId: 'mo-stockpile' }, 3));
    const owner = state.activePlayerId!;
    const orphan = parseAction({ type: 'moveSurvivor', survivorId: 'orphan-a14', to: 'school' });

    expect(deadOfWinter.validateAction(state, owner, orphan)).toMatchObject({ ok: false });
    rejectPublic(state, owner, { type: 'moveSurvivor', survivorId: 'orphan-a14', to: 'school' }, /not on the board/i);
    expect(eventLog(state, 'contentError')).toEqual([]);
    // The public action algebra has no state/pack injection operation, so the
    // internal reconcileSpecialSurvivors() branch cannot be reached honestly.
  });
});

describe('strict A14 §18.5 item-instance state through the public BASE_PACK boundary', () => {
  it('keeps a once-per-round Baseball Bat spent through death, hand return, re-equip, and handoff', () => {
    let found: {
      state: GameState;
      owner: PlayerId;
      target: string;
      receiver: string;
      handoffReceiver: string;
      bat: string;
    } | undefined;

    for (let attempt = 0; attempt < 2_000 && !found; attempt += 1) {
      const setup = itemGame(
        `A14-STRICT-bat-death-${attempt}`,
        { mode: 'cooperative', mainObjectiveId: 'mo-watch-the-walls' },
        2,
        'it-baseball-bat',
      );
      let state = reachTurn(settle(setup.state), setup.owner);
      const ownerSurvivors = Object.values(state.survivors).filter(
        (survivor) => survivor.controllerId === setup.owner,
      );
      const target = ownerSurvivors.find((survivor) => !survivor.isLeader);
      const receiver = ownerSurvivors.find((survivor) => survivor.id !== target?.id);
      const handoffReceiver = Object.values(state.survivors).find(
        (survivor) => survivor.controllerId !== setup.owner && survivor.location === 'colony',
      );
      if (!target || !receiver || !handoffReceiver) continue;

      // The selected objective naturally supplies a colony zombie before the
      // first colony phase; the colony phase supplies more without a fixture.
      state = completeRound(state);
      state = reachTurn(state, setup.owner);
      if (state.colony.entrances.reduce((total, entrance) => total + entrance.zombies, 0) < 3) continue;
      state = applyPublic(state, setup.owner, {
        type: 'playItem',
        iid: setup.iid,
        targetSurvivorId: target.id,
      });

      state = settle(
        applyPublic(state, setup.owner, {
          type: 'useAbility',
          survivorId: target.id,
          abilityId: 'bat-swing',
          itemIid: setup.iid,
        }),
      );

      for (let attack = 0; state.survivors[target.id] && attack < 2; attack += 1) {
        const die = state.players[setup.owner]!.unusedDice.find((candidate) =>
          deadOfWinter.validateAction(
            state,
            setup.owner,
            parseAction({ type: 'attackZombie', survivorId: target.id, die: candidate }),
          ).ok,
        );
        if (die === undefined) break;
        state = settle(
          applyPublic(state, setup.owner, {
            type: 'attackZombie',
            survivorId: target.id,
            die,
          }),
        );
      }

      if (state.survivors[target.id]) continue;
      if (!state.items[setup.iid]?.usedThisRound.includes('bat-swing')) continue;
      if (!itemInHand(state, setup.owner, setup.iid)) continue;
      if (!state.survivors[receiver.id]) continue;

      state = applyPublic(state, setup.owner, {
        type: 'playItem',
        iid: setup.iid,
        targetSurvivorId: receiver.id,
      });
      if (!equippedTo(state, receiver.id, setup.iid)) continue;
      state = settle(
        applyPublic(state, setup.owner, {
          type: 'handOff',
          iid: setup.iid,
          toSurvivorId: handoffReceiver.id,
        }),
      );
      if (!equippedTo(state, handoffReceiver.id, setup.iid)) continue;
      found = {
        state,
        owner: setup.owner,
        target: target.id,
        receiver: receiver.id,
        handoffReceiver: handoffReceiver.id,
        bat: setup.iid,
      };
    }

    expect(found).toBeDefined();
    let state = found!.state;
    expect(state.survivors[found!.target]).toBeUndefined();
    expect(state.items[found!.bat]!.usedThisRound).toContain('bat-swing');
    expect(state.survivors[found!.receiver]!.equipped).not.toContain(found!.bat);
    expect(state.survivors[found!.handoffReceiver]!.equipped).toContain(found!.bat);
    state = reachTurn(state, state.survivors[found!.handoffReceiver]!.controllerId);
    rejectPublic(
      state,
      state.survivors[found!.handoffReceiver]!.controllerId,
      { type: 'useAbility', survivorId: found!.handoffReceiver, abilityId: 'bat-swing', itemIid: found!.bat },
      /used up this round/i,
    );
  });
});
