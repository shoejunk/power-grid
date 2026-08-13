/**
 * §4 standard setup and the §19 variant deltas — acceptance criteria §23.1 and
 * §23.2.
 *
 *   A1. "A standard game can be set up for every supported player count with the
 *        correct objective, betrayal probability, starting hand, survivors,
 *        colony placement, and first player."
 *   A2. "Cooperative, two-player, betrayer, hardcore, player-elimination, and
 *        Prisoner's Dilemma setup changes are isolated and reproducible."
 *
 * The design document is authoritative here, not the engine. Every `it` names
 * the section it encodes.
 */

import { describe, expect, it } from 'vitest';

import { NON_COLONY_LOCATIONS } from '../../content/primitives.js';
import type { GameSettings, GameState, PlayerId } from '../../types.js';
import { validateAction } from '../index.js';
import { deadOfWinter } from '../../plugin.js';
import type { GameOpts } from './helpers.js';
import { PACK, choose, fresh, start, survivorsOfPlayer } from './helpers.js';

/* ------------------------------------------------------------------ *
 * Local readers — no expectations live in here.
 * ------------------------------------------------------------------ */

/** §1: "Support 3-5 players for the standard hidden-objective game." */
const STANDARD_COUNTS = [3, 4, 5] as const;

/** A spread of fixed seeds. Deterministic, so nothing below can be flaky. */
const seedsFrom = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

const players = (s: GameState) => s.seating.map((id) => s.players[id]!);

const objectiveKind = (cardId: string): string | undefined =>
  PACK.secretObjectives.get(cardId)?.kind;

const secretObjectivesOf = (s: GameState, id: PlayerId): string[] =>
  s.players[id]!.secretObjectiveIds;

const dealtBetrayalCount = (s: GameState): number =>
  s.seating.reduce(
    (n, id) => n + secretObjectivesOf(s, id).filter((c) => objectiveKind(c) === 'betrayal').length,
    0,
  );

const handCardIds = (s: GameState, id: PlayerId): string[] =>
  s.players[id]!.hand.map((iid) => s.items[iid]!.cardId);

const allItemCardIds = (s: GameState): string[] =>
  Object.values(s.items).map((i) => i.cardId);

const survivorCardIdsInPlay = (s: GameState): string[] =>
  Object.values(s.survivors).map((sv) => sv.cardId);

const influenceOfLeader = (s: GameState, id: PlayerId): number => {
  const leaderId = s.players[id]!.leaderSurvivorId;
  const leader = leaderId ? s.survivors[leaderId] : undefined;
  return leader ? (PACK.survivors.get(leader.cardId)?.influence ?? -1) : -1;
};

const logData = (s: GameState, event: string): Record<string, unknown> | undefined =>
  s.log.find((l) => (l.data as { event?: string } | undefined)?.event === event)?.data as
    | Record<string, unknown>
    | undefined;

const eventIndex = (s: GameState, event: string): number =>
  s.log.findIndex((l) => (l.data as { event?: string } | undefined)?.event === event);

/**
 * Everything setup *dealt*, with nothing that the objective side controls.
 *
 * Used for the isolation tests: a variant that only changes the objective side
 * (§19.4) must leave this identical, and a variant that changes nothing at all
 * (§19.5) must leave this *and* the objective snapshot identical.
 */
function dealFingerprint(s: GameState) {
  return {
    seating: s.seating,
    firstPlayerId: s.firstPlayerId,
    rngCursor: s.rngCursor,
    crisis: s.decks.crisis,
    crossroads: s.decks.crossroads,
    survivorDeck: s.decks.survivors,
    exiledObjectives: s.decks.exiledObjectives,
    boxedObjectives: [...s.decks.returnedToBox.objectives].sort(),
    boxedItems: s.decks.returnedToBox.items.map((iid) => s.items[iid]!.cardId),
    locationDecks: Object.fromEntries(
      NON_COLONY_LOCATIONS.map((loc) => [
        loc,
        s.locations[loc]!.deck.map((iid) => s.items[iid]!.cardId),
      ]),
    ),
    hands: Object.fromEntries(s.seating.map((id) => [id, handCardIds(s, id)])),
    objectives: Object.fromEntries(s.seating.map((id) => [id, secretObjectivesOf(s, id)])),
    survivors: Object.fromEntries(
      s.seating.map((id) => [
        id,
        survivorsOfPlayer(s, id).map((sv) => ({
          cardId: sv.cardId,
          location: sv.location,
          isLeader: sv.isLeader,
        })),
      ]),
    ),
  };
}

function objectiveSnapshot(s: GameState) {
  return {
    cardId: s.mainObjective.cardId,
    side: s.mainObjective.side,
    morale: s.colony.morale,
    rounds: s.colony.rounds,
  };
}

type Opts = GameOpts;

const coop = (playerCount: number, seed = 'SEED-ALPHA'): Opts => ({
  playerCount,
  seed,
  settings: { mode: 'cooperative' },
});

/** §19.6's own defaults are its three suggestions (see `PrisonersDilemmaOptions`). */
const pd = (
  seed = 'SEED-ALPHA',
  toggles: Partial<GameSettings['prisonersDilemma']> = {},
): Opts => ({
  playerCount: 2,
  seed,
  settings: {
    mode: 'prisonersDilemma',
    prisonersDilemma: {
      roundZeroEndsLikeMoraleZero: true,
      keepNonCooperativeCards: true,
      removeExileDependentContent: true,
      ...toggles,
    },
  },
});

/* ================================================================== *
 * §1 — supported player counts
 * ================================================================== */

describe('§1 product modes and player counts', () => {
  it('§1 sets a standard hidden-objective game up at three, four and five players', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      expect({ n, phase: s.phase, seats: s.seating.length, round: s.round }).toEqual({
        n,
        phase: 'playerTurns',
        seats: n,
        round: 1,
      });
      expect(s.setupStage).toBe('done');
    }
  });

  it('§1 supports two players only through the cooperative and Prisoner’s Dilemma variants', () => {
    const base = deadOfWinter.defaultSettings();
    const check = (patch: Partial<GameSettings>, seats: number) =>
      deadOfWinter.validateSettings!({ ...base, ...patch }, seats).ok;

    expect(check({ mode: 'standard', playerCount: 2 }, 2)).toBe(false);
    expect(check({ mode: 'standard', playerCount: 3 }, 3)).toBe(true);
    expect(check({ mode: 'standard', playerCount: 5 }, 5)).toBe(true);
    expect(check({ mode: 'cooperative', playerCount: 2 }, 2)).toBe(true);
    expect(check({ mode: 'prisonersDilemma', playerCount: 2 }, 2)).toBe(true);
    expect(check({ mode: 'prisonersDilemma', playerCount: 3 }, 3)).toBe(false);
  });

  it('§1 sets a two-player cooperative and a two-player Prisoner’s Dilemma game up to round one', () => {
    for (const opts of [coop(2), pd()]) {
      const s = start(opts);
      expect({ phase: s.phase, seats: s.seating.length, round: s.round }).toEqual({
        phase: 'playerTurns',
        seats: 2,
        round: 1,
      });
    }
  });
});

/* ================================================================== *
 * §4.1 — board
 * ================================================================== */

describe('§4.1 board construction', () => {
  it('§4.1 creates the colony and six non-colony locations with their printed capacities', () => {
    const s = start({ playerCount: 4 });
    expect(Object.keys(s.locations).sort()).toEqual([...NON_COLONY_LOCATIONS].sort());
    for (const loc of NON_COLONY_LOCATIONS) {
      const def = PACK.locations.get(loc)!;
      const state = s.locations[loc]!;
      expect({
        loc,
        cap: state.survivorCapacity,
        entrance: state.entrance.capacity,
        noiseSpaces: state.noiseSpaces,
      }).toEqual({
        loc,
        cap: def.survivorCapacity,
        entrance: def.entranceCapacity,
        noiseSpaces: def.noiseSpaces,
      });
    }
  });

  it('§2.1 numbers the six colony entrances 1 through 6 in a fixed cycle', () => {
    const s = start({ playerCount: 3 });
    expect(s.colony.entrances.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.colony.entrances.every((e) => e.capacity === PACK.pack.colony.spacesPerEntrance)).toBe(
      true,
    );
    expect(s.colony.maxMorale).toBe(PACK.pack.colony.maxMorale);
  });
});

/* ================================================================== *
 * §4.3 — main objective
 * ================================================================== */

describe('§4.3 main objective', () => {
  it('§4.3 places the chosen standard main objective and initialises its morale and rounds at every player count', () => {
    const def = PACK.mainObjectives.get('mo-stockpile')!;
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n, settings: { mainObjectiveId: 'mo-stockpile' } });
      expect({ n, ...objectiveSnapshot(s) }).toEqual({
        n,
        cardId: 'mo-stockpile',
        side: 'standard',
        morale: def.standard.startingMorale,
        rounds: def.standard.startingRounds,
      });
    }
  });

  it('§4.3 selects a main objective from the pack when the table names none', () => {
    for (const seed of seedsFrom('objective', 8)) {
      const s = start({ playerCount: 4, seed });
      const def = PACK.mainObjectives.get(s.mainObjective.cardId);
      expect(def).toBeDefined();
      expect(s.mainObjective.side).toBe('standard');
      expect(s.colony.morale).toBe(def!.standard.startingMorale);
      expect(s.colony.rounds).toBe(def!.standard.startingRounds);
    }
  });

  it('§4.3 executes the objective’s setup instructions, adding scenario zombies before survivors are placed', () => {
    const s = start({
      playerCount: 4,
      settings: { mainObjectiveId: 'mo-we-need-more-samples' },
    });
    for (const loc of NON_COLONY_LOCATIONS) {
      expect({ loc, zombies: s.locations[loc]!.entrance.zombies }).toEqual({ loc, zombies: 1 });
    }
    const firstZombie = eventIndex(s, 'zombiePlacement');
    const firstSurvivor = eventIndex(s, 'survivorAdded');
    expect(firstZombie).toBeGreaterThanOrEqual(0);
    expect(firstSurvivor).toBeGreaterThanOrEqual(0);
    expect(firstZombie).toBeLessThan(firstSurvivor);
  });

  it('§18.2 records the number of players who started the game on the main objective', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n, settings: { mainObjectiveId: 'mo-we-need-more-samples' } });
      expect({ n, starting: s.mainObjective.startingPlayerCount }).toEqual({ n, starting: n });
      expect(s.mainObjective.counters).toEqual({ samples: 0 });
    }
  });
});

/* ================================================================== *
 * §4.4 / §4.6 — secret objectives and betrayal probability
 * ================================================================== */

describe('§4.4 secret objectives', () => {
  it('§4.4 deals exactly one face-down secret objective to each player at every standard player count', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      const dealt = s.seating.flatMap((id) => secretObjectivesOf(s, id));
      expect({ n, dealt: dealt.length }).toEqual({ n, dealt: n });
      expect(new Set(dealt).size).toBe(n);
      for (const card of dealt) {
        expect(['nonBetrayal', 'betrayal']).toContain(objectiveKind(card));
      }
      // §3: nothing is revealed at setup.
      for (const p of players(s)) expect(p.revealedObjectiveIds).toEqual([]);
    }
  });

  it('§4.4 sets aside two non-betrayal objectives per player and adds one betrayal card', () => {
    for (const n of STANDARD_COUNTS) {
      const s = fresh({ playerCount: n });
      const data = logData(s, 'secretObjectivesDealt');
      expect(data).toBeDefined();
      expect({ n, pool: data!.candidatePool, betrayal: data!.betrayalIncluded }).toEqual({
        n,
        pool: 2 * n + 1,
        betrayal: true,
      });
    }
  });

  it('§4.4 never deals more than one betrayal objective, and does deal it sometimes', () => {
    const observed = new Set<number>();
    for (const n of STANDARD_COUNTS) {
      for (const seed of seedsFrom('betrayal', 30)) {
        const s = start({ playerCount: n, seed });
        const count = dealtBetrayalCount(s);
        expect(count).toBeLessThanOrEqual(1);
        observed.add(count);
      }
    }
    // Non-vacuity: both outcomes have to be reachable, or the assertion above
    // would be satisfied by an engine that never deals the card at all.
    expect([...observed].sort()).toEqual([0, 1]);
  });

  it('§4.4 returns every unused secret objective to the box unseen, and never removes one from the game', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      const dealt = s.seating.flatMap((id) => secretObjectivesOf(s, id));
      const boxed = s.decks.returnedToBox.objectives;
      const pool = PACK.pack.secretObjectives
        .filter((o) => o.kind !== 'exiled')
        .map((o) => o.id);
      expect(pool.length).toBe(34);
      expect([...dealt, ...boxed].sort()).toEqual([...pool].sort());
      // §2.4: the box is not the removed-from-game pile.
      expect(boxed.some((id) => objectiveKind(id) === 'exiled')).toBe(false);
    }
  });

  it('§4.6 shuffles the exiled-objective deck independently and deals none of it at setup', () => {
    const s = start({ playerCount: 4 });
    const exiled = PACK.pack.secretObjectives.filter((o) => o.kind === 'exiled').map((o) => o.id);
    expect(exiled.length).toBe(10);
    expect([...s.decks.exiledObjectives].sort()).toEqual([...exiled].sort());
    for (const p of players(s)) {
      expect(p.exiledObjectiveId).toBeNull();
      expect(secretObjectivesOf(s, p.id).some((c) => objectiveKind(c) === 'exiled')).toBe(false);
    }
  });

  it('§18.1 standard setup may omit the betrayal secret objective', () => {
    for (const n of STANDARD_COUNTS) {
      const s = fresh({ playerCount: n, settings: { includeBetrayalObjective: false } });
      const data = logData(s, 'secretObjectivesDealt');
      expect(data).toBeDefined();
      expect({ n, pool: data!.candidatePool, betrayal: data!.betrayalIncluded }).toEqual({
        n,
        pool: 2 * n,
        betrayal: false,
      });
    }
  });

  it('§18.1 omitting the betrayal card leaves every player with a non-betrayal objective, on every seed', () => {
    for (const n of STANDARD_COUNTS) {
      for (const seed of seedsFrom('no-betrayal', 20)) {
        const s = start({ playerCount: n, seed, settings: { includeBetrayalObjective: false } });
        const dealt = s.seating.flatMap((id) => secretObjectivesOf(s, id));
        expect(dealt.length).toBe(n);
        expect(dealt.every((c) => objectiveKind(c) === 'nonBetrayal')).toBe(true);
      }
    }
  });

  it('§18.1 the betrayal card is included by default', () => {
    const s = fresh({ playerCount: 4 });
    expect(s.settings.includeBetrayalObjective).toBe(true);
    expect(deadOfWinter.defaultSettings().includeBetrayalObjective).toBe(true);
  });
});

/* ================================================================== *
 * §4.5, §4.7, §4.8, §4.9 — decks and starting hands
 * ================================================================== */

describe('§4.5-§4.9 decks and starting hands', () => {
  it('§4.8 deals five starter item cards to each player at every standard player count', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      for (const p of players(s)) {
        expect({ n, id: p.id, hand: p.hand.length }).toEqual({ n, id: p.id, hand: 5 });
        expect(new Set(p.hand).size).toBe(5);
        for (const cardId of handCardIds(s, p.id)) {
          expect(PACK.items.get(cardId)?.deck).toBe('starter');
        }
      }
      const allHeld = s.seating.flatMap((id) => s.players[id]!.hand);
      expect(new Set(allHeld).size).toBe(5 * n);
    }
  });

  it('§4.8 returns the unused starter cards to the box rather than removing them from the game', () => {
    const starterTotal = PACK.pack.items.filter((i) => i.deck === 'starter').length;
    expect(starterTotal).toBe(25);
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      expect(s.decks.starterItems).toEqual([]);
      expect({ n, boxed: s.decks.returnedToBox.items.length }).toEqual({
        n,
        boxed: starterTotal - 5 * n,
      });
      expect(s.decks.removedFromGame.items).toEqual([]);
      const held = new Set(s.seating.flatMap((id) => s.players[id]!.hand));
      expect(s.decks.returnedToBox.items.some((iid) => held.has(iid))).toBe(false);
    }
  });

  it('§4.5 shuffles the crisis deck with every crisis card in it', () => {
    // `fresh`, not `start`: §5.1 reveals the top crisis as soon as round one
    // begins, and this is an assertion about what *setup* prepared.
    const s = fresh({ playerCount: 4 });
    const ids = PACK.pack.crises.map((c) => c.id);
    expect(ids.length).toBe(20);
    expect([...s.decks.crisis].sort()).toEqual([...ids].sort());
    expect(s.crisis.cardId).toBeNull();
  });

  it('§4.6 shuffles the crossroads deck with every crossroads card in it', () => {
    const s = fresh({ playerCount: 4 });
    const ids = PACK.pack.crossroads.map((c) => c.id);
    expect(ids.length).toBe(80);
    expect([...s.decks.crossroads].sort()).toEqual([...ids].sort());
  });

  it('§4.6 leaves the survivor deck holding every survivor that is not in play', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      const inPlay = survivorCardIdsInPlay(s);
      expect(inPlay.length).toBe(2 * n);
      expect([...s.decks.survivors, ...inPlay].sort()).toEqual(
        PACK.pack.survivors.map((sv) => sv.id).sort(),
      );
      expect(new Set(s.decks.survivors).size).toBe(s.decks.survivors.length);
    }
  });

  it('§4.9 shuffles each location item deck and places it at that location', () => {
    const s = start({ playerCount: 4 });
    for (const loc of NON_COLONY_LOCATIONS) {
      const deck = s.locations[loc]!.deck;
      expect({ loc, size: deck.length }).toEqual({ loc, size: 20 });
      expect(new Set(deck).size).toBe(20);
      for (const iid of deck) expect(PACK.items.get(s.items[iid]!.cardId)?.deck).toBe(loc);
    }
  });

  it('§4.9 mints a distinct card instance for every item in the game', () => {
    const s = start({ playerCount: 4 });
    const iids = Object.keys(s.items);
    expect(iids.length).toBe(PACK.pack.items.length);
    expect(new Set(iids).size).toBe(iids.length);
    expect([...allItemCardIds(s)].sort()).toEqual(PACK.pack.items.map((i) => i.id).sort());
  });

  it('§4.7 removes mature-content cards before shuffling when the filter is enabled', () => {
    // `fresh`: §10 draws a crossroads card the moment the first turn starts.
    const off = fresh({ playerCount: 4 });
    const on = fresh({ playerCount: 4, settings: { matureContentFilter: true } });
    const mature = PACK.pack.crossroads.filter((c) => c.matureContent).map((c) => c.id);
    expect(mature.length).toBe(1);
    expect(off.decks.crossroads).toContain(mature[0]);
    expect(on.decks.crossroads).not.toContain(mature[0]);
    expect(on.decks.crossroads.length).toBe(off.decks.crossroads.length - mature.length);
  });
});

/* ================================================================== *
 * §4.10-§4.13 — survivors, leaders, first player
 * ================================================================== */

describe('§4.10-§4.13 survivors, leaders and the first player', () => {
  it('§4.10 deals four survivors and keeps two at every standard player count', () => {
    for (const n of STANDARD_COUNTS) {
      const s = fresh({ playerCount: n });
      const choices = s.pendingChoices.filter((c) => c.kind === 'setupKeepSurvivors');
      expect({ n, choices: choices.length }).toEqual({ n, choices: n });
      const seen: string[] = [];
      for (const c of choices) {
        expect(c.options.length).toBe(4);
        expect(c.minPicks).toBe(2);
        expect(c.maxPicks).toBe(2);
        // §3: the four cards dealt to a player are private to that player.
        expect(c.private).toBe(true);
        seen.push(...(c.data!.dealt as string[]));
      }
      // Every player is dealt four *different* survivors.
      expect(seen.length).toBe(4 * n);
      expect(new Set(seen).size).toBe(4 * n);

      const done = start({ playerCount: n });
      for (const p of players(done)) {
        expect({ n, id: p.id, kept: survivorsOfPlayer(done, p.id).length }).toEqual({
          n,
          id: p.id,
          kept: 2,
        });
      }
    }
  });

  it('§4.10 reshuffles the two returned survivors into the survivor deck and keeps the other two', () => {
    const s0 = fresh({ playerCount: 4 });
    const choice = s0.pendingChoices.find(
      (c) => c.kind === 'setupKeepSurvivors' && c.playerId === 'p1',
    )!;
    const dealt = choice.data!.dealt as string[];
    expect(dealt.length).toBe(4);
    const kept = dealt.slice(0, 2);
    const returned = dealt.slice(2);
    for (const card of dealt) expect(s0.decks.survivors).not.toContain(card);

    const s1 = choose(s0, 'p1', choice.id, kept);
    for (const card of returned) expect(s1.decks.survivors).toContain(card);
    for (const card of kept) expect(s1.decks.survivors).not.toContain(card);
    expect(survivorsOfPlayer(s1, 'p1').map((sv) => sv.cardId).sort()).toEqual([...kept].sort());
  });

  it('§4.11 gives every player exactly one group leader and makes the rest followers', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      for (const p of players(s)) {
        const mine = survivorsOfPlayer(s, p.id);
        expect(mine.length).toBeGreaterThan(0);
        const leaders = mine.filter((sv) => sv.isLeader);
        expect({ n, id: p.id, leaders: leaders.length }).toEqual({ n, id: p.id, leaders: 1 });
        expect(p.leaderSurvivorId).toBe(leaders[0]!.id);
      }
    }
  });

  it('§4.12 places every starting survivor in an empty colony survivor space', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n });
      const all = Object.values(s.survivors);
      expect(all.length).toBe(2 * n);
      expect(all.every((sv) => sv.location === 'colony')).toBe(true);
      expect(all.length + s.colony.helpless).toBeLessThanOrEqual(s.colony.survivorSpaces);
      expect(all.every((sv) => sv.wounds === 0 && sv.frostbite === 0)).toBe(true);
      expect(all.every((sv) => sv.equipped.length === 0)).toBe(true);
    }
  });

  it('§4.13 gives the first-player token to the player whose group leader has the highest influence', () => {
    for (const n of STANDARD_COUNTS) {
      for (const seed of seedsFrom('first-player', 12)) {
        const s = start({ playerCount: n, seed });
        const scores = s.seating.map((id) => influenceOfLeader(s, id));
        expect(scores.every((v) => v >= 0)).toBe(true);
        const best = Math.max(...scores);
        expect(influenceOfLeader(s, s.firstPlayerId)).toBe(best);
      }
    }
  });

  it('§4.13/§24 breaks an initial influence tie from the seed alone, deterministically', () => {
    let tieSeen = false;
    for (const seed of seedsFrom('tie', 40)) {
      const a = start({ playerCount: 4, seed });
      const data = logData(a, 'firstPlayer')!;
      const tied = data.tied as string[];
      expect(tied).toContain(a.firstPlayerId);
      if (tied.length > 1) {
        tieSeen = true;
        const b = start({ playerCount: 4, seed });
        expect(b.firstPlayerId).toBe(a.firstPlayerId);
      }
    }
    // §24 lists the tie-break as an open decision; if the fixture never produced
    // one the assertion above would be vacuous.
    expect(tieSeen).toBe(true);
  });
});

/* ================================================================== *
 * A2 — reproducibility
 * ================================================================== */

describe('§22/§23.2 reproducibility', () => {
  it('§22 reproduces a byte-identical standard setup from the same seed and settings', () => {
    for (const n of STANDARD_COUNTS) {
      expect(fresh({ playerCount: n, seed: 'REPRO' })).toEqual(fresh({ playerCount: n, seed: 'REPRO' }));
      expect(start({ playerCount: n, seed: 'REPRO' })).toEqual(start({ playerCount: n, seed: 'REPRO' }));
    }
  });

  it('§22 reproduces every variant setup from the same seed and settings', () => {
    const configs: Opts[] = [
      coop(4, 'REPRO'),
      coop(2, 'REPRO'),
      pd('REPRO'),
      { playerCount: 4, seed: 'REPRO', settings: { betrayerVariant: true } },
      { playerCount: 4, seed: 'REPRO', settings: { hardcore: true } },
      { playerCount: 4, seed: 'REPRO', settings: { playerElimination: true } },
      { playerCount: 4, seed: 'REPRO', settings: { includeBetrayalObjective: false } },
    ];
    for (const cfg of configs) expect(start(cfg)).toEqual(start(cfg));
  });

  it('§22 produces a different deal from a different seed', () => {
    const a = dealFingerprint(start({ playerCount: 4, seed: 'SEED-A' }));
    const b = dealFingerprint(start({ playerCount: 4, seed: 'SEED-B' }));
    expect(a).not.toEqual(b);
  });
});

/* ================================================================== *
 * §19.1 — cooperative
 * ================================================================== */

describe('§19.1 cooperative variant', () => {
  it('§19.1 uses the hardcore side of the chosen main objective', () => {
    const def = PACK.mainObjectives.get('mo-stockpile')!;
    for (const n of [2, 3, 4, 5]) {
      const s = start({
        playerCount: n,
        settings: { mode: 'cooperative', mainObjectiveId: 'mo-stockpile' },
      });
      expect({ n, ...objectiveSnapshot(s) }).toEqual({
        n,
        cardId: 'mo-stockpile',
        side: 'hardcore',
        morale: def.hardcore.startingMorale,
        rounds: def.hardcore.startingRounds,
      });
    }
  });

  it('§19.1 deals no secret objectives and boxes every one of them', () => {
    for (const n of [2, 3, 4, 5]) {
      const s = start(coop(n));
      for (const p of players(s)) {
        expect({ n, id: p.id, objectives: p.secretObjectiveIds }).toEqual({
          n,
          id: p.id,
          objectives: [],
        });
      }
      const pool = PACK.pack.secretObjectives.filter((o) => o.kind !== 'exiled').map((o) => o.id);
      expect([...s.decks.returnedToBox.objectives].sort()).toEqual([...pool].sort());
      expect(logData(s, 'secretObjectivesDealt')).toBeUndefined();
    }
  });

  it('§19.1 removes every card marked with the non-cooperative symbol', () => {
    const s = start(coop(4));

    const nonCoopItems = PACK.pack.items.filter((i) => i.nonCooperative).map((i) => i.id);
    const nonCoopSurvivors = PACK.pack.survivors.filter((v) => v.nonCooperative).map((v) => v.id);
    const nonCoopCrossroads = PACK.pack.crossroads.filter((c) => c.nonCooperative).map((c) => c.id);
    expect(nonCoopItems.length).toBeGreaterThan(0);
    expect(nonCoopSurvivors.length).toBeGreaterThan(0);
    expect(nonCoopCrossroads.length).toBeGreaterThan(0);

    for (const id of nonCoopItems) expect(allItemCardIds(s)).not.toContain(id);
    for (const id of nonCoopSurvivors) {
      expect(s.decks.survivors).not.toContain(id);
      expect(survivorCardIdsInPlay(s)).not.toContain(id);
    }
    for (const id of nonCoopCrossroads) expect(s.decks.crossroads).not.toContain(id);
  });

  it('§19.1 keeps every cooperative-legal card, so the filter is not indiscriminate', () => {
    const s = fresh(coop(4));
    // The mature-content filter is off here, so §19.1's symbol is the only
    // reason a card may be missing.
    const keptCrossroads = PACK.pack.crossroads
      .filter((c) => !c.nonCooperative)
      .map((c) => c.id);
    expect([...s.decks.crossroads].sort()).toEqual([...keptCrossroads].sort());
    const keptItems = PACK.pack.items.filter((i) => !i.nonCooperative).map((i) => i.id);
    expect([...allItemCardIds(s)].sort()).toEqual([...keptItems].sort());
  });

  it('§19.1 disables exile votes', () => {
    const s = start(coop(4));
    const actor = s.turn!.playerId;
    const target = s.seating.find((id) => id !== actor)!;
    const verdict = validateAction(s, actor, { type: 'nominateExile', targetPlayerId: target });
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('§19.1');
  });

  it('§19.1 does not disable exile votes in a standard game', () => {
    const s = start({ playerCount: 4 });
    const actor = s.turn!.playerId;
    const target = s.seating.find((id) => id !== actor)!;
    expect(validateAction(s, actor, { type: 'nominateExile', targetPlayerId: target }).ok).toBe(
      true,
    );
  });

  it('§19.1/§19.2 leaves the five-card hand and two-survivor keep alone above two players', () => {
    for (const n of [3, 4]) {
      const s = start(coop(n));
      for (const p of players(s)) {
        expect({ n, id: p.id, hand: p.hand.length, kept: survivorsOfPlayer(s, p.id).length }).toEqual(
          { n, id: p.id, hand: 5, kept: 2 },
        );
      }
    }
  });

  it('§4.8/§19.1 deals a full five-card starting hand to all five players in a five-player cooperative game', () => {
    // §4.8 is unconditional — "Deal five starter item cards to each player" —
    // and §19.1 does not shrink the hand. Five players therefore need 25
    // cooperative-legal starter cards, and §2.0 supplies exactly 25 starter
    // cards in total, so no starter card may carry the non-cooperative symbol.
    const s = start(coop(5));
    for (const p of players(s)) {
      expect({ id: p.id, hand: p.hand.length }).toEqual({ id: p.id, hand: 5 });
    }
  });
});

/* ================================================================== *
 * §19.2 — two-player cooperative
 * ================================================================== */

describe('§19.2 two-player cooperative variant', () => {
  it('§19.2 deals seven starter items to each player instead of five', () => {
    const s = start(coop(2));
    for (const p of players(s)) {
      expect({ id: p.id, hand: p.hand.length }).toEqual({ id: p.id, hand: 7 });
      for (const cardId of handCardIds(s, p.id)) {
        expect(PACK.items.get(cardId)?.deck).toBe('starter');
      }
    }
    expect(logData(s, 'startingHands')).toMatchObject({ size: 7 });
  });

  it('§19.2 deals four survivors to each player and keeps three instead of two', () => {
    const s0 = fresh(coop(2));
    const choices = s0.pendingChoices.filter((c) => c.kind === 'setupKeepSurvivors');
    expect(choices.length).toBe(2);
    for (const c of choices) {
      expect(c.options.length).toBe(4);
      expect(c.minPicks).toBe(3);
      expect(c.maxPicks).toBe(3);
    }
    const s = start(coop(2));
    for (const p of players(s)) {
      expect({ id: p.id, kept: survivorsOfPlayer(s, p.id).length }).toEqual({ id: p.id, kept: 3 });
    }
    expect(Object.values(s.survivors).every((sv) => sv.location === 'colony')).toBe(true);
  });

  it('§19.2 uses all the cooperative rules on top of its two deltas', () => {
    const s = start({
      playerCount: 2,
      settings: { mode: 'cooperative', mainObjectiveId: 'mo-stockpile' },
    });
    expect(s.mainObjective.side).toBe('hardcore');
    for (const p of players(s)) expect(p.secretObjectiveIds).toEqual([]);
    for (const id of PACK.pack.items.filter((i) => i.nonCooperative).map((i) => i.id)) {
      expect(allItemCardIds(s)).not.toContain(id);
    }
    const actor = s.turn!.playerId;
    const target = s.seating.find((id) => id !== actor)!;
    expect(validateAction(s, actor, { type: 'nominateExile', targetPlayerId: target }).ok).toBe(
      false,
    );
  });

  it('§19.2 does not leak its seven-card hand into a non-cooperative two-seat game', () => {
    // The Prisoner's Dilemma variant sets its own hand size (§19.6); a standard
    // game never has two seats (§1). The check that matters is that the delta is
    // keyed on "cooperative *and* two players", not on either alone.
    const threeCoop = start(coop(3));
    expect(threeCoop.players['p1']!.hand.length).toBe(5);
    const fourStandard = start({ playerCount: 4 });
    expect(fourStandard.players['p1']!.hand.length).toBe(5);
  });
});

/* ================================================================== *
 * §19.3 — betrayer
 * ================================================================== */

describe('§19.3 betrayer variant', () => {
  it('§19.3 sets aside only one non-betrayal objective per player before adding the betrayal card', () => {
    for (const n of STANDARD_COUNTS) {
      const s = fresh({ playerCount: n, settings: { betrayerVariant: true } });
      const data = logData(s, 'secretObjectivesDealt');
      expect(data).toBeDefined();
      expect({ n, pool: data!.candidatePool, betrayal: data!.betrayalIncluded }).toEqual({
        n,
        pool: n + 1,
        betrayal: true,
      });
    }
  });

  it('§19.3 still deals exactly one objective per player, at most one of them a betrayal', () => {
    for (const n of STANDARD_COUNTS) {
      for (const seed of seedsFrom('betrayer', 20)) {
        const s = start({ playerCount: n, seed, settings: { betrayerVariant: true } });
        const dealt = s.seating.flatMap((id) => secretObjectivesOf(s, id));
        expect(dealt.length).toBe(n);
        expect(new Set(dealt).size).toBe(n);
        expect(dealtBetrayalCount(s)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('§19.3 raises the chance that the betrayal objective is dealt', () => {
    // Deck composition, not a sample, is the real proof (the test above); this
    // fixes 60 seeds so the comparison is deterministic rather than statistical.
    const seeds = seedsFrom('probability', 60);
    const count = (betrayerVariant: boolean) =>
      seeds.filter(
        (seed) => dealtBetrayalCount(start({ playerCount: 4, seed, settings: { betrayerVariant } })) > 0,
      ).length;
    const standard = count(false);
    const betrayer = count(true);
    expect(betrayer).toBeGreaterThan(standard);
  });

  it('§19.3 changes nothing else: "all other standard rules remain unchanged"', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n, settings: { betrayerVariant: true } });
      expect(s.mainObjective.side).toBe('standard');
      for (const p of players(s)) {
        expect({
          n,
          id: p.id,
          hand: p.hand.length,
          kept: survivorsOfPlayer(s, p.id).length,
          objectives: p.secretObjectiveIds.length,
        }).toEqual({ n, id: p.id, hand: 5, kept: 2, objectives: 1 });
      }
      const actor = s.turn!.playerId;
      const target = s.seating.find((id) => id !== actor)!;
      expect(validateAction(s, actor, { type: 'nominateExile', targetPlayerId: target }).ok).toBe(
        true,
      );
    }
  });

  it('§19.3 stays out of a game that did not select it', () => {
    for (const n of STANDARD_COUNTS) {
      const s = fresh({ playerCount: n });
      expect(logData(s, 'secretObjectivesDealt')!.candidatePool).toBe(2 * n + 1);
    }
  });
});

/* ================================================================== *
 * §19.4 — hardcore
 * ================================================================== */

describe('§19.4 hardcore variant', () => {
  it('§19.4 uses the hardcore side of the selected main objective', () => {
    const def = PACK.mainObjectives.get('mo-stockpile')!;
    for (const n of STANDARD_COUNTS) {
      const s = start({
        playerCount: n,
        settings: { hardcore: true, mainObjectiveId: 'mo-stockpile' },
      });
      expect({ n, ...objectiveSnapshot(s) }).toEqual({
        n,
        cardId: 'mo-stockpile',
        side: 'hardcore',
        morale: def.hardcore.startingMorale,
        rounds: def.hardcore.startingRounds,
      });
    }
  });

  it('§19.4 keeps secret objectives, "otherwise using normal mode rules"', () => {
    for (const n of STANDARD_COUNTS) {
      const s = start({ playerCount: n, settings: { hardcore: true } });
      for (const p of players(s)) {
        expect({ n, id: p.id, objectives: p.secretObjectiveIds.length, hand: p.hand.length }).toEqual(
          { n, id: p.id, objectives: 1, hand: 5 },
        );
      }
      const actor = s.turn!.playerId;
      const target = s.seating.find((id) => id !== actor)!;
      expect(validateAction(s, actor, { type: 'nominateExile', targetPlayerId: target }).ok).toBe(
        true,
      );
    }
  });

  it('§19.4 changes only the objective side, leaving the whole deal untouched', () => {
    const opts = { playerCount: 4, seed: 'HARDCORE', settings: { mainObjectiveId: 'mo-stockpile' } };
    const normal = start(opts);
    const hard = start({ ...opts, settings: { ...opts.settings, hardcore: true } });
    expect(dealFingerprint(hard)).toEqual(dealFingerprint(normal));
    expect(objectiveSnapshot(hard)).not.toEqual(objectiveSnapshot(normal));
    expect(hard.mainObjective.side).toBe('hardcore');
    expect(normal.mainObjective.side).toBe('standard');
  });
});

/* ================================================================== *
 * §19.5 — player elimination
 * ================================================================== */

describe('§19.5 player-elimination variant', () => {
  it('§19.5 changes nothing about setup', () => {
    for (const n of STANDARD_COUNTS) {
      const opts = { playerCount: n, seed: 'ELIM', settings: { mainObjectiveId: 'mo-stockpile' } };
      const normal = start(opts);
      const elim = start({ ...opts, settings: { ...opts.settings, playerElimination: true } });
      expect(dealFingerprint(elim)).toEqual(dealFingerprint(normal));
      expect(objectiveSnapshot(elim)).toEqual(objectiveSnapshot(normal));
    }
  });

  it('§19.5 records the flag and starts every player active', () => {
    const s = start({ playerCount: 4, settings: { playerElimination: true } });
    expect(s.settings.playerElimination).toBe(true);
    for (const p of players(s)) expect(p.eliminated).toBe(false);
    expect(s.mainObjective.startingPlayerCount).toBe(4);
  });
});

/* ================================================================== *
 * §19.6 — Prisoner's Dilemma
 * ================================================================== */

describe('§19.6 Prisoner’s Dilemma variant', () => {
  it('§19.6 deals each player one regular and one betrayal secret objective', () => {
    for (const seed of seedsFrom('pd-objectives', 12)) {
      const s = start(pd(seed));
      for (const p of players(s)) {
        const kinds = p.secretObjectiveIds.map(objectiveKind).sort();
        expect({ id: p.id, kinds }).toEqual({ id: p.id, kinds: ['betrayal', 'nonBetrayal'] });
      }
      const dealt = s.seating.flatMap((id) => secretObjectivesOf(s, id));
      expect(dealt.length).toBe(4);
      expect(new Set(dealt).size).toBe(4);
    }
  });

  it('§19.6 returns the undealt secret objectives to the box', () => {
    const s = start(pd());
    const dealt = s.seating.flatMap((id) => secretObjectivesOf(s, id));
    const pool = PACK.pack.secretObjectives.filter((o) => o.kind !== 'exiled').map((o) => o.id);
    expect([...dealt, ...s.decks.returnedToBox.objectives].sort()).toEqual([...pool].sort());
  });

  it('§19.6 begins from the two-player cooperative deal: seven starter items and three survivors kept', () => {
    const s0 = fresh(pd());
    for (const c of s0.pendingChoices.filter((c) => c.kind === 'setupKeepSurvivors')) {
      expect(c.options.length).toBe(4);
      expect(c.minPicks).toBe(3);
    }
    const s = start(pd());
    for (const p of players(s)) {
      expect({ id: p.id, hand: p.hand.length, kept: survivorsOfPlayer(s, p.id).length }).toEqual({
        id: p.id,
        hand: 7,
        kept: 3,
      });
    }
  });

  it('§19.6 begins from the two-player cooperative setup, which uses the hardcore side of the main objective', () => {
    const def = PACK.mainObjectives.get('mo-stockpile')!;
    const base = pd();
    const s = start({ ...base, settings: { ...base.settings!, mainObjectiveId: 'mo-stockpile' } });
    expect(objectiveSnapshot(s)).toEqual({
      cardId: 'mo-stockpile',
      side: 'hardcore',
      morale: def.hardcore.startingMorale,
      rounds: def.hardcore.startingRounds,
    });
  });

  it('§19.6 exposes "do not remove non-cooperative cards" as a toggle, not a hardcoded rule', () => {
    const nonCoopItems = PACK.pack.items.filter((i) => i.nonCooperative).map((i) => i.id);
    const nonCoopSurvivors = PACK.pack.survivors.filter((v) => v.nonCooperative).map((v) => v.id);
    expect(nonCoopItems.length).toBeGreaterThan(0);
    expect(nonCoopSurvivors.length).toBeGreaterThan(0);

    const kept = start(pd('SEED-ALPHA', { keepNonCooperativeCards: true }));
    for (const id of nonCoopItems) expect(allItemCardIds(kept)).toContain(id);
    for (const id of nonCoopSurvivors) {
      expect([...kept.decks.survivors, ...survivorCardIdsInPlay(kept)]).toContain(id);
    }

    const removed = start(pd('SEED-ALPHA', { keepNonCooperativeCards: false }));
    for (const id of nonCoopItems) expect(allItemCardIds(removed)).not.toContain(id);
    for (const id of nonCoopSurvivors) {
      expect([...removed.decks.survivors, ...survivorCardIdsInPlay(removed)]).not.toContain(id);
    }
  });

  it('§19.6 exposes "remove exile-dependent content" as a toggle, not a hardcoded rule', () => {
    const exileDependent = PACK.pack.crossroads.filter((c) => c.dependsOnExile).map((c) => c.id);
    expect(exileDependent.length).toBeGreaterThan(0);

    const on = start(pd('SEED-ALPHA', { keepNonCooperativeCards: true, removeExileDependentContent: true }));
    const off = start(pd('SEED-ALPHA', { keepNonCooperativeCards: true, removeExileDependentContent: false }));
    for (const id of exileDependent) {
      expect(on.decks.crossroads).not.toContain(id);
      expect(off.decks.crossroads).toContain(id);
    }
    expect(off.decks.crossroads.length).toBe(on.decks.crossroads.length + exileDependent.length);
  });

  it('§19.6 exposes "round zero ends like morale zero" as a stored toggle that does not touch setup', () => {
    const yes = start(pd('SEED-ALPHA', { roundZeroEndsLikeMoraleZero: true }));
    const no = start(pd('SEED-ALPHA', { roundZeroEndsLikeMoraleZero: false }));
    expect(yes.settings.prisonersDilemma.roundZeroEndsLikeMoraleZero).toBe(true);
    expect(no.settings.prisonersDilemma.roundZeroEndsLikeMoraleZero).toBe(false);
    expect(dealFingerprint(no)).toEqual(dealFingerprint(yes));
    expect(objectiveSnapshot(no)).toEqual(objectiveSnapshot(yes));
  });

  it('§19.6 defaults each toggle to the designer’s suggestion', () => {
    expect(deadOfWinter.defaultSettings().prisonersDilemma).toEqual({
      roundZeroEndsLikeMoraleZero: true,
      keepNonCooperativeCards: true,
      removeExileDependentContent: true,
    });
  });

  it('§19.6 toggles have no effect on a game that is not Prisoner’s Dilemma', () => {
    const base: Opts = { playerCount: 4, seed: 'ISO', settings: { mainObjectiveId: 'mo-stockpile' } };
    const a = start(base);
    const b = start({
      ...base,
      settings: {
        ...base.settings,
        prisonersDilemma: {
          roundZeroEndsLikeMoraleZero: false,
          keepNonCooperativeCards: false,
          removeExileDependentContent: false,
        },
      },
    });
    expect(dealFingerprint(b)).toEqual(dealFingerprint(a));
    expect(objectiveSnapshot(b)).toEqual(objectiveSnapshot(a));
  });
});

/* ================================================================== *
 * §23.2 — cross-variant isolation
 * ================================================================== */

describe('§23.2 variant isolation', () => {
  it('§19 each variant produces its own deal profile and no other variant’s', () => {
    // The objective *side* is asserted per variant in the sections above; this
    // is the deal, which is the part §19.2/§19.6 change and §19.3/§19.4/§19.5
    // must not.
    const profileOf = (s: GameState) => ({
      hand: s.players[s.seating[0]!]!.hand.length,
      kept: survivorsOfPlayer(s, s.seating[0]!).length,
      objectives: s.players[s.seating[0]!]!.secretObjectiveIds.length,
    });

    expect(profileOf(start({ playerCount: 4 }))).toEqual({ hand: 5, kept: 2, objectives: 1 });
    expect(profileOf(start({ playerCount: 4, settings: { hardcore: true } }))).toEqual({
      hand: 5,
      kept: 2,
      objectives: 1,
    });
    expect(profileOf(start({ playerCount: 4, settings: { betrayerVariant: true } }))).toEqual({
      hand: 5,
      kept: 2,
      objectives: 1,
    });
    expect(profileOf(start({ playerCount: 4, settings: { playerElimination: true } }))).toEqual({
      hand: 5,
      kept: 2,
      objectives: 1,
    });
    expect(profileOf(start(coop(4)))).toEqual({ hand: 5, kept: 2, objectives: 0 });
    expect(profileOf(start(coop(2)))).toEqual({ hand: 7, kept: 3, objectives: 0 });
    expect(profileOf(start(pd()))).toEqual({ hand: 7, kept: 3, objectives: 2 });
  });

  it('§19.1 the cooperative objective removal does not reach a standard game', () => {
    for (const n of STANDARD_COUNTS) {
      const s = fresh({ playerCount: n });
      for (const p of players(s)) expect(p.secretObjectiveIds.length).toBe(1);
      for (const id of PACK.pack.items.filter((i) => i.nonCooperative).map((i) => i.id)) {
        expect(allItemCardIds(s)).toContain(id);
      }
      for (const id of PACK.pack.crossroads.filter((c) => c.nonCooperative).map((c) => c.id)) {
        expect(s.decks.crossroads).toContain(id);
      }
    }
  });

  it('§1 mode selection happens before decks, objectives and starting hands are prepared', () => {
    // The observable form of §1's requirement: two modes on the same seed cannot
    // produce the same prepared decks, because the mode changed what was
    // prepared rather than being patched in afterwards.
    const standard = start({ playerCount: 4, seed: 'MODE' });
    const cooperative = start(coop(4, 'MODE'));
    expect(dealFingerprint(cooperative)).not.toEqual(dealFingerprint(standard));
    expect(standard.settings.mode).toBe('standard');
    expect(cooperative.settings.mode).toBe('cooperative');
  });
});
