/**
 * A14's remaining §18 evidence at the public game-plugin boundary.
 *
 * The test driver deliberately knows only the persisted public state and the
 * actions accepted by `deadOfWinter`. It never imports TEST_PACK, private
 * engine helpers, or edits a returned state to arrange a fixture.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';
import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type {
  GameAction,
  GameSettings,
  GameState,
  PendingChoice,
  PlayerId,
} from '../../types.js';

const NOW = 1_000;
const SEAT_COLORS = ['ember', 'frost', 'moss', 'rust', 'violet'] as const;
const P1 = 'p1' as PlayerId;

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
    gameId: `a14-public-rulings-${seed}`,
    code: 'A14PUB',
    hostId: P1,
    seed,
    now: NOW,
  };
}

function settings(raw: Record<string, unknown>): GameSettings {
  const parsed = deadOfWinter.parseSettingsPatch(raw);
  expect(parsed).not.toBeNull();
  const result = { ...deadOfWinter.defaultSettings(), ...parsed };
  expect(deadOfWinter.validateSettings(result, result.playerCount)).toMatchObject({ ok: true });
  return result;
}

function parseAction(raw: unknown): GameAction {
  const parsed = deadOfWinter.parseAction(raw);
  expect(parsed).not.toBeNull();
  return parsed!;
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

function logEvents(state: GameState, event: string) {
  return state.log.filter((entry) => entry.data?.event === event);
}

function itemFor(state: GameState, playerId: PlayerId, cardId: string): string | undefined {
  return state.players[playerId]!.hand.find((iid) => state.items[iid]?.cardId === cardId);
}

function survivorFor(state: GameState, playerId: PlayerId, cardId: string): string | undefined {
  return Object.values(state.survivors).find(
    (survivor) => survivor.controllerId === playerId && survivor.cardId === cardId,
  )?.id;
}

function firstSurvivor(state: GameState, playerId: PlayerId): string {
  const survivor = Object.values(state.survivors).find((candidate) => candidate.controllerId === playerId);
  expect(survivor).toBeDefined();
  return survivor!.id;
}

function firstLegalOptions(choice: PendingChoice): string[] {
  const legal = choice.options.filter((option) => option.legal);
  const count = Math.max(1, choice.minPicks ?? 1);
  expect(legal.length).toBeGreaterThanOrEqual(count);
  return legal.slice(0, count).map((option) => option.id);
}

/** Resolve incidental public decisions without reaching into the reducer. */
function resolveIncidentalChoices(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 100; guard += 1) {
    const choice = current.pendingChoices[0];
    if (!choice) return current;
    const preferred =
      choice.kind === 'searchDecision'
        ? choice.options.find((option) => option.legal && option.id.startsWith('keep:'))
        : choice.kind === 'biteResponse'
          ? choice.options.find((option) => option.legal && option.id === 'roll')
          : undefined;
    const optionIds = preferred ? [preferred.id] : firstLegalOptions(choice);
    expect(choice.playerId).not.toBeNull();
    current = applyPublic(current, choice.playerId!, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds,
    });
  }
  throw new Error('resolveIncidentalChoices(): decision queue did not settle');
}

function finishSetup(initial: GameState, preferredSurvivors: readonly string[]): GameState {
  let current = initial;
  for (let guard = 0; current.phase === 'setup' && guard < 100; guard += 1) {
    const choice = current.pendingChoices[0];
    expect(choice).toBeDefined();
    const legal = choice!.options.filter((option) => option.legal);
    const preferred =
      choice!.kind === 'setupKeepSurvivors' && choice!.playerId === P1
        ? preferredSurvivors
            .map((cardId) => choice!.options.find((option) => option.id === cardId)?.id)
            .filter((id): id is string => id !== undefined)
        : choice!.kind === 'setupChooseLeader' && choice!.playerId === P1
          ? preferredSurvivors
              .map((cardId) =>
                choice!.options.find((option) => current.survivors[option.id]?.cardId === cardId)?.id,
              )
              .filter((id): id is string => id !== undefined)
          : [];
    const count = Math.max(1, choice!.minPicks ?? 1);
    const optionIds = [...preferred, ...legal.map((option) => option.id)]
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, count);
    expect(optionIds).toHaveLength(count);
    current = applyPublic(current, choice!.playerId!, {
      type: 'resolveChoice',
      choiceId: choice!.id,
      optionIds,
    });
  }
  expect(current.phase).toBe('playerTurns');
  expect(current.turn).not.toBeNull();
  return current;
}

interface PublicGameRequirements {
  label: string;
  patch: Record<string, unknown>;
  preferredSurvivors?: readonly string[];
  p1Items?: readonly string[];
  p1SecretObjective?: string;
  safeMoveCount?: number;
  safeBatUse?: boolean;
  check?: (state: GameState) => boolean;
}

/** Find a deterministic public setup that naturally deals the requested cards. */
function publicGame(requirements: PublicGameRequirements): GameState {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const seed = `A14-PUBLIC-RULINGS-${requirements.label}-${attempt}`;
    const gameSettings = settings(requirements.patch);
    const initial = deadOfWinter.createGame(
      context(seed),
      gameSettings,
      seats(gameSettings.playerCount),
    );
    const p1KeepChoice = initial.pendingChoices.find(
      (choice) => choice.kind === 'setupKeepSurvivors' && choice.playerId === P1,
    );
    if (
      requirements.preferredSurvivors &&
      !requirements.preferredSurvivors.every((cardId) =>
        p1KeepChoice?.options.some((option) => option.id === cardId),
      )
    ) {
      continue;
    }
    const current = finishSetup(initial, requirements.preferredSurvivors ?? []);
    if (current.activePlayerId !== P1) continue;
    if (
      requirements.p1Items &&
      !requirements.p1Items.every((cardId) => itemFor(current, P1, cardId) !== undefined)
    ) {
      continue;
    }
    if (
      requirements.p1SecretObjective &&
      !current.players[P1]!.secretObjectiveIds.includes(requirements.p1SecretObjective)
    ) {
      continue;
    }
    if (requirements.safeMoveCount) {
      let probe = current;
      let safe = true;
      for (let index = 0; index < requirements.safeMoveCount; index += 1) {
        const survivor = Object.values(probe.survivors).find(
          (candidate) => candidate.controllerId === P1 && candidate.location === 'colony',
        );
        if (!survivor) {
          safe = false;
          break;
        }
        const move = parseAction({ type: 'moveSurvivor', survivorId: survivor.id, to: 'school' });
        if (!deadOfWinter.validateAction(probe, P1, move).ok) {
          safe = false;
          break;
        }
        probe = deadOfWinter.applyAction(probe, P1, move, NOW);
        if (probe.pendingChoices.length > 0 || !probe.survivors[survivor.id]) {
          safe = false;
          break;
        }
      }
      if (!safe) continue;
    }
    if (requirements.safeBatUse) {
      const [giver, receiver] = survivorIdsFor(current, P1);
      const bat = itemFor(current, P1, 'it-baseball-bat');
      if (!giver || !receiver || !bat) continue;
      let probe = current;
      const attractDie = probe.players[P1]!.unusedDice[0];
      if (attractDie === undefined) continue;
      const attract = parseAction({
        type: 'attract',
        survivorId: giver,
        die: attractDie,
        from: 'grocery-store',
        count: 1,
      });
      if (!deadOfWinter.validateAction(probe, P1, attract).ok) continue;
      probe = deadOfWinter.applyAction(probe, P1, attract, NOW);
      const play = parseAction({ type: 'playItem', iid: bat, targetSurvivorId: giver });
      if (!deadOfWinter.validateAction(probe, P1, play).ok) continue;
      probe = deadOfWinter.applyAction(probe, P1, play, NOW);
      const use = parseAction({
        type: 'useAbility',
        survivorId: giver,
        abilityId: 'bat-swing',
        itemIid: bat,
      });
      if (!deadOfWinter.validateAction(probe, P1, use).ok) continue;
      probe = resolveIncidentalChoices(deadOfWinter.applyAction(probe, P1, use, NOW));
      if (!probe.survivors[giver]?.equipped.includes(bat) || !probe.survivors[receiver]) continue;
    }
    if (requirements.check && !requirements.check(current)) continue;
    return current;
  }
  throw new Error(`No public setup found for '${requirements.label}'.`);
}

function barricadesAtColony(state: GameState): number {
  return state.colony.entrances.reduce((total, entrance) => total + entrance.barricades, 0);
}

function zombiesAt(state: GameState, location: string): number {
  if (location === 'colony') {
    return state.colony.entrances.reduce((total, entrance) => total + entrance.zombies, 0);
  }
  return state.locations[location]!.entrance.zombies;
}

function survivorIdsFor(state: GameState, playerId: PlayerId): string[] {
  return Object.values(state.survivors)
    .filter((survivor) => survivor.controllerId === playerId)
    .map((survivor) => survivor.id);
}

function moveAndSettle(state: GameState, playerId: PlayerId, survivorId: string, to: string): GameState {
  const moved = applyPublic(state, playerId, { type: 'moveSurvivor', survivorId, to });
  return resolveIncidentalChoices(moved);
}

function searchDie(state: GameState, playerId: PlayerId, survivorId: string): number | undefined {
  for (const die of state.players[playerId]!.unusedDice) {
    const action = parseAction({ type: 'search', survivorId, die });
    if (deadOfWinter.validateAction(state, playerId, action).ok) return die;
  }
  return undefined;
}

function searchOnePublicCard(
  state: GameState,
  playerId: PlayerId,
): { state: GameState; iid: string } | null {
  let current = state;
  let survivor = Object.values(current.survivors).find(
    (candidate) => candidate.controllerId === playerId && candidate.location !== 'colony',
  );
  if (!survivor) {
    survivor = Object.values(current.survivors).find((candidate) => candidate.controllerId === playerId);
    if (!survivor) return null;
    const destination = 'school';
    if (survivor.location === 'colony') {
      current = moveAndSettle(current, playerId, survivor.id, destination);
      survivor = current.survivors[survivor.id];
      if (!survivor || survivor.location === 'colony') return null;
    }
  }
  const die = searchDie(current, playerId, survivor.id);
  if (die === undefined) return null;
  const before = new Set(current.players[playerId]!.hand);
  current = applyPublic(current, playerId, { type: 'search', survivorId: survivor.id, die });
  const choice = current.pendingChoices[0];
  expect(choice?.kind).toBe('searchDecision');
  const drawn = current.search?.drawn[0];
  expect(drawn).toBeDefined();
  current = applyPublic(current, playerId, {
    type: 'resolveChoice',
    choiceId: choice!.id,
    optionIds: [`keep:${drawn}`],
  });
  current = resolveIncidentalChoices(current);
  const iid = current.players[playerId]!.hand.find((candidate) => !before.has(candidate));
  expect(iid).toBeDefined();
  return { state: current, iid: iid! };
}

function endTurnPublic(state: GameState): GameState {
  let current = resolveIncidentalChoices(state);
  if (current.phase === 'gameOver') return current;
  const playerId = current.turn?.playerId;
  expect(playerId).toBeDefined();
  return applyPublic(current, playerId!, { type: 'endTurn' });
}

function finishToGameOver(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 500 && current.phase !== 'gameOver'; guard += 1) {
    current = endTurnPublic(current);
  }
  expect(current.phase).toBe('gameOver');
  return current;
}

function collectStockpileThroughSearch(
  state: GameState,
  excludedPlayers: readonly PlayerId[] = [],
): GameState {
  let current = state;
  for (let guard = 0; guard < 500 && current.mainObjective.contributions.length < 6; guard += 1) {
    current = resolveIncidentalChoices(current);
    expect(current.phase).toBe('playerTurns');
    const playerId = current.turn!.playerId;
    if (excludedPlayers.includes(playerId)) {
      current = endTurnPublic(current);
      continue;
    }
    const found = searchOnePublicCard(current, playerId);
    if (!found) {
      current = endTurnPublic(current);
      continue;
    }
    current = applyPublic(found.state, playerId, {
      type: 'contributeObjective',
      iids: [found.iid],
    });
  }
  expect(current.mainObjective.contributions.length).toBeGreaterThanOrEqual(6);
  return current;
}

describe('A14 §18.1 through the public Dead of Winter plugin', () => {
  it('Loretta Clay accepts a 5 die because her ability threshold is 4+', () => {
    let state = publicGame({
      label: 'loretta-4-plus',
      patch: { playerCount: 4, mainObjectiveId: 'mo-stockpile' },
      preferredSurvivors: ['sv-arthur-thurston', 'sv-loretta-clay'],
      check: (candidate) => candidate.players[P1]!.unusedDice.some((die) => die === 5),
    });
    const loretta = survivorFor(state, P1, 'sv-loretta-clay');
    expect(loretta).toBeDefined();
    const barricadesBefore = barricadesAtColony(state);
    state = applyPublic(state, P1, {
      type: 'useAbility',
      survivorId: loretta,
      abilityId: 'loretta-fix',
      die: 5,
    });
    expect(barricadesAtColony(state)).toBe(barricadesBefore + 1);
    expect(logEvents(state, 'ability').at(-1)?.data).toMatchObject({
      abilityId: 'loretta-fix',
      survivorId: loretta,
    });
  });

  it('Attract legally moves fewer than two zombies, including zero', () => {
    let state = publicGame({
      label: 'attract-fewer-than-two',
      patch: { playerCount: 4, mainObjectiveId: 'mo-we-need-more-samples' },
    });
    const survivor = firstSurvivor(state, P1);
    const beforeZero = zombiesAt(state, 'school');
    const zeroDie = state.players[P1]!.unusedDice[0]!;
    state = applyPublic(state, P1, {
      type: 'attract',
      survivorId: survivor,
      die: zeroDie,
      from: 'school',
      count: 0,
    });
    expect(zombiesAt(state, 'school')).toBe(beforeZero);

    const beforeOne = zombiesAt(state, 'school');
    const oneDie = state.players[P1]!.unusedDice[0]!;
    state = applyPublic(state, P1, {
      type: 'attract',
      survivorId: survivor,
      die: oneDie,
      from: 'school',
      count: 2,
    });
    expect(beforeOne).toBe(1);
    expect(zombiesAt(state, 'school')).toBe(0);
    expect(zombiesAt(state, 'colony')).toBe(1);
    expect(logEvents(state, 'attract').at(-1)?.data).toMatchObject({ count: 1 });
  });

  it('Old Divisions triggers publicly when the active player has a colony survivor and helpless survivor', () => {
    const state = publicGame({
      label: 'old-divisions-public-trigger',
      patch: {
        playerCount: 4,
        mainObjectiveId: 'mo-old-divisions-public',
        includeBetrayalObjective: false,
      },
      check: (candidate) =>
        candidate.turn?.crossroadsCardId === 'xr-old-divisions' &&
        candidate.pendingChoices.some((choice) => choice.kind === 'effectOption'),
    });
    expect(state.colony.helpless).toBe(1);
    expect(state.turn?.playerId).toBe(P1);
    const choice = state.pendingChoices.find((candidate) => candidate.kind === 'effectOption');
    expect(choice?.playerId).toBe(P1);
    expect(choice?.options.map((option) => option.id)).toEqual(['thumbs-up', 'thumbs-down']);
  });
});

describe('A14 §18.2 objective semantics through public actions', () => {
  it('Stockpile accepts multiple non-starter contributions collected by public searches', () => {
    let state = publicGame({
      label: 'stockpile-multiple-public-searches',
      patch: { playerCount: 4, mainObjectiveId: 'mo-stockpile' },
    });
    state = collectStockpileThroughSearch(state);
    expect(state.mainObjective.contributions).toHaveLength(6);
    expect(state.mainObjective.contributionsThisTurn).toBeGreaterThan(0);
    expect(state.mainObjective.contributions.every((iid) => !state.players[P1]!.hand.includes(iid))).toBe(
      true,
    );
    expect(state.mainObjective.contributions.every((iid) => state.items[iid]?.cardId.startsWith('it-'))).toBe(
      true,
    );
  });

  it('Hoarder wins only after a public Stockpile end check with strictly most cards', () => {
    let state = publicGame({
      label: 'hoarder-strict-most-public',
      patch: { playerCount: 4, mainObjectiveId: 'mo-stockpile' },
      preferredSurvivors: ['sv-arthur-thurston', 'sv-loretta-clay'],
      p1SecretObjective: 'so-n1',
      safeMoveCount: 1,
    });
    const searched = searchOnePublicCard(state, P1);
    expect(searched).not.toBeNull();
    state = endTurnPublic(searched!.state);
    state = collectStockpileThroughSearch(state, [P1]);
    state = finishToGameOver(state);

    const p1Result = state.outcome!.results.find((result) => result.playerId === P1);
    expect(state.players[P1]!.hand).toHaveLength(6);
    expect(state.seating.filter((playerId) => state.players[playerId]!.hand.length >= 6)).toEqual([P1]);
    expect(p1Result).toMatchObject({ secretObjectiveIds: ['so-n1'], objectiveComplete: true, won: true });
  });

  it('Hunger counts food cards rather than colony food tokens', () => {
    let state = publicGame({
      label: 'hunger-food-cards-public',
      patch: {
        playerCount: 4,
        mainObjectiveId: 'mo-stockpile',
        includeBetrayalObjective: false,
      },
      p1SecretObjective: 'so-hunger',
      check: (candidate) =>
        candidate.players[P1]!.hand.filter((iid) =>
          ['it-canned-food', 'it-soup-pot', 'it-dog-food', 'it-seed-packets', 'it-baby-formula'].includes(
            candidate.items[iid]?.cardId ?? '',
          ),
        ).length >= 3,
    });
    expect(state.colony.food).toBeLessThan(3);
    state = collectStockpileThroughSearch(state);
    state = finishToGameOver(state);
    const result = state.outcome!.results.find((candidate) => candidate.playerId === P1);
    expect(
      state.players[P1]!.hand.filter((iid) =>
        ['it-canned-food', 'it-soup-pot', 'it-dog-food', 'it-seed-packets', 'it-baby-formula'].includes(
          state.items[iid]?.cardId ?? '',
        ),
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(result).toMatchObject({
      secretObjectiveIds: ['so-hunger'],
      objectiveComplete: true,
      won: true,
    });
  });
});

describe('A14 §18.5 item identity and equipment rulings through public actions', () => {
  it('EVENT cards remain item instances when played through the public boundary', () => {
    let state = publicGame({
      label: 'event-outsider-item-identity',
      patch: { playerCount: 4, mainObjectiveId: 'mo-stockpile' },
      preferredSurvivors: ['sv-arthur-thurston'],
      p1Items: ['it-hostage'],
    });
    const eventIid = itemFor(state, P1, 'it-hostage');
    expect(eventIid).toBeDefined();

    state = applyPublic(state, P1, { type: 'playItem', iid: eventIid });
    state = resolveIncidentalChoices(state);

    expect(state.items[eventIid!]!.cardId).toBe('it-hostage');
    expect(state.colony.waste).toContain(eventIid);
  });

  it('OUTSIDER cards remain item instances when played through the public boundary', () => {
    let state = publicGame({
      label: 'outsider-item-identity',
      patch: { playerCount: 4, mainObjectiveId: 'mo-stockpile' },
      preferredSurvivors: ['sv-arthur-thurston'],
      p1Items: ['it-wanderer'],
    });
    const outsider = itemFor(state, P1, 'it-wanderer');
    expect(outsider).toBeDefined();
    state = applyPublic(state, P1, { type: 'playItem', iid: outsider });
    state = resolveIncidentalChoices(state);
    expect(state.items[outsider!]!.cardId).toBe('it-wanderer');
    expect(state.colony.waste).toContain(outsider);
  });

  it('Two copies of one item may be equipped to one survivor', () => {
    let state = publicGame({
      label: 'duplicate-item-equips',
      patch: { playerCount: 4, mainObjectiveId: 'mo-stockpile' },
      preferredSurvivors: ['sv-arthur-thurston'],
      p1Items: ['it-baseball-bat', 'it-baseball-bat-2'],
    });
    const survivor = firstSurvivor(state, P1);
    const bats = state.players[P1]!.hand.filter((iid) =>
      ['it-baseball-bat', 'it-baseball-bat-2'].includes(state.items[iid]?.cardId ?? ''),
    );
    expect(bats).toHaveLength(2);
    for (const iid of bats) {
      state = applyPublic(state, P1, {
        type: 'playItem',
        iid,
        targetSurvivorId: survivor,
      });
    }
    expect(state.survivors[survivor]!.equipped).toEqual(expect.arrayContaining(bats));
    expect(state.survivors[survivor]!.equipped.filter((iid) => bats.includes(iid))).toHaveLength(2);
  });

  it('Baseball Bat killing two zombies produces two exposure rolls', () => {
    let state = publicGame({
      label: 'baseball-bat-two-exposures',
      patch: { playerCount: 4, mainObjectiveId: 'mo-we-need-more-samples' },
      preferredSurvivors: ['sv-arthur-thurston'],
      p1Items: ['it-baseball-bat'],
      safeMoveCount: 1,
    });
    const survivor = firstSurvivor(state, P1);
    const bat = itemFor(state, P1, 'it-baseball-bat');
    expect(bat).toBeDefined();
    state = moveAndSettle(state, P1, survivor, 'school');
    const attractDie = state.players[P1]!.unusedDice[0]!;
    state = applyPublic(state, P1, {
      type: 'attract',
      survivorId: survivor,
      die: attractDie,
      from: 'grocery-store',
      count: 1,
    });
    state = applyPublic(state, P1, { type: 'playItem', iid: bat, targetSurvivorId: survivor });
    const exposureBefore = logEvents(state, 'exposure').length;
    state = applyPublic(state, P1, {
      type: 'useAbility',
      survivorId: survivor,
      abilityId: 'bat-swing',
      itemIid: bat,
    });
    state = resolveIncidentalChoices(state);
    expect(zombiesAt(state, 'school')).toBe(0);
    expect(logEvents(state, 'exposure').slice(exposureBefore)).toHaveLength(2);
  });

  it('Megaphone follows Attract capacity and moves zero zombies into a full destination', () => {
    let state = publicGame({
      label: 'megaphone-full-destination',
      patch: { playerCount: 4, mainObjectiveId: 'mo-we-need-more-samples' },
      preferredSurvivors: ['sv-arthur-thurston'],
      p1Items: ['it-megaphone'],
      safeMoveCount: 1,
    });
    const survivor = firstSurvivor(state, P1);
    const megaphone = itemFor(state, P1, 'it-megaphone');
    expect(megaphone).toBeDefined();
    state = moveAndSettle(state, P1, survivor, 'school');
    const sources = ['grocery-store', 'gas-station', 'library', 'hospital'];
    for (const source of sources) {
      const target = state.locations.school!.entrance;
      if (target.zombies >= target.capacity) break;
      if (zombiesAt(state, source) === 0) continue;
      const die = state.players[P1]!.unusedDice[0];
      if (die === undefined) break;
      state = applyPublic(state, P1, {
        type: 'attract',
        survivorId: survivor,
        die,
        from: source,
        count: 2,
      });
    }
    const fullTarget = state.locations.school!.entrance;
    expect(fullTarget.zombies).toBe(fullTarget.capacity);
    const sourceBefore = sources.map((source) => zombiesAt(state, source));
    const overrunBefore = logEvents(state, 'overrun').length;
    state = applyPublic(state, P1, {
      type: 'playItem',
      iid: megaphone,
      targetSurvivorId: survivor,
    });
    expect(sources.map((source) => zombiesAt(state, source))).toEqual(sourceBefore);
    expect(zombiesAt(state, 'school')).toBe(fullTarget.capacity);
    expect(logEvents(state, 'overrun').length).toBe(overrunBefore);
    expect(state.colony.waste).toContain(megaphone);
  });

  it('Switchblade lowers the attack requirement without replacing the attack', () => {
    let state = publicGame({
      label: 'switchblade-modifies-attack',
      patch: { playerCount: 4, mainObjectiveId: 'mo-we-need-more-samples' },
      preferredSurvivors: ['sv-arthur-thurston', 'sv-loretta-clay'],
      p1Items: ['it-switchblade'],
      safeMoveCount: 1,
      check: (candidate) => candidate.players[P1]!.unusedDice.includes(3),
    });
    const survivor = survivorFor(state, P1, 'sv-loretta-clay');
    const switchblade = itemFor(state, P1, 'it-switchblade');
    if (!survivor || !switchblade) {
      throw new Error('Switchblade fixture did not deal Loretta and the Switchblade item');
    }
    rejectPublic(
      state,
      P1,
      { type: 'attackZombie', survivorId: survivor, die: 3 },
      /needs a 4 or better/i,
    );
    state = applyPublic(state, P1, {
      type: 'playItem',
      iid: switchblade,
      targetSurvivorId: survivor,
    });
    state = moveAndSettle(state, P1, survivor, 'school');
    state = applyPublic(state, P1, {
      type: 'attackZombie',
      survivorId: survivor,
      die: 3,
    });
    expect(logEvents(state, 'zombieKilled').at(-1)?.data).toMatchObject({
      killerId: survivor,
      isAttack: true,
    });
  });

  it('once-per-round item usage remains spent after a public hand-off', () => {
    let state = publicGame({
      label: 'once-per-round-handoff-persistence',
      patch: { playerCount: 4, mainObjectiveId: 'mo-we-need-more-samples' },
      preferredSurvivors: ['sv-arthur-thurston'],
      p1Items: ['it-baseball-bat'],
      safeMoveCount: 2,
      safeBatUse: true,
    });
    const [giver, receiver] = survivorIdsFor(state, P1);
    const bat = itemFor(state, P1, 'it-baseball-bat');
    if (!giver || !receiver || !bat) {
      throw new Error('Handoff fixture did not deal two survivors and the Baseball Bat item');
    }
    state = moveAndSettle(state, P1, giver, 'school');
    state = moveAndSettle(state, P1, receiver, 'school');
    const attractDie = state.players[P1]!.unusedDice[0]!;
    state = applyPublic(state, P1, {
      type: 'attract',
      survivorId: giver,
      die: attractDie,
      from: 'grocery-store',
      count: 1,
    });
    state = applyPublic(state, P1, { type: 'playItem', iid: bat, targetSurvivorId: giver });
    state = applyPublic(state, P1, {
      type: 'useAbility',
      survivorId: giver,
      abilityId: 'bat-swing',
      itemIid: bat,
    });
    state = resolveIncidentalChoices(state);
    expect(state.items[bat!]!.usedThisRound).toContain('bat-swing');

    state = applyPublic(state, P1, { type: 'handOff', iid: bat, toSurvivorId: receiver });
    rejectPublic(
      state,
      P1,
      { type: 'useAbility', survivorId: receiver, abilityId: 'bat-swing', itemIid: bat },
      /used up this round/i,
    );
  });
});
