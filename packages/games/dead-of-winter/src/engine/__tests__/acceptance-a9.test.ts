/**
 * §23 acceptance criterion A9.
 *
 * These tests cover the crossroads rules at the reducer boundary. The small
 * state edits in the helpers below only arrange a deterministic card, board,
 * or random-roll setup; each observed rule is driven through the public
 * reducer, effect, and redaction APIs.
 */

import { Rng } from "@tt/core";
import { describe, expect, it } from "vitest";

import type { CrossroadsCardDefinition } from "../../content/schema.js";
import { COLONY } from "../../content/primitives.js";
import type { GameState, PlayerId } from "../../types.js";
import {
  checkCrossroadsTrigger,
  nextSeatRight,
  redactStateFor,
  turnOrder,
  validateAction,
} from "../index.js";
import {
  NOW,
  act,
  choose,
  eventSequence,
  extendPack,
  logEvents,
  pending,
  placeSurvivor,
  setDice,
  start,
  survivorsOfPlayer,
} from "./helpers.js";

const active = (state: GameState): PlayerId => state.turn!.playerId;

/** Positions the persisted RNG cursor before an exact sequence of d6 rolls. */
function nextRolls(state: GameState, expected: number[]): void {
  for (let cursor = 0; cursor < 100_000; cursor++) {
    const rng = new Rng(state.seed, cursor);
    if (expected.every((value) => rng.die(6) === value)) {
      state.rngCursor = cursor;
      return;
    }
  }
  throw new Error(`No RNG cursor found for d6 sequence ${expected.join(",")}`);
}

/** Mutes the card already held by the current turn for a setup-only transition. */
function muteCurrentCrossroads(state: GameState): void {
  if (!state.turn) throw new Error("Expected an active turn.");
  state.turn.crossroadsCardId = null;
  state.turn.crossroadsTriggered = true;
}

/** Removes one named card from the deck and makes it the current held card. */
function holdCrossroads(state: GameState, cardId: string): void {
  if (!state.turn) throw new Error("Expected an active turn.");
  const inDeck = state.decks.crossroads.indexOf(cardId);
  if (inDeck >= 0) state.decks.crossroads.splice(inDeck, 1);
  state.turn.crossroadsCardId = cardId;
  state.turn.crossroadsTriggered = false;
}

/** Queues a known card for the next real beginning-of-turn draw. */
function queueCrossroadsForNextTurn(
  state: GameState,
  cardId: string,
): GameState {
  const currentPlayer = active(state);
  muteCurrentCrossroads(state);
  const inDeck = state.decks.crossroads.indexOf(cardId);
  if (inDeck >= 0) state.decks.crossroads.splice(inDeck, 1);
  state.decks.crossroads.unshift(cardId);
  return act(state, currentPlayer, { type: "endTurn" });
}

function lastEventData(
  state: GameState,
  event: string,
): Record<string, unknown> {
  const entry = logEvents(state, event).at(-1);
  if (!entry?.data) throw new Error(`No ${event} event was logged.`);
  return entry.data as Record<string, unknown>;
}

const frostbiteMonitorCard: CrossroadsCardDefinition = {
  id: "xr-a9-frostbite-monitor",
  name: "The Watch Begins",
  story: "A watcher notices the colony's first loss.",
  trigger: {
    event: "moraleChanged",
    moraleDirection: "down",
    requires: { kind: "morale", atMost: 5 },
  },
  options: [
    {
      id: "acknowledge",
      text: "Acknowledge the loss.",
      outcome: { kind: "noop" },
    },
  ],
  matureContent: false,
  nonCooperative: false,
};

const A9_PACK = extendPack("acceptance-a9", {
  crossroads: [frostbiteMonitorCard],
});

describe("A9 §23.9 — crossroads timing and ownership", () => {
  it("draws the known top card for the active player's right-hand player and keeps it private", () => {
    let state = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const knownCardId = "xr-move-test";
    state = queueCrossroadsForNextTurn(state, knownCardId);
    const playerId = active(state);
    const holderId = nextSeatRight(state, playerId);

    expect(state.turn!.crossroadsCardId).toBe(knownCardId);
    expect(state.turn).toMatchObject({
      playerId,
      crossroadsHolderId: holderId,
      crossroadsCardId: knownCardId,
      crossroadsTriggered: false,
    });
    expect(holderId).not.toBe(playerId);

    expect(redactStateFor(state, holderId).turn!.crossroadsCardId).toBe(knownCardId);
    for (const viewerId of state.seating.filter((id) => id !== holderId)) {
      expect(redactStateFor(state, viewerId).turn!.crossroadsCardId).toBe(
        "hidden:crossroads",
      );
    }
    expect(redactStateFor(state, null).turn!.crossroadsCardId).toBe(
      "hidden:crossroads",
    );
  });

  it("starts monitoring before frostbite's beginning-of-turn morale effect", () => {
    let state = start({
      playerCount: 4,
      pack: A9_PACK,
      settings: { mainObjectiveId: "mo-we-need-more-samples" },
    });
    const nextPlayer = turnOrder(state)[1]!;
    const frostbitten = survivorsOfPlayer(state, nextPlayer).find(
      (survivor) => !survivor.isLeader,
    )!;
    frostbitten.frostbite = 1;
    frostbitten.wounds = 2;

    state = queueCrossroadsForNextTurn(state, frostbiteMonitorCard.id);

    expect(active(state)).toBe(nextPlayer);
    expect(state.turn!.crossroadsCardId).toBe(frostbiteMonitorCard.id);
    expect(pending(state)).toMatchObject({
      kind: "effectOption",
      playerId: nextPlayer,
      options: [{ id: "acknowledge", legal: true }],
    });
    expect(state.survivors[frostbitten.id]).toBeUndefined();

    const sequence = eventSequence(state);
    expect(sequence.lastIndexOf("crossroadsDrawn")).toBeLessThan(
      sequence.lastIndexOf("turnStart"),
    );
    expect(sequence.lastIndexOf("turnStart")).toBeLessThan(
      sequence.lastIndexOf("wound"),
    );
    expect(sequence.lastIndexOf("wound")).toBeLessThan(
      sequence.lastIndexOf("survivorDied"),
    );
    expect(sequence.lastIndexOf("survivorDied")).toBeLessThan(
      sequence.lastIndexOf("morale"),
    );
    expect(sequence.lastIndexOf("morale")).toBeLessThan(
      sequence.lastIndexOf("crossroadsTriggered"),
    );
    expect(lastEventData(state, "crossroadsDrawn")).toMatchObject({
      activePlayerId: nextPlayer,
      holderId: nextSeatRight(state, nextPlayer),
    });
  });

  it("does not let the right-hand holder self-trigger This Taste Funny; the active search triggers it after resolution", () => {
    let state = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const playerId = active(state);
    const holderId = nextSeatRight(state, playerId);
    const searcher = survivorsOfPlayer(state, playerId).find(
      (survivor) => !survivor.isLeader,
    )!;
    const holderSurvivor = survivorsOfPlayer(state, holderId)[0]!;
    placeSurvivor(state, searcher.id, "school");
    placeSurvivor(state, holderSurvivor.id, "school");
    setDice(state, playerId, [6]);
    setDice(state, holderId, [6]);
    holdCrossroads(state, "xr-this-taste-funny");

    const holderAttempt = validateAction(state, holderId, {
      type: "search",
      survivorId: holderSurvivor.id,
      die: 6,
    });
    expect(holderAttempt).toMatchObject({
      ok: false,
      reason: "It is not your turn.",
    });
    expect(state.turn!.crossroadsTriggered).toBe(false);

    state = act(state, playerId, {
      type: "search",
      survivorId: searcher.id,
      die: 6,
    });
    expect(pending(state)).toMatchObject({ kind: "searchDecision", playerId });
    expect(state.turn!.crossroadsTriggered).toBe(false);

    const searchChoice = pending(state)!;
    const keep = searchChoice.options.find((option) =>
      option.id.startsWith("keep:"),
    )!;
    state = choose(state, playerId, searchChoice.id, [keep.id]);

    expect(pending(state)).toMatchObject({
      kind: "effectOption",
      playerId,
      options: [
        { id: "eat", legal: true },
        { id: "refuse", legal: true },
      ],
    });
    expect(pending(state)!.outcomes).toEqual({
      eat: { kind: "adjustFood", amount: 1 },
      refuse: { kind: "adjustMorale", amount: -1 },
    });
    expect(eventSequence(state).lastIndexOf("searchKept")).toBeLessThan(
      eventSequence(state).lastIndexOf("crossroadsTriggered"),
    );
  });
});

describe("A9 §10 — post-resolution movement and option legality", () => {
  it("resolves arrival exposure before a movement trigger and preserves every option outcome", () => {
    let state = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const playerId = active(state);
    const holderId = nextSeatRight(state, playerId);
    const mover = survivorsOfPlayer(state, playerId).find(
      (survivor) => !survivor.isLeader,
    )!;
    state.colony.food = 0;
    setDice(state, playerId, [6]);
    holdCrossroads(state, "xr-move-test");
    nextRolls(state, [1]);

    state = act(state, playerId, {
      type: "moveSurvivor",
      survivorId: mover.id,
      to: "school",
    });

    const crossroadsChoice = pending(state)!;
    expect(crossroadsChoice).toMatchObject({
      kind: "effectOption",
      playerId,
      options: [
        { id: "ignore", legal: true },
        { id: "investigate", legal: false },
      ],
    });
    expect(crossroadsChoice.options[1]!.reason).toBeDefined();
    expect(crossroadsChoice.outcomes).toEqual({
      ignore: { kind: "adjustMorale", amount: -1 },
      investigate: { kind: "adjustFood", amount: -1 },
    });

    const chooserView = redactStateFor(state, playerId);
    const holderView = redactStateFor(state, holderId);
    expect(chooserView.pendingChoices[0]!.options).toEqual(
      crossroadsChoice.options,
    );
    expect(chooserView.pendingChoices[0]!.outcomes).toEqual(
      crossroadsChoice.outcomes,
    );
    expect(
      holderView.pendingChoices[0]!.options.map((option) => option.id),
    ).toEqual(["ignore", "investigate"]);
    expect(holderView.pendingChoices[0]!.outcomes).toBeUndefined();

    const snapshot = JSON.stringify(state);
    expect(() =>
      choose(state, playerId, crossroadsChoice.id, ["investigate"]),
    ).toThrow(/not legal|Conditions for this option are not met/i);
    expect(JSON.stringify(state)).toBe(snapshot);

    state = choose(state, playerId, crossroadsChoice.id, ["ignore"]);
    const sequence = eventSequence(state);
    expect(sequence.lastIndexOf("move")).toBeLessThan(
      sequence.lastIndexOf("exposure"),
    );
    expect(sequence.lastIndexOf("exposure")).toBeLessThan(
      sequence.lastIndexOf("crossroadsTriggered"),
    );
    expect(state.survivors[mover.id]).toMatchObject({ location: "school" });
  });

  it("does not trigger a movement crossroads card when arrival exposure kills the mover", () => {
    let state = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const playerId = active(state);
    const mover = survivorsOfPlayer(state, playerId).find(
      (survivor) => !survivor.isLeader,
    )!;
    holdCrossroads(state, "xr-move-test");
    nextRolls(state, [6]);

    state = act(state, playerId, {
      type: "moveSurvivor",
      survivorId: mover.id,
      to: "school",
    });

    expect(lastEventData(state, "exposure")).toMatchObject({
      survivorId: mover.id,
      face: "bitten",
    });
    expect(state.survivors[mover.id]).toBeUndefined();
    expect(pending(state)).toBeUndefined();
    expect(state.turn!.crossroadsTriggered).toBe(false);
    expect(state.turn!.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "moveCompleted",
          survivorId: mover.id,
        }),
        expect.objectContaining({
          event: "survivorKilled",
          survivorId: mover.id,
        }),
      ]),
    );

    state = act(state, playerId, { type: "endTurn" });
    expect(state.decks.crossroads.at(-1)).toBe("xr-move-test");
  });
});

describe("A9 §15/§21 — card-specific electorate and public reveal", () => {
  it("Outbreak limits voting to players with a survivor at the colony and keeps commitments secret", () => {
    let state = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const nextPlayer = turnOrder(state)[1]!;
    const otherColonyPlayer = turnOrder(state)[2]!;
    const outsidePlayers = state.seating.filter(
      (playerId) => playerId !== nextPlayer && playerId !== otherColonyPlayer,
    );
    for (const playerId of outsidePlayers) {
      for (const survivor of survivorsOfPlayer(state, playerId)) {
        placeSurvivor(state, survivor.id, "school");
      }
    }

    state = queueCrossroadsForNextTurn(state, "xr-outbreak");
    expect(active(state)).toBe(nextPlayer);
    expect(pending(state)).toMatchObject({
      kind: "effectOption",
      playerId: nextPlayer,
      options: [{ id: "quarantine", legal: true }],
    });
    expect(pending(state)!.outcomes).toMatchObject({
      quarantine: {
        kind: "vote",
        electorate: "colonySurvivors",
        onPass: { kind: "adjustMorale", amount: -1 },
      },
    });

    state = choose(state, nextPlayer, pending(state)!.id, ["quarantine"]);
    const eligible = state.seating.filter(
      (playerId) => playerId === nextPlayer || playerId === otherColonyPlayer,
    );
    expect(state.vote).toMatchObject({ electorate: eligible, nomineeId: null });
    expect(pending(state)).toMatchObject({ kind: "vote", playerId: null });

    const outside = outsidePlayers[0]!;
    expect(() => act(state, outside, { type: "castVote", vote: true })).toThrow(
      /not eligible to vote/i,
    );
    expect(state.vote!.committed).toEqual([]);

    state = act(state, nextPlayer, { type: "castVote", vote: true });
    expect(redactStateFor(state, otherColonyPlayer).vote!.votes).toEqual({});
    expect(redactStateFor(state, null).vote!.votes).toEqual({});
    expect(redactStateFor(state, nextPlayer).vote!.votes).toEqual({
      [nextPlayer]: true,
    });

    state = act(state, otherColonyPlayer, { type: "castVote", vote: true });
    expect(state.vote).toBeNull();
    expect(pending(state)).toBeUndefined();
    expect(lastEventData(state, "morale")).toMatchObject({ delta: -1 });
  });

  it("Old Divisions requires an active player's colony survivor, not merely any colony survivor", () => {
    let noActiveSurvivor = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const nextPlayer = turnOrder(noActiveSurvivor)[1]!;
    const otherPlayer = turnOrder(noActiveSurvivor)[2]!;
    for (const survivor of survivorsOfPlayer(noActiveSurvivor, nextPlayer)) {
      placeSurvivor(noActiveSurvivor, survivor.id, "school");
    }
    noActiveSurvivor.colony.helpless = 1;
    noActiveSurvivor = queueCrossroadsForNextTurn(
      noActiveSurvivor,
      "xr-old-divisions",
    );
    expect(active(noActiveSurvivor)).toBe(nextPlayer);
    expect(
      survivorsOfPlayer(noActiveSurvivor, otherPlayer).some(
        (survivor) => survivor.location === COLONY,
      ),
    ).toBe(true);
    expect(pending(noActiveSurvivor)).toBeUndefined();
    expect(noActiveSurvivor.turn!.crossroadsTriggered).toBe(false);

    let activeSurvivorPresent = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const activeNextPlayer = turnOrder(activeSurvivorPresent)[1]!;
    for (const survivor of survivorsOfPlayer(
      activeSurvivorPresent,
      activeNextPlayer,
    ).filter((candidate) => !candidate.isLeader)) {
      placeSurvivor(activeSurvivorPresent, survivor.id, "school");
    }
    activeSurvivorPresent.colony.helpless = 1;
    const contributionPlayer = active(activeSurvivorPresent);
    const contribution = activeSurvivorPresent.players[contributionPlayer]!.hand[0]!;
    activeSurvivorPresent = act(activeSurvivorPresent, contributionPlayer, {
      type: "contributeCrisis",
      iids: [contribution],
    });
    expect(activeSurvivorPresent.crisis.contributions).toHaveLength(1);
    activeSurvivorPresent = queueCrossroadsForNextTurn(
      activeSurvivorPresent,
      "xr-old-divisions",
    );

    expect(active(activeSurvivorPresent)).toBe(activeNextPlayer);
    expect(pending(activeSurvivorPresent)).toMatchObject({
      kind: "effectOption",
      playerId: activeNextPlayer,
      options: [
        { id: "thumbs-up", legal: true },
        { id: "thumbs-down", legal: true },
      ],
    });
    const moraleBefore = activeSurvivorPresent.colony.morale;
    activeSurvivorPresent = choose(
      activeSurvivorPresent,
      activeNextPlayer,
      pending(activeSurvivorPresent)!.id,
      ["thumbs-up"],
    );
    expect(activeSurvivorPresent.colony.morale).toBe(moraleBefore);
    expect(activeSurvivorPresent.crisis.contributions).toEqual([]);
    expect(
      JSON.stringify(logEvents(activeSurvivorPresent, "crisisContributionsRemoved").at(-1)),
    ).not.toContain(contribution);
    expect(lastEventData(activeSurvivorPresent, "crisisContributionsRemoved")).toMatchObject({
      count: 1,
      revealed: false,
    });
  });

  it("can expose a triggered card's complete option list and outcomes before the choice is made", () => {
    let state = start({
      playerCount: 4,
      settings: { mainObjectiveId: "mo-stockpile" },
    });
    const playerId = active(state);
    const mover = survivorsOfPlayer(state, playerId).find(
      (survivor) => !survivor.isLeader,
    )!;
    state.colony.food = 0;
    holdCrossroads(state, "xr-move-test");
    nextRolls(state, [1]);
    state = act(state, playerId, {
      type: "moveSurvivor",
      survivorId: mover.id,
      to: "school",
    });

    const choice = pending(state)!;
    expect(choice.options).toEqual([
      { id: "ignore", label: "Keep walking.", legal: true },
      {
        id: "investigate",
        label: "Investigate — only if the colony still has food.",
        legal: false,
        reason: "Conditions for this option are not met.",
      },
    ]);
    expect(Object.keys(choice.outcomes ?? {})).toEqual([
      "ignore",
      "investigate",
    ]);
    expect(choice.outcomes).toMatchObject({
      ignore: { kind: "adjustMorale", amount: -1 },
      investigate: { kind: "adjustFood", amount: -1 },
    });
    expect(
      choice.options.find((option) => option.id === "investigate"),
    ).toMatchObject({
      legal: false,
    });

    const activeView = redactStateFor(state, playerId);
    expect(activeView.pendingChoices[0]!.outcomes).toEqual(choice.outcomes);
    expect(activeView.pendingChoices[0]!.options).toEqual(choice.options);

    // The card is revealed, so the other player can read every option's text;
    // only the chooser needs the executable outcome tree to resolve it.
    const otherView = redactStateFor(state, nextSeatRight(state, playerId));
    expect(otherView.pendingChoices[0]!.options).toEqual(choice.options);
    expect(otherView.pendingChoices[0]!.outcomes).toBeUndefined();

    // Keep the public trigger API exercised directly as a settled no-op: once
    // the card is marked triggered, checking again cannot create a second choice.
    expect(checkCrossroadsTrigger(state, NOW)).toBe(false);
  });
});
