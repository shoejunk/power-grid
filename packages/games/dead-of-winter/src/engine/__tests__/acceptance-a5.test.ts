/**
 * Acceptance criterion §23.5.
 *
 * These are end-to-end rules-engine assertions: setup is completed through
 * real choices, player-facing mutations go through `applyAction`, and hidden
 * information is checked against the same redaction boundary used by clients.
 */

import { describe, expect, it } from 'vitest';

import type { GameState, PlayerId } from '../../types.js';
import { contentOf, redactStateFor, runColonyStep } from '../index.js';
import {
  NOW,
  act,
  choose,
  grantItem,
  lastLogEvent,
  pending,
  placeSurvivor,
  setDice,
  start,
  survivorsOfPlayer,
} from './helpers.js';

const game = (): GameState =>
  start({
    playerCount: 4,
    seed: 'ACCEPTANCE-A5',
    settings: { mainObjectiveId: 'mo-stockpile' },
  });

const active = (state: GameState): PlayerId => state.turn!.playerId;

/** Keep unrelated crossroads from interrupting an acceptance scenario. */
function quietTurn(state: GameState): void {
  if (state.turn) state.turn.crossroadsCardId = null;
}

describe('§23.5 search privacy and noise', () => {
  it('keeps 3+ inspected cards private, keeps a middle card, and bottoms all others in draw order', () => {
    let state = game();
    const searcherId = active(state);
    const observerId = state.seating.find((id) => id !== searcherId)!;
    const survivor = survivorsOfPlayer(state, searcherId)[0]!;
    placeSurvivor(state, survivor.id, 'school');
    setDice(state, searcherId, [6]);
    quietTurn(state);

    const deckBefore = [...state.locations['school']!.deck];
    const [firstDraw, secondDraw, thirdDraw] = deckBefore;
    expect(firstDraw).toBeTruthy();
    expect(secondDraw).toBeTruthy();
    expect(thirdDraw).toBeTruthy();

    state = act(state, searcherId, { type: 'search', survivorId: survivor.id, die: 6 });
    expect(state.search).toMatchObject({
      playerId: searcherId,
      survivorId: survivor.id,
      location: 'school',
      drawn: [firstDraw],
      noisePlaced: 0,
    });
    expect(state.players[searcherId]!.hand).not.toContain(firstDraw);
    expect(state.locations['school']!.deck).toHaveLength(deckBefore.length - 1);

    const ownerView = redactStateFor(state, searcherId);
    const observerView = redactStateFor(state, observerId);
    expect(ownerView.search!.drawn).toEqual([firstDraw]);
    expect(ownerView.items[firstDraw!]?.cardId).toBe(state.items[firstDraw!]!.cardId);
    expect(pending(ownerView)!.options.some((option) => option.id === `keep:${firstDraw}`)).toBe(true);
    expect(observerView.search!.drawn).toEqual(['hidden:search:0']);
    expect(observerView.items[firstDraw!]).toBeUndefined();
    expect(pending(observerView)).toMatchObject({
      kind: 'searchDecision',
      prompt: 'Waiting for a private decision.',
      options: [
        { id: 'hidden:0', label: '?', legal: true },
        { id: 'hidden:1', label: '?', legal: true },
      ],
    });
    expect(JSON.stringify(observerView)).not.toContain(firstDraw!);
    expect(observerView.log.some((entry) => entry.data?.['event'] === 'searchDraw')).toBe(false);

    state = choose(state, searcherId, pending(state)!.id, ['noise']);
    expect(state.locations['school']!.noise).toBe(1);
    expect(state.search).toMatchObject({ drawn: [firstDraw, secondDraw], noisePlaced: 1 });
    expect(state.locations['school']!.deck).toHaveLength(deckBefore.length - 2);

    const observerAfterNoise = redactStateFor(state, observerId);
    expect(observerAfterNoise.search!.drawn).toEqual(['hidden:search:0', 'hidden:search:1']);
    expect(observerAfterNoise.items[firstDraw!]).toBeUndefined();
    expect(observerAfterNoise.items[secondDraw!]).toBeUndefined();
    expect(JSON.stringify(observerAfterNoise)).not.toContain(firstDraw!);
    expect(JSON.stringify(observerAfterNoise)).not.toContain(secondDraw!);

    state = choose(state, searcherId, pending(state)!.id, ['noise']);
    expect(state.locations['school']!.noise).toBe(2);
    expect(state.search).toMatchObject({
      drawn: [firstDraw, secondDraw, thirdDraw],
      noisePlaced: 2,
    });
    expect(state.locations['school']!.deck).toHaveLength(deckBefore.length - 3);

    const observerAfterSecondNoise = redactStateFor(state, observerId);
    expect(observerAfterSecondNoise.search!.drawn).toEqual([
      'hidden:search:0',
      'hidden:search:1',
      'hidden:search:2',
    ]);
    for (const iid of [firstDraw, secondDraw, thirdDraw]) {
      expect(observerAfterSecondNoise.items[iid!]).toBeUndefined();
      expect(JSON.stringify(observerAfterSecondNoise)).not.toContain(iid!);
    }

    state = choose(state, searcherId, pending(state)!.id, [`keep:${secondDraw}`]);
    expect(state.search).toBeNull();
    expect(state.players[searcherId]!.hand).toContain(secondDraw);
    expect(state.players[searcherId]!.hand).not.toContain(firstDraw);
    expect(state.players[searcherId]!.hand).not.toContain(thirdDraw);
    expect(state.locations['school']!.deck.slice(-2)).toEqual([firstDraw, thirdDraw]);
    expect(state.locations['school']!.deck).not.toContain(secondDraw);

    const finalObserverView = redactStateFor(state, observerId);
    expect(finalObserverView.players[searcherId]!.hand).toHaveLength(
      state.players[searcherId]!.hand.length,
    );
    expect(finalObserverView.players[searcherId]!.hand.every((iid) => iid.startsWith('hidden:'))).toBe(
      true,
    );
    expect(finalObserverView.items[secondDraw!]).toBeUndefined();
    expect(JSON.stringify(finalObserverView)).not.toContain(secondDraw!);
  });

  it('makes further noise illegal independently when noise spaces are full or the deck is exhausted', () => {
    for (const blockedBy of ['noiseSpaces', 'deck'] as const) {
      let state = game();
      const playerId = active(state);
      const survivor = survivorsOfPlayer(state, playerId)[0]!;
      placeSurvivor(state, survivor.id, 'school');
      setDice(state, playerId, [6]);
      quietTurn(state);

      const location = state.locations['school']!;
      if (blockedBy === 'noiseSpaces') {
        location.noise = location.noiseSpaces;
        expect(location.deck.length).toBeGreaterThan(1);
      } else {
        location.noise = 0;
        location.deck = [location.deck[0]!];
      }

      state = act(state, playerId, { type: 'search', survivorId: survivor.id, die: 6 });
      const noise = pending(state)!.options.find((option) => option.id === 'noise')!;
      expect(noise).toMatchObject({ legal: false });
      expect(noise.reason).toMatch(/No empty noise space or no cards left/);
      if (blockedBy === 'noiseSpaces') {
        expect(state.locations['school']!.noise).toBe(state.locations['school']!.noiseSpaces);
        expect(state.locations['school']!.deck.length).toBeGreaterThan(0);
      } else {
        expect(state.locations['school']!.noise).toBe(0);
        expect(state.locations['school']!.deck).toEqual([]);
      }
    }
  });
});

describe('§23.5 crisis secrecy and scoring', () => {
  it('publishes contribution counts but hides every identity, then scores each card +1/-1 after a shuffle', () => {
    let state = game();
    state.crisis.cardId = 'cr-1'; // accepts weapon; its over-contribution effect is optional
    state.colony.morale = 8;
    state.colony.food = 20; // isolate crisis scoring from the earlier Pay Food step

    const accepted: string[] = [];
    const rejected: string[] = [];
    const contributedBy: Record<string, number> = {};

    for (let seat = 0; seat < state.seating.length; seat++) {
      const playerId = active(state);
      quietTurn(state);
      const iids =
        seat < 3
          ? [
              grantItem(state, playerId, 'it-switchblade'),
              grantItem(state, playerId, 'it-baseball-bat'),
            ]
          : [
              grantItem(state, playerId, 'it-hostage'),
              grantItem(state, playerId, 'it-canned-food'),
            ];
      if (seat < 3) accepted.push(...iids);
      else {
        accepted.push(iids[0]!);
        rejected.push(iids[1]!);
      }

      state = act(state, playerId, { type: 'contributeCrisis', iids });
      contributedBy[playerId] = iids.length;

      for (const viewerId of [...state.seating, null] as (PlayerId | null)[]) {
        const view = redactStateFor(state, viewerId);
        const publicCounts = view.crisis.contributions.reduce<Record<string, number>>(
          (counts, contribution) => {
            counts[contribution.playerId] = (counts[contribution.playerId] ?? 0) + 1;
            return counts;
          },
          {},
        );
        expect(publicCounts).toEqual(contributedBy);
        expect(view.crisis.contributions.every((c) => c.iid.startsWith('hidden:crisis:'))).toBe(
          true,
        );
        for (const iid of [...accepted, ...rejected]) {
          expect(view.items[iid]).toBeUndefined();
          expect(JSON.stringify(view)).not.toContain(iid);
        }
      }

      if (seat < state.seating.length - 1) state = act(state, playerId, { type: 'endTurn' });
    }

    expect(state.crisis.contributions.map((c) => c.iid)).toHaveLength(8);
    expect(accepted).toHaveLength(7);
    expect(rejected).toHaveLength(1);
    const cursorBeforeResolution = state.rngCursor;

    // Ending the last turn enters the real Colony Phase. Resolve Crisis stops
    // on its optional over-contribution choice, after scoring and cleanup.
    const lastPlayer = active(state);
    quietTurn(state);
    state = act(state, lastPlayer, { type: 'endTurn' });

    const resolved = lastLogEvent(state, 'crisisResolved')!;
    expect(resolved.data).toMatchObject({
      cardId: 'cr-1',
      total: 6, // seven accepted cards minus one wrong-symbol card
      required: 4,
      prevented: true,
    });
    const reveals = resolved.data?.['reveals'] as { iid: string; accepted: boolean }[];
    expect(reveals).toHaveLength(8);
    expect(reveals.map((r) => r.iid).sort()).toEqual([...accepted, ...rejected].sort());
    expect(reveals.filter((r) => r.accepted).map((r) => r.iid).sort()).toEqual(
      [...accepted].sort(),
    );
    expect(reveals.filter((r) => !r.accepted).map((r) => r.iid)).toEqual(rejected);
    expect(reveals.map((r) => r.iid)).not.toEqual([...accepted, ...rejected]);
    expect(state.rngCursor).toBeGreaterThan(cursorBeforeResolution);
    expect(state.colony.morale).toBe(9); // required + 2 grants exactly one morale
    expect(state.crisis.cardId).toBeNull();
    expect(state.crisis.contributions).toEqual([]);
    expect(state.decks.removedFromGame.items).toEqual(
      expect.arrayContaining([...accepted, ...rejected]),
    );
    expect(pending(state)).toMatchObject({ kind: 'effectOption', playerId: state.firstPlayerId });

    // Resolution is public: every player and a spectator can resolve each
    // revealed iid through the item registry and independently verify whether
    // its symbols match the crisis requirement.
    for (const viewerId of [...state.seating, null] as (PlayerId | null)[]) {
      const view = redactStateFor(state, viewerId);
      const visibleResolution = lastLogEvent(view, 'crisisResolved')!;
      expect(visibleResolution.data).toMatchObject({ total: 6, required: 4, prevented: true });
      const visibleReveals = visibleResolution.data?.['reveals'] as {
        iid: string;
        accepted: boolean;
      }[];
      expect(visibleReveals).toEqual(reveals);
      expect(view.crisis.contributions).toEqual([]);
      for (const reveal of visibleReveals) {
        const cardId = view.items[reveal.iid]?.cardId;
        expect(cardId).toBeTruthy();
        const symbols = contentOf(view).items.get(cardId!)!.symbols;
        expect(reveal.accepted).toBe(symbols.includes('weapon'));
      }
    }
  });

  it('fails below the non-exiled-player threshold and executes the crisis failure effect', () => {
    let state = game();
    state.crisis.cardId = 'cr-1'; // failure: lose two morale
    state.colony.food = 20; // isolate the crisis from starvation
    state.colony.morale = 10;
    const contributor = active(state);
    const accepted = grantItem(state, contributor, 'it-switchblade');
    const rejected = grantItem(state, contributor, 'it-canned-food');
    quietTurn(state);
    state = act(state, contributor, { type: 'contributeCrisis', iids: [accepted, rejected] });

    const round = state.round;
    while (state.phase === 'playerTurns' && state.round === round) {
      quietTurn(state);
      state = act(state, active(state), { type: 'endTurn' });
    }

    const resolved = lastLogEvent(state, 'crisisResolved')!;
    expect(resolved.data).toMatchObject({ total: 0, required: 4, prevented: false });
    expect(state.colony.morale).toBe(8);
    expect(state.decks.removedFromGame.items).toEqual(expect.arrayContaining([accepted, rejected]));
  });

  it('sets the crisis threshold from non-exiled players rather than total seating', () => {
    let state = game();
    state.crisis.cardId = 'cr-1';
    state.colony.food = 20;
    const contributor = active(state);
    const exiled = state.seating.find((id) => id !== contributor)!;
    state.players[exiled]!.exiled = true;
    expect(state.seating).toHaveLength(4);
    expect(state.seating.filter((id) => !state.players[id]!.exiled)).toHaveLength(3);

    const accepted = Array.from({ length: 3 }, () =>
      grantItem(state, contributor, 'it-switchblade'),
    );
    quietTurn(state);
    state = act(state, contributor, { type: 'contributeCrisis', iids: accepted });

    const round = state.round;
    while (state.phase === 'playerTurns' && state.round === round) {
      quietTurn(state);
      state = act(state, active(state), { type: 'endTurn' });
    }

    expect(lastLogEvent(state, 'crisisResolved')?.data).toMatchObject({
      total: 3,
      required: 3,
      prevented: true,
    });
    expect(state.decks.removedFromGame.items).toEqual(expect.arrayContaining(accepted));
  });
});

describe('§23.5 ordered waste and Clean Waste', () => {
  it('stacks played cards in order and removes exactly the three most recently played cards', () => {
    let state = game();
    const playerId = active(state);
    const played = ['it-st1', 'it-st2', 'it-st3', 'it-st4', 'it-st5'].map((cardId) =>
      grantItem(state, playerId, cardId),
    );
    quietTurn(state);
    for (const iid of played) state = act(state, playerId, { type: 'playItem', iid });
    expect(state.colony.waste).toEqual(played);

    setDice(state, playerId, [1]);
    state = act(state, playerId, { type: 'cleanWaste', die: 1 });

    expect(state.colony.waste).toEqual(played.slice(0, 2));
    expect(state.decks.removedFromGame.items).toEqual(
      expect.arrayContaining([played[4]!, played[3]!, played[2]!]),
    );
    expect(state.decks.removedFromGame.items).not.toContain(played[0]);
    expect(state.decks.removedFromGame.items).not.toContain(played[1]);
    expect(lastLogEvent(state, 'cleanWaste')?.data).toMatchObject({ count: 3 });
  });

  it('charges one morale per complete ten cards without changing the ordered pile', () => {
    const state = game();
    const playerId = active(state);
    const played = Array.from({ length: 23 }, (_, i) =>
      grantItem(state, playerId, `it-st${(i % 19) + 1}`),
    );
    state.colony.waste = [...played];
    state.colony.morale = 10;

    runColonyStep(state, NOW, 'checkWaste');

    expect(state.colony.waste).toEqual(played);
    expect(state.colony.morale).toBe(8);
    expect(lastLogEvent(state, 'checkWaste')?.data).toMatchObject({ count: 23, penalty: 2 });
  });
});

describe('§23.5 food and starvation persistence', () => {
  it('removes no food on a shortfall, accumulates the starvation penalty, and preserves tokens through feeding', () => {
    const state = game();
    const remote = Object.values(state.survivors).slice(0, 2);
    expect(remote).toHaveLength(2);
    placeSurvivor(state, remote[0]!.id, 'police-station');
    placeSurvivor(state, remote[1]!.id, 'school');
    state.colony.helpless = 1;

    const normalSurvivors = Object.values(state.survivors);
    const colonyNormals = normalSurvivors.filter((survivor) => survivor.location === 'colony').length;
    const remoteNormals = normalSurvivors.filter((survivor) => survivor.location !== 'colony').length;
    expect({ colonyNormals, remoteNormals, helpless: state.colony.helpless }).toEqual({
      colonyNormals: 6,
      remoteNormals: 2,
      helpless: 1,
    });
    const colonyOccupants = colonyNormals + state.colony.helpless;
    const required = 4; // ceil((6 colony normals + 1 helpless) / 2)
    expect(Math.ceil(colonyOccupants / 2)).toBe(required);
    expect(Math.ceil((normalSurvivors.length + state.colony.helpless) / 2)).toBe(5);
    state.colony.morale = 10;
    state.colony.food = required - 1;

    runColonyStep(state, NOW, 'payFood');
    expect(state.colony.food).toBe(required - 1);
    expect(state.colony.starvation).toBe(1);
    expect(state.colony.morale).toBe(9);
    expect(lastLogEvent(state, 'payFood')?.data).toMatchObject({
      required,
      occupants: colonyOccupants,
      paid: false,
      starvation: 1,
    });

    state.colony.food = required;
    runColonyStep(state, NOW + 1, 'payFood');
    expect(state.colony.food).toBe(0);
    expect(state.colony.starvation).toBe(1);
    expect(state.colony.morale).toBe(9);
    expect(lastLogEvent(state, 'payFood')?.data).toMatchObject({ required, paid: true });

    runColonyStep(state, NOW + 2, 'payFood');
    expect(state.colony.food).toBe(0);
    expect(state.colony.starvation).toBe(2);
    expect(state.colony.morale).toBe(7);
    expect(lastLogEvent(state, 'payFood')?.data).toMatchObject({
      required,
      paid: false,
      starvation: 2,
    });
  });
});

describe('§23.5 public face-up objective contributions', () => {
  it('moves an eligible card from hand to a face-up zone visible to every player and spectators', () => {
    let state = game();
    const contributor = active(state);
    const iid = grantItem(state, contributor, 'it-school-2');
    const card = state.items[iid]!.cardId;
    const cardName = contentOf(state).items.get(card)!.name;
    quietTurn(state);

    state = act(state, contributor, { type: 'contributeObjective', iids: [iid] });

    expect(state.players[contributor]!.hand).not.toContain(iid);
    expect(state.mainObjective.contributions).toEqual([iid]);
    const log = lastLogEvent(state, 'objectiveContribution')!;
    expect(log.message).toContain(cardName);
    expect(log.data).toMatchObject({ playerId: contributor, iids: [iid] });

    for (const viewerId of [...state.seating, null] as (PlayerId | null)[]) {
      const view = redactStateFor(state, viewerId);
      expect(view.mainObjective.contributions).toEqual([iid]);
      expect(view.items[iid]?.cardId).toBe(card);
      expect(lastLogEvent(view, 'objectiveContribution')).toMatchObject({
        message: expect.stringContaining(cardName),
        data: { event: 'objectiveContribution', playerId: contributor, iids: [iid] },
      });
    }
  });
});
