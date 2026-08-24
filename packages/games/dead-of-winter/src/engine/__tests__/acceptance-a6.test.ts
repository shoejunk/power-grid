/**
 * §23 acceptance criterion A6.
 *
 * These tests drive the authoritative reducer through real actions and choices.
 * Direct state edits are setup scaffolding only: they select the next seeded
 * random result or arrange a compact board position; no assertion is encoded
 * by a helper.
 */

import { Rng } from "@tt/core";
import { describe, expect, it } from "vitest";

import { COLONY } from "../../content/primitives.js";
import type { GameState, PlayerId, SurvivorInstanceId } from "../../types.js";
import {
  contentOf,
  placeSurvivor as spawnSurvivor,
  redactStateFor,
  turnOrder,
} from "../index.js";
import {
  NOW,
  act,
  addZombies,
  answerFirstLegal,
  choose,
  eventSequence,
  logEvents,
  pending,
  placeSurvivor,
  setDice,
  start,
  survivorsOfPlayer,
  zombiesAt,
} from "./helpers.js";

const game = (mainObjectiveId = "mo-stockpile"): GameState =>
  start({ playerCount: 4, settings: { mainObjectiveId } });

const active = (state: GameState): PlayerId => state.turn!.playerId;

const others = (state: GameState, playerId: PlayerId): PlayerId[] =>
  state.seating.filter((id) => id !== playerId);

function muteCrossroads(state: GameState): void {
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
  throw new Error(`No RNG cursor found for d6 sequence ${expected.join(",")}`);
}

function onlySurvivor(
  state: GameState,
  playerId: PlayerId,
  keepId: SurvivorInstanceId,
): void {
  for (const survivor of survivorsOfPlayer(state, playerId)) {
    if (survivor.id !== keepId) delete state.survivors[survivor.id];
  }
  const kept = state.survivors[keepId]!;
  kept.isLeader = true;
  state.players[playerId]!.leaderSurvivorId = keepId;
}

function nextTurnFor(
  state: GameState,
  playerId: PlayerId,
  afterRound: number,
): GameState {
  let s = state;
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === "gameOver")
      throw new Error("The game ended before the requested next turn.");
    if (s.round > afterRound && s.turn?.playerId === playerId && !pending(s))
      return s;
    if (pending(s)) {
      s = answerFirstLegal(s);
      continue;
    }
    if (!s.turn) throw new Error(`No turn while phase is '${s.phase}'.`);
    muteCrossroads(s);
    s = act(s, s.turn.playerId, { type: "endTurn" });
  }
  throw new Error(`Did not reach ${playerId}'s next turn.`);
}

function lastData(state: GameState, event: string): Record<string, unknown> {
  const entry = logEvents(state, event).at(-1);
  expect(entry, `expected a '${event}' audit event`).toBeDefined();
  return entry!.data as Record<string, unknown>;
}

describe("A6 §7 attacks", () => {
  it("§7.1 spends the selected die, kills the selected colony zombie, then rolls exposure", () => {
    let s = game();
    const playerId = active(s);
    const attacker = survivorsOfPlayer(s, playerId)[0]!;
    const entrance = s.colony.entrances[3]!;
    entrance.zombies = 1;
    setDice(s, playerId, [6]);
    nextRolls(s, [1]); // blank exposure
    muteCrossroads(s);

    s = act(s, playerId, {
      type: "attackZombie",
      survivorId: attacker.id,
      die: 6,
      entrance: entrance.index,
    });

    expect(entrance.index).toBe(4);
    expect(s.colony.entrances[3]!.zombies).toBe(0);
    expect(s.players[playerId]!.unusedDice).toEqual([]);
    expect(s.players[playerId]!.usedDice).toContain(6);
    expect(lastData(s, "zombieKilled")).toMatchObject({
      location: COLONY,
      isAttack: true,
      killerId: attacker.id,
    });
    expect(lastData(s, "exposure")).toMatchObject({
      survivorId: attacker.id,
      roll: 1,
      face: "blank",
    });
    const order = eventSequence(s);
    expect(order.lastIndexOf("zombieKilled")).toBeLessThan(
      order.lastIndexOf("exposure"),
    );
  });

  it("§7.2 a hit wounds the target and steals exactly one authoritative random card without exposure", () => {
    let s = game();
    const playerId = active(s);
    const targetPlayerId = others(s, playerId)[0]!;
    const attacker = spawnSurvivor(
      s,
      NOW,
      playerId,
      "sv-loretta-clay",
      COLONY,
      false,
    );
    const target = spawnSurvivor(
      s,
      NOW,
      targetPlayerId,
      "sv-john-price",
      COLONY,
      false,
    );
    const targetValue = contentOf(s).survivors.get(
      target.cardId,
    )!.attackThreshold;
    expect(targetValue).toBe(5);
    const attackerHandBefore = [...s.players[playerId]!.hand];
    const targetHandBefore = [...s.players[targetPlayerId]!.hand];
    const exposureBefore = logEvents(s, "exposure").length;
    setDice(s, playerId, [6]);
    nextRolls(s, [2]);
    muteCrossroads(s);

    s = act(s, playerId, {
      type: "attackSurvivor",
      survivorId: attacker.id,
      die: 6,
      targetId: target.id,
    });

    expect(lastData(s, "survivorAttack")).toMatchObject({
      attacker: attacker.id,
      target: target.id,
      reroll: 2,
      hit: true,
    });
    expect(s.survivors[target.id]!.wounds).toBe(1);
    expect(s.players[playerId]!.hand).toHaveLength(
      attackerHandBefore.length + 1,
    );
    expect(s.players[targetPlayerId]!.hand).toHaveLength(
      targetHandBefore.length - 1,
    );
    const stolen = lastData(s, "stealCard")["iid"];
    expect(targetHandBefore).toContain(stolen);
    expect(s.players[playerId]!.hand).toContain(stolen);
    expect(logEvents(s, "stealCard").at(-1)!.audience).toEqual([
      targetPlayerId,
      playerId,
    ]);
    expect(logEvents(s, "exposure")).toHaveLength(exposureBefore);
  });

  it("§7.2 a miss causes neither a wound nor theft and never rolls exposure", () => {
    let s = game();
    const playerId = active(s);
    const targetPlayerId = others(s, playerId)[0]!;
    const attacker = spawnSurvivor(
      s,
      NOW,
      playerId,
      "sv-loretta-clay",
      COLONY,
      false,
    );
    const target = spawnSurvivor(
      s,
      NOW,
      targetPlayerId,
      "sv-loretta-clay",
      COLONY,
      false,
    );
    const targetHandBefore = [...s.players[targetPlayerId]!.hand];
    const exposureBefore = logEvents(s, "exposure").length;
    setDice(s, playerId, [6]);
    nextRolls(s, [6]); // Loretta's numeric attack value is 4
    muteCrossroads(s);

    s = act(s, playerId, {
      type: "attackSurvivor",
      survivorId: attacker.id,
      die: 6,
      targetId: target.id,
    });

    expect(lastData(s, "survivorAttack")).toMatchObject({
      reroll: 6,
      hit: false,
    });
    expect(s.survivors[target.id]!.wounds).toBe(0);
    expect(s.players[targetPlayerId]!.hand).toEqual(targetHandBefore);
    expect(logEvents(s, "stealCard")).toEqual([]);
    expect(logEvents(s, "exposure")).toHaveLength(exposureBefore);
  });

  it("§7.2 redacts a deterministic theft from unauthorized views and replays the same iid", () => {
    function run(seed: string) {
      let state = start({
        playerCount: 4,
        seed,
        settings: { mainObjectiveId: "mo-stockpile" },
      });
      const attackerController = active(state);
      const [targetController, thirdPlayer] = others(state, attackerController);
      const attacker = spawnSurvivor(
        state,
        NOW,
        attackerController,
        "sv-edward-white",
        COLONY,
        false,
      );
      const target = spawnSurvivor(
        state,
        NOW,
        targetController!,
        "sv-john-price",
        COLONY,
        false,
      );
      const targetHandBefore = [...state.players[targetController!]!.hand];
      setDice(state, attackerController, [6]);
      nextRolls(state, [2]);
      muteCrossroads(state);
      state = act(state, attackerController, {
        type: "attackSurvivor",
        survivorId: attacker.id,
        die: 6,
        targetId: target.id,
      });
      return {
        state,
        attackerController,
        targetController: targetController!,
        thirdPlayer: thirdPlayer!,
        targetHandBefore,
        stolen: lastData(state, "stealCard")["iid"] as string,
      };
    }

    const first = run("A6-THEFT-REPLAY");
    const replay = run("A6-THEFT-REPLAY");
    expect(replay.stolen).toBe(first.stolen);
    expect(replay.state.rngCursor).toBe(first.state.rngCursor);
    expect(lastData(replay.state, "survivorAttack")).toEqual(
      lastData(first.state, "survivorAttack"),
    );
    expect(lastData(replay.state, "stealCard")).toEqual(
      lastData(first.state, "stealCard"),
    );
    expect(first.targetHandBefore).toContain(first.stolen);

    const attackerView = redactStateFor(first.state, first.attackerController);
    const formerOwnerView = redactStateFor(first.state, first.targetController);
    const thirdView = redactStateFor(first.state, first.thirdPlayer);
    const spectatorView = redactStateFor(first.state, null);
    const stolenCardId = first.state.items[first.stolen]!.cardId;
    const stolenName = contentOf(first.state).items.get(stolenCardId)!.name;
    const authorizedIdentity = (view: GameState) => {
      const data = lastData(view, "stealCard");
      const cardId = data["cardId"] as string;
      return {
        iid: data["iid"],
        cardId,
        name: contentOf(view).items.get(cardId)?.name,
      };
    };
    const expectedIdentity = {
      iid: first.stolen,
      cardId: stolenCardId,
      name: stolenName,
    };

    expect(authorizedIdentity(attackerView)).toEqual(expectedIdentity);
    expect(authorizedIdentity(formerOwnerView)).toEqual(expectedIdentity);
    expect(attackerView.players[first.attackerController]!.hand).toContain(
      first.stolen,
    );
    expect(attackerView.items[first.stolen]!.cardId).toBe(stolenCardId);
    // The former owner's current item registry correctly no longer exposes the
    // attacker's hand; the private event is what preserves their authorized
    // knowledge of the stolen card's exact identity.
    expect(formerOwnerView.items[first.stolen]).toBeUndefined();
    expect(logEvents(thirdView, "stealCard")).toEqual([]);
    expect(logEvents(spectatorView, "stealCard")).toEqual([]);
    expect(JSON.stringify(thirdView)).not.toContain(first.stolen);
    expect(JSON.stringify(spectatorView)).not.toContain(first.stolen);
    expect(JSON.stringify(thirdView.log)).not.toContain(stolenCardId);
    expect(JSON.stringify(spectatorView.log)).not.toContain(stolenCardId);
  });
});

describe("A6 §7.1 kill versus remove", () => {
  it("kill earns objective credit and exposure, while remove earns neither and costs no morale", () => {
    let removed = game("mo-we-need-more-samples");
    const removerId = active(removed);
    const forest = spawnSurvivor(
      removed,
      NOW,
      removerId,
      "sv-forest-plum",
      "school",
      false,
    );
    addZombies(removed, "school", 2); // the scenario already placed one here
    expect(zombiesAt(removed, "school")).toBe(3);
    const moraleBefore = removed.colony.morale;
    muteCrossroads(removed);

    removed = act(removed, removerId, {
      type: "useAbility",
      survivorId: forest.id,
      abilityId: "forest-sacrifice",
    });

    expect(zombiesAt(removed, "school")).toBe(0);
    expect(removed.survivors[forest.id]).toBeUndefined();
    expect(removed.colony.morale).toBe(moraleBefore);
    expect(removed.mainObjective.counters["samples"]).toBe(0);
    expect(logEvents(removed, "zombiesRemoved").at(-1)!.data).toMatchObject({
      count: 3,
      isKill: false,
    });
    expect(logEvents(removed, "zombieKilled")).toEqual([]);
    expect(logEvents(removed, "effectRoll")).toEqual([]);
    expect(logEvents(removed, "exposure")).toEqual([]);
    expect(lastData(removed, "survivorRemoved")).toMatchObject({
      survivorId: forest.id,
    });
    expect(logEvents(removed, "survivorDied")).toEqual([]);

    let killed = game("mo-we-need-more-samples");
    const killerId = active(killed);
    const killer = survivorsOfPlayer(killed, killerId)[0]!;
    placeSurvivor(killed, killer.id, "school");
    setDice(killed, killerId, [6]);
    nextRolls(killed, [6, 1]); // successful sample, then blank exposure
    muteCrossroads(killed);

    killed = act(killed, killerId, {
      type: "attackZombie",
      survivorId: killer.id,
      die: 6,
    });

    expect(killed.mainObjective.counters["samples"]).toBe(1);
    expect(lastData(killed, "zombieKilled")).toMatchObject({
      isAttack: true,
      killerId: killer.id,
    });
    expect(lastData(killed, "effectRoll")).toMatchObject({
      store: "sample",
      value: 6,
    });
    expect(lastData(killed, "exposure")).toMatchObject({
      survivorId: killer.id,
      face: "blank",
    });
    const order = eventSequence(killed);
    expect(order.lastIndexOf("effectRoll")).toBeLessThan(
      order.lastIndexOf("exposure"),
    );
  });
});

describe("A6 §9.1 exposure and frostbite", () => {
  it.each([
    { roll: 1, face: "blank", wounds: 0, frostbite: 0 },
    { roll: 4, face: "wound", wounds: 1, frostbite: 0 },
    { roll: 5, face: "frostbite", wounds: 0, frostbite: 1 },
  ])(
    "applies a deterministic $face exposure face",
    ({ roll, face, wounds, frostbite }) => {
      let s = game();
      const playerId = active(s);
      const survivor = survivorsOfPlayer(s, playerId)[0]!;
      placeSurvivor(s, survivor.id, "school");
      addZombies(s, "school", 1);
      setDice(s, playerId, [6]);
      nextRolls(s, [roll]);
      muteCrossroads(s);

      s = act(s, playerId, {
        type: "attackZombie",
        survivorId: survivor.id,
        die: 6,
      });

      expect(lastData(s, "exposure")).toMatchObject({
        survivorId: survivor.id,
        roll,
        face,
      });
      expect(s.survivors[survivor.id]).toMatchObject({ wounds, frostbite });
      expect(logEvents(s, "survivorDied")).toEqual([]);
    },
  );

  it("a bitten result kills immediately and starts/finishes a chain even below three wounds", () => {
    let s = game();
    const playerId = active(s);
    const survivor = survivorsOfPlayer(s, playerId).find(
      (candidate) => !candidate.isLeader,
    )!;
    placeSurvivor(s, survivor.id, "school");
    survivor.wounds = 0;
    survivor.frostbite = 0;
    addZombies(s, "school", 1);
    setDice(s, playerId, [6]);
    nextRolls(s, [6]);
    muteCrossroads(s);
    const moraleBefore = s.colony.morale;

    s = act(s, playerId, {
      type: "attackZombie",
      survivorId: survivor.id,
      die: 6,
    });

    expect(lastData(s, "exposure")).toMatchObject({
      survivorId: survivor.id,
      face: "bitten",
    });
    expect(s.survivors[survivor.id]).toBeUndefined();
    expect(lastData(s, "survivorDied")).toMatchObject({
      survivorId: survivor.id,
      cause: "bite",
    });
    expect(lastData(s, "biteChainEnded")).toMatchObject({ location: "school" });
    expect(s.colony.morale).toBe(moraleBefore - 1);
  });

  it("commits a real move before bitten exposure and spreads only among destination survivors", () => {
    let s = game();
    const moverController = active(s);
    const destinationController = others(s, moverController)[0]!;
    const mover = survivorsOfPlayer(s, moverController).find(
      (candidate) => !candidate.isLeader,
    )!;
    const destinationSurvivor = spawnSurvivor(
      s,
      NOW,
      destinationController,
      "sv-forest-plum",
      "school",
      false,
    );
    expect(mover.location).toBe(COLONY);
    nextRolls(s, [6]);
    muteCrossroads(s);

    s = act(s, moverController, {
      type: "moveSurvivor",
      survivorId: mover.id,
      to: "school",
    });

    expect(lastData(s, "move")).toMatchObject({
      survivorId: mover.id,
      from: COLONY,
      to: "school",
    });
    expect(lastData(s, "exposure")).toMatchObject({
      survivorId: mover.id,
      face: "bitten",
    });
    expect(lastData(s, "survivorDied")).toMatchObject({
      survivorId: mover.id,
      cause: "bite",
      location: "school",
    });
    expect(pending(s)).toMatchObject({
      kind: "biteResponse",
      playerId: destinationController,
      data: { survivorId: destinationSurvivor.id, location: "school" },
    });
    const order = eventSequence(s);
    expect(order.lastIndexOf("move")).toBeLessThan(
      order.lastIndexOf("exposure"),
    );
    expect(order.lastIndexOf("exposure")).toBeLessThan(
      order.lastIndexOf("survivorDied"),
    );
    expect(s.survivors[destinationSurvivor.id]).toBeDefined();
  });

  it("two frostbite tokens cause exactly one regular wound at turn start", () => {
    let s = game();
    const targetController = turnOrder(s)[1]!;
    const survivor = survivorsOfPlayer(s, targetController)[0]!;
    survivor.frostbite = 2;
    const woundsBefore = logEvents(s, "wound").filter(
      (entry) => entry.data?.["survivorId"] === survivor.id,
    ).length;
    muteCrossroads(s);

    s = act(s, active(s), { type: "endTurn" });

    expect(s.turn!.playerId).toBe(targetController);
    expect(s.survivors[survivor.id]).toBeUndefined();
    const woundsAfter = logEvents(s, "wound").filter(
      (entry) => entry.data?.["survivorId"] === survivor.id,
    );
    expect(woundsAfter).toHaveLength(woundsBefore + 1);
    expect(woundsAfter.at(-1)!.data).toMatchObject({
      survivorId: survivor.id,
      amount: 1,
      frostbite: false,
      total: 3,
    });
    expect(lastData(s, "survivorDied")).toMatchObject({
      survivorId: survivor.id,
      cause: "wounds",
    });
  });

  it("frostbite remains and adds a regular wound at the next turn start, killing at three total", () => {
    let s = game();
    const playerId = active(s);
    const survivor = survivorsOfPlayer(s, playerId).find(
      (candidate) => !candidate.isLeader,
    )!;
    placeSurvivor(s, survivor.id, "school");
    survivor.wounds = 1;
    addZombies(s, "school", 1);
    setDice(s, playerId, [6]);
    nextRolls(s, [5]);
    muteCrossroads(s);
    const attackedInRound = s.round;

    s = act(s, playerId, {
      type: "attackZombie",
      survivorId: survivor.id,
      die: 6,
    });
    expect(s.survivors[survivor.id]).toMatchObject({ wounds: 1, frostbite: 1 });

    s = nextTurnFor(s, playerId, attackedInRound);

    expect(s.survivors[survivor.id]).toBeUndefined();
    expect(lastData(s, "wound")).toMatchObject({
      survivorId: survivor.id,
      amount: 1,
      frostbite: false,
      total: 3,
    });
    expect(lastData(s, "survivorDied")).toMatchObject({
      survivorId: survivor.id,
      cause: "wounds",
    });
  });
});

interface BitePosition {
  state: GameState;
  attackerId: SurvivorInstanceId;
  lowId: SurvivorInstanceId;
  middleId: SurvivorInstanceId;
  highId: SurvivorInstanceId;
  lowController: PlayerId;
  middleController: PlayerId;
}

function bitePosition(): BitePosition {
  let state = game();
  const attackerController = active(state);
  const [lowController, middleController, highController] = others(
    state,
    attackerController,
  );
  const attacker = spawnSurvivor(
    state,
    NOW,
    attackerController,
    "sv-loretta-clay",
    "school",
    false,
  );
  // Insert in descending influence order so passing cannot be accidental object order.
  const high = spawnSurvivor(
    state,
    NOW,
    highController!,
    "sv-loretta-clay",
    "school",
    false,
  );
  const middle = spawnSurvivor(
    state,
    NOW,
    middleController!,
    "sv-john-price",
    "school",
    false,
  );
  const low = spawnSurvivor(
    state,
    NOW,
    lowController!,
    "sv-forest-plum",
    "school",
    false,
  );
  addZombies(state, "school", 1);
  setDice(state, attackerController, [6]);
  nextRolls(state, [6]);
  muteCrossroads(state);
  state = act(state, attackerController, {
    type: "attackZombie",
    survivorId: attacker.id,
    die: 6,
  });
  return {
    state,
    attackerId: attacker.id,
    lowId: low.id,
    middleId: middle.id,
    highId: high.id,
    lowController: lowController!,
    middleController: middleController!,
  };
}

describe("A6 §9.2 bite chains", () => {
  it("selects lowest influence, continues after a non-blank roll, and stops on blank", () => {
    let {
      state: s,
      attackerId,
      lowId,
      middleId,
      highId,
      lowController,
      middleController,
    } = bitePosition();

    expect(pending(s)).toMatchObject({
      kind: "biteResponse",
      playerId: lowController,
      data: { survivorId: lowId, location: "school" },
    });
    expect(
      contentOf(s).survivors.get(s.survivors[lowId]!.cardId)!.influence,
    ).toBe(1);
    nextRolls(s, [4]); // every non-blank bite response is fatal and continues
    s = choose(s, lowController, pending(s)!.id, ["roll"]);

    expect(s.survivors[lowId]).toBeUndefined();
    expect(lastData(s, "biteRoll")).toMatchObject({
      survivorId: lowId,
      face: "wound",
    });
    expect(pending(s)).toMatchObject({
      kind: "biteResponse",
      playerId: middleController,
      data: { survivorId: middleId },
    });

    nextRolls(s, [1]);
    s = choose(s, middleController, pending(s)!.id, ["roll"]);

    expect(lastData(s, "biteRoll")).toMatchObject({
      survivorId: middleId,
      face: "blank",
    });
    expect(s.survivors[middleId]).toBeDefined();
    expect(s.survivors[highId]).toBeDefined();
    expect(pending(s)).toBeUndefined();
    const deaths = logEvents(s, "survivorDied").map(
      (entry) => entry.data?.["survivorId"],
    );
    expect(deaths).toEqual([attackerId, lowId]);
  });

  it("an automatic kill stops immediately without testing the next survivor", () => {
    let { state: s, lowId, middleId, highId, lowController } = bitePosition();
    const biteRollsBefore = logEvents(s, "biteRoll").length;

    s = choose(s, lowController, pending(s)!.id, ["kill"]);

    expect(s.survivors[lowId]).toBeUndefined();
    expect(s.survivors[middleId]).toBeDefined();
    expect(s.survivors[highId]).toBeDefined();
    expect(logEvents(s, "biteRoll")).toHaveLength(biteRollsBefore);
    expect(pending(s)).toBeUndefined();
  });

  it("equal-lowest influence pauses for the first player to choose the next bite victim", () => {
    let s = game();
    const attackerController = active(s);
    const [firstCandidateController, secondCandidateController] = others(
      s,
      attackerController,
    );
    const attacker = spawnSurvivor(
      s,
      NOW,
      attackerController,
      "sv-loretta-clay",
      "school",
      false,
    );
    const first = spawnSurvivor(
      s,
      NOW,
      firstCandidateController!,
      "sv-forest-plum",
      "school",
      false,
    );
    const second = spawnSurvivor(
      s,
      NOW,
      secondCandidateController!,
      "sv-forest-plum",
      "school",
      false,
    );
    addZombies(s, "school", 1);
    setDice(s, attackerController, [6]);
    nextRolls(s, [6]);
    muteCrossroads(s);

    s = act(s, attackerController, {
      type: "attackZombie",
      survivorId: attacker.id,
      die: 6,
    });

    expect(pending(s)).toMatchObject({
      playerId: s.firstPlayerId,
      options: expect.arrayContaining([
        expect.objectContaining({ id: first.id, legal: true }),
        expect.objectContaining({ id: second.id, legal: true }),
      ]),
    });
    expect(pending(s)!.kind).not.toBe("biteResponse");

    const tieChoice = pending(s)!;
    s = choose(s, s.firstPlayerId, tieChoice.id, [second.id]);
    expect(pending(s)).toMatchObject({
      kind: "biteResponse",
      playerId: secondCandidateController,
      data: { survivorId: second.id, location: "school" },
    });
  });
});

describe("A6 §9.4 last-survivor replacement", () => {
  function lastSurvivorBite(): {
    state: GameState;
    playerId: PlayerId;
    bystanderController: PlayerId;
    victimId: SurvivorInstanceId;
    bystanderId: SurvivorInstanceId;
    oldHand: string[];
    expectedReplacementCard: string;
    survivorAddsBeforeBite: number;
  } {
    let state = game();
    const playerId = active(state);
    const bystanderController = others(state, playerId)[0]!;
    const victim = survivorsOfPlayer(state, playerId)[0]!;
    onlySurvivor(state, playerId, victim.id);
    placeSurvivor(state, victim.id, "school");
    const bystander = spawnSurvivor(
      state,
      NOW,
      bystanderController,
      "sv-forest-plum",
      "school",
      false,
    );
    const oldHand = [...state.players[playerId]!.hand];
    const expectedReplacementCard = state.decks.survivors[0]!;
    const survivorAddsBeforeBite = logEvents(state, "survivorAdded").filter(
      (entry) => entry.playerId === playerId,
    ).length;
    addZombies(state, "school", 1);
    setDice(state, playerId, [6]);
    nextRolls(state, [6]);
    muteCrossroads(state);
    state = act(state, playerId, {
      type: "attackZombie",
      survivorId: victim.id,
      die: 6,
    });
    return {
      state,
      playerId,
      bystanderController,
      victimId: victim.id,
      bystanderId: bystander.id,
      oldHand,
      expectedReplacementCard,
      survivorAddsBeforeBite,
    };
  }

  it("does not add the replacement to an active bite chain, then restores the exact player as leader", () => {
    let {
      state: s,
      playerId,
      bystanderController,
      victimId,
      oldHand,
      expectedReplacementCard,
      survivorAddsBeforeBite,
    } = lastSurvivorBite();

    expect(s.survivors[victimId]).toBeUndefined();
    expect(survivorsOfPlayer(s, playerId)).toEqual([]);
    expect(
      logEvents(s, "survivorAdded").filter((e) => e.playerId === playerId),
    ).toHaveLength(survivorAddsBeforeBite);
    expect(pending(s)).toMatchObject({
      kind: "biteResponse",
      playerId: bystanderController,
    });

    s = choose(s, bystanderController, pending(s)!.id, ["kill"]);

    const replacement = survivorsOfPlayer(s, playerId);
    expect(replacement).toHaveLength(1);
    expect(replacement[0]).toMatchObject({
      cardId: expectedReplacementCard,
      controllerId: playerId,
      location: COLONY,
      isLeader: true,
      wounds: 0,
      frostbite: 0,
    });
    expect(s.players[playerId]!.leaderSurvivorId).toBe(replacement[0]!.id);
    expect(s.players[playerId]!.hand).toEqual([]);
    expect(s.decks.removedFromGame.items).toEqual(
      expect.arrayContaining(oldHand),
    );
    expect(replacement[0]!.location).not.toBe("school");
    expect(
      logEvents(s, "survivorAdded").filter((e) => e.playerId === playerId),
    ).toHaveLength(survivorAddsBeforeBite + 1);
  });

  it("adds the deferred replacement when a blank bite roll stops the chain", () => {
    let {
      state: s,
      playerId,
      bystanderController,
      bystanderId,
      expectedReplacementCard,
    } = lastSurvivorBite();
    nextRolls(s, [1]);

    s = choose(s, bystanderController, pending(s)!.id, ["roll"]);

    expect(lastData(s, "biteRoll")).toMatchObject({
      survivorId: bystanderId,
      face: "blank",
    });
    expect(s.survivors[bystanderId]).toBeDefined();
    expect(survivorsOfPlayer(s, playerId)).toHaveLength(1);
    expect(survivorsOfPlayer(s, playerId)[0]).toMatchObject({
      cardId: expectedReplacementCard,
      location: COLONY,
      isLeader: true,
    });
    expect(pending(s)).toBeUndefined();
  });

  it("an exiled last-survivor death preserves a private resumable placement choice", () => {
    let s = game();
    const playerId = active(s);
    const unauthorizedViewer = others(s, playerId)[0]!;
    const victim = survivorsOfPlayer(s, playerId)[0]!;
    onlySurvivor(s, playerId, victim.id);
    s.players[playerId]!.exiled = true;
    placeSurvivor(s, victim.id, "school");
    victim.wounds = 2;
    const oldHand = [...s.players[playerId]!.hand];
    const expectedReplacementCard = s.decks.survivors[0]!;
    const moraleBefore = s.colony.morale;
    addZombies(s, "school", 1);
    setDice(s, playerId, [6]);
    nextRolls(s, [4]);
    muteCrossroads(s);

    s = act(s, playerId, {
      type: "attackZombie",
      survivorId: victim.id,
      die: 6,
    });

    expect(s.survivors[victim.id]).toBeUndefined();
    expect(s.colony.morale).toBe(moraleBefore);
    expect(s.players[playerId]!.hand).toEqual([]);
    expect(s.decks.removedFromGame.items).toEqual(
      expect.arrayContaining(oldHand),
    );
    expect(pending(s)).toMatchObject({
      kind: "lastSurvivorPlacement",
      playerId,
      private: true,
      data: { cardId: expectedReplacementCard, asLeader: true },
      options: expect.arrayContaining([
        expect.objectContaining({ id: "library", legal: true }),
      ]),
    });

    const ownerView = redactStateFor(s, playerId);
    const otherView = redactStateFor(s, unauthorizedViewer);
    const spectatorView = redactStateFor(s, null);
    expect(pending(ownerView)).toMatchObject({
      kind: "lastSurvivorPlacement",
      data: { cardId: expectedReplacementCard },
    });
    expect(pending(otherView)).toMatchObject({
      kind: "lastSurvivorPlacement",
      prompt: "Waiting for a private decision.",
      options: expect.arrayContaining([
        expect.objectContaining({ id: "hidden:0", label: "?" }),
      ]),
    });
    expect(pending(otherView)!.data).toBeUndefined();
    expect(JSON.stringify(otherView)).not.toContain(expectedReplacementCard);
    expect(JSON.stringify(spectatorView)).not.toContain(
      expectedReplacementCard,
    );

    const restored = JSON.parse(JSON.stringify(s)) as GameState;
    expect(pending(restored)).toEqual(pending(s));
    s = choose(restored, playerId, pending(restored)!.id, ["library"]);

    const replacement = survivorsOfPlayer(s, playerId);
    expect(replacement).toHaveLength(1);
    expect(replacement[0]).toMatchObject({
      cardId: expectedReplacementCard,
      controllerId: playerId,
      location: "library",
      isLeader: true,
      wounds: 0,
      frostbite: 0,
    });
    expect(s.players[playerId]!.leaderSurvivorId).toBe(replacement[0]!.id);
    expect(pending(s)).toBeUndefined();
  });
});
