/**
 * Standard setup (§4) and the variant deltas of §19.
 *
 * §1 is emphatic that "mode selection must happen before decks, objectives, and
 * starting hands are prepared because several modes change those operations",
 * so the variant is read once at the top of `createGame` and drives every step
 * below rather than being patched in afterwards.
 *
 * §4 also requires that "the complete card identities selected, returned to the
 * box, and dealt must be retained in authoritative hidden state so a match can
 * reconnect or replay without changing setup". Nothing here throws a card away:
 * the box pile is a real zone, distinct from removed-from-game (§2.4).
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';

import {
  COLONY,
  NON_COLONY_LOCATIONS,
  type CardId,
  type NonColonyLocationId,
} from '../content/primitives.js';
import type { ContentIndex } from '../content/schema.js';
import type {
  ColonyState,
  DeckState,
  GameSettings,
  GameState,
  LocationState,
  PlayerState,
  SurvivorInstance,
} from '../types.js';
import { STATE_VERSION } from '../types.js';
import {
  contentOf,
  getPlayer,
  nextId,
  pushChoice,
  pushFrame,
  pushLog,
  survivorsOf,
  withRng,
} from './state.js';
import { breakInitialFirstPlayerTie } from './policy.js';
import { placeSurvivor } from './survivors.js';

/* ------------------------------------------------------------------ *
 * Variant reading (§19)
 * ------------------------------------------------------------------ */

/**
 * The setup-relevant consequences of the chosen mode, computed once.
 *
 * Reading §19 into a small record here means the steps below never branch on
 * the mode name — which is what makes §23's "setup changes are isolated and
 * reproducible" checkable: the record is the isolation.
 */
export interface SetupProfile {
  /** §19.1/§19.4 both select the hardcore side of the main objective. */
  useHardcoreSide: boolean;
  /** §19.1: cooperative games deal no secret objectives at all. */
  dealsSecretObjectives: boolean;
  /** §19.6 deals one regular *and* one betrayal objective to each player. */
  dealsBetrayalToEveryone: boolean;
  /** §19.2/§19.6: seven starter items instead of five. */
  starterHandSize: number;
  /** §19.2/§19.6: keep three of the four dealt survivors instead of two. */
  survivorsKept: number;
  /** §19.1: remove every card marked with the non-cooperative symbol. */
  removeNonCooperative: boolean;
  /** §19.6's third suggestion. */
  removeExileDependent: boolean;
  /** §19.1: exile votes are disabled outright. */
  exileEnabled: boolean;
  /** §19.3: set aside one non-betrayal objective per player instead of two. */
  nonBetrayalPerPlayer: number;
}

export function setupProfile(settings: GameSettings): SetupProfile {
  const coop = settings.mode === 'cooperative';
  const pd = settings.mode === 'prisonersDilemma';
  const twoPlayerCoop = coop && settings.playerCount === 2;

  return {
    // §19.6 "begin from the two-player cooperative setup" → §19.2 "use all
    // cooperative rules, plus" → §19.1's first bullet, the hardcore side. PD
    // already inherits §19.2's hand and survivor deltas below; the objective
    // side comes from the same chain and was the one link missing.
    useHardcoreSide: coop || pd || settings.hardcore,
    dealsSecretObjectives: !coop,
    dealsBetrayalToEveryone: pd,
    starterHandSize: twoPlayerCoop || pd ? 7 : 5,
    survivorsKept: twoPlayerCoop || pd ? 3 : 2,
    // §19.6 keeps non-cooperative cards by default; its toggle inverts that.
    removeNonCooperative: coop || (pd && !settings.prisonersDilemma.keepNonCooperativeCards),
    removeExileDependent: pd && settings.prisonersDilemma.removeExileDependentContent,
    exileEnabled: !coop,
    nonBetrayalPerPlayer: settings.betrayerVariant ? 1 : 2,
  };
}

/* ------------------------------------------------------------------ *
 * Board construction (§4.1)
 * ------------------------------------------------------------------ */

function buildColony(content: ContentIndex): ColonyState {
  const def = content.pack.colony;
  return {
    morale: 0,
    maxMorale: def.maxMorale,
    rounds: 0,
    food: 0,
    starvation: 0,
    helpless: 0,
    survivorSpaces: def.survivorSpaces,
    entrances: Array.from({ length: def.entranceCount }, (_, i) => ({
      index: i + 1,
      capacity: def.spacesPerEntrance,
      zombies: 0,
      barricades: 0,
    })),
    entrancePointer: 0,
    waste: [],
  };
}

function buildLocations(content: ContentIndex): Record<string, LocationState> {
  const out: Record<string, LocationState> = {};
  for (const id of NON_COLONY_LOCATIONS) {
    const def = content.locations.get(id);
    if (!def) throw new Error(`Content pack is missing location '${id}'`);
    out[id] = {
      id,
      survivorCapacity: def.survivorCapacity,
      entrance: { index: 1, capacity: def.entranceCapacity, zombies: 0, barricades: 0 },
      noise: 0,
      noiseSpaces: def.noiseSpaces,
      deck: [],
    };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * buildGame (§4)
 * ------------------------------------------------------------------ */

/**
 * Builds the §4 starting position and stops.
 *
 * Deliberately **not** named `createGame`: the engine's public `createGame`
 * lives in `engine/index.ts`, wraps this, and then runs `advance()` to reach the
 * first human decision. `engine/index.ts` re-exports this module wholesale, so
 * two functions of the same name would collide in that barrel — and the two
 * resolutions are not equivalent. Node's ESM gives the local declaration
 * precedence (the correct, advancing one), while Vite/Vitest resolves the star
 * re-export instead, which would hand the test suite a game frozen at
 * `setupStage: 'dealSurvivors'` with no choices dealt. Distinct names remove the
 * ambiguity rather than relying on either resolution order.
 */
export function buildGame(
  ctx: CreateGameContext,
  settings: GameSettings,
  seats: SeatSeed[],
  content: ContentIndex,
): GameState {
  const profile = setupProfile(settings);
  const now = ctx.now;

  const players: Record<string, PlayerState> = {};
  seats.forEach((seat, i) => {
    players[seat.playerId] = {
      id: seat.playerId,
      name: seat.name,
      color: seat.color,
      seatIndex: i,
      exiled: false,
      eliminated: false,
      leaderSurvivorId: null,
      hand: [],
      secretObjectiveIds: [],
      exiledObjectiveId: null,
      revealedObjectiveIds: [],
      unusedDice: [],
      usedDice: [],
      nominatedThisTurn: false,
      connected: true,
    };
  });

  const decks: DeckState = {
    starterItems: [],
    survivors: [],
    crossroads: [],
    crisis: [],
    exiledObjectives: [],
    returnedToBox: { items: [], survivors: [], objectives: [] },
    removedFromGame: { items: [], survivors: [] },
  };

  const state: GameState = {
    version: STATE_VERSION,
    gameId: ctx.gameId,
    code: ctx.code,
    hostId: ctx.hostId,
    createdAt: now,
    updatedAt: now,
    settings,
    contentPackId: content.pack.id,
    contentVersion: content.pack.version,
    seed: settings.seed || ctx.seed,
    rngCursor: 0,
    phase: 'setup',
    colonyStep: null,
    round: 0,
    roundsSurvived: 0,
    seating: seats.map((s) => s.playerId),
    firstPlayerId: seats[0]!.playerId,
    activePlayerId: null,
    turn: null,
    colony: buildColony(content),
    locations: buildLocations(content),
    players,
    survivors: {},
    items: {},
    decks,
    crisis: { cardId: null, contributions: [] },
    mainObjective: {
      cardId: '',
      side: profile.useHardcoreSide ? 'hardcore' : 'standard',
      contributions: [],
      contributionsThisTurn: 0,
      counters: {},
      startingPlayerCount: seats.length,
    },
    effectStack: [],
    pendingChoices: [],
    search: null,
    request: null,
    vote: null,
    deferMoraleCheck: false,
    nextSeq: 0,
    log: [],
    outcome: null,
  };

  pushLog(state, now, {
    category: 'setup',
    message: `Setting up a ${settings.mode} game for ${seats.length}.`,
    data: {
      event: 'setupStart',
      mode: settings.mode,
      hardcore: profile.useHardcoreSide,
      betrayerVariant: settings.betrayerVariant,
      playerElimination: settings.playerElimination,
      contentPack: `${content.pack.id}@${content.pack.version}`,
    },
  });

  chooseMainObjective(state, now, content, profile, settings);
  prepareSecretObjectives(state, now, content, profile, settings);
  prepareDecks(state, now, content, profile, settings);
  dealStarterHands(state, now, profile);

  // §4.3: "Scenario setup may add zombies before survivors are placed", so the
  // objective's own setup instructions run as a normal effect frame, ahead of
  // the survivor deal.
  const objective = content.mainObjectives.get(state.mainObjective.cardId)!;
  const side = profile.useHardcoreSide ? objective.hardcore : objective.standard;
  pushFrame(state, [...side.setup]);

  state.setupStage = 'dealSurvivors';
  return state;
}

/* ------------------------------------------------------------------ *
 * §4.3 — main objective
 * ------------------------------------------------------------------ */

function chooseMainObjective(
  state: GameState,
  now: number,
  content: ContentIndex,
  profile: SetupProfile,
  settings: GameSettings,
): void {
  const pool = content.pack.mainObjectives;
  const chosen =
    (settings.mainObjectiveId ? content.mainObjectives.get(settings.mainObjectiveId) : undefined) ??
    withRng(state, (rng) => rng.pick(pool));

  const side = profile.useHardcoreSide ? chosen.hardcore : chosen.standard;
  state.mainObjective.cardId = chosen.id;
  state.mainObjective.side = profile.useHardcoreSide ? 'hardcore' : 'standard';
  state.mainObjective.counters = Object.fromEntries(
    (side.counters ?? []).map((c) => [c.id, c.start]),
  );
  state.colony.morale = side.startingMorale;
  state.colony.rounds = side.startingRounds;

  pushLog(state, now, {
    category: 'objective',
    message: `Main objective: ${chosen.name} (${state.mainObjective.side}).`,
    data: {
      event: 'mainObjective',
      cardId: chosen.id,
      side: state.mainObjective.side,
      morale: side.startingMorale,
      rounds: side.startingRounds,
    },
  });
}

/* ------------------------------------------------------------------ *
 * §4.4 — secret objectives
 * ------------------------------------------------------------------ */

function prepareSecretObjectives(
  state: GameState,
  now: number,
  content: ContentIndex,
  profile: SetupProfile,
  settings: GameSettings,
): void {
  const all = content.pack.secretObjectives;
  const nonBetrayal = all.filter((o) => o.kind === 'nonBetrayal').map((o) => o.id);
  const betrayal = all.filter((o) => o.kind === 'betrayal').map((o) => o.id);
  const exiledPool = all.filter((o) => o.kind === 'exiled').map((o) => o.id);

  // §4.6: the exiled-objective deck is shuffled independently and stays face
  // down until §14.1 draws from it.
  state.decks.exiledObjectives = withRng(state, (rng) => rng.shuffle(exiledPool));

  if (!profile.dealsSecretObjectives) {
    // §19.1: no secret objectives; everything goes back to the box unseen.
    state.decks.returnedToBox.objectives.push(...nonBetrayal, ...betrayal);
    return;
  }

  if (profile.dealsBetrayalToEveryone) {
    // §19.6: each player gets one regular and one betrayal objective.
    const regulars = withRng(state, (rng) => rng.shuffle(nonBetrayal));
    const betrayals = withRng(state, (rng) => rng.shuffle(betrayal));
    state.seating.forEach((id, i) => {
      const player = getPlayer(state, id);
      const regular = regulars[i];
      const traitor = betrayals[i];
      if (regular) player.secretObjectiveIds.push(regular);
      if (traitor) player.secretObjectiveIds.push(traitor);
    });
    const dealt = new Set(state.seating.flatMap((id) => getPlayer(state, id).secretObjectiveIds));
    state.decks.returnedToBox.objectives.push(
      ...[...nonBetrayal, ...betrayal].filter((id) => !dealt.has(id)),
    );
    return;
  }

  /*
   * §4.4 in order: set aside N non-betrayal objectives per player (§19.3 makes
   * N one instead of two, raising the odds the betrayer card is dealt), add one
   * betrayal card unless the §18.1 errata option omits it, shuffle *those* and
   * deal one each. Everything else goes back to the box unseen.
   */
  const setAside = withRng(state, (rng) =>
    rng.shuffle(nonBetrayal).slice(0, profile.nonBetrayalPerPlayer * state.seating.length),
  );
  const candidates = [...setAside];
  if (settings.includeBetrayalObjective && betrayal.length > 0) {
    candidates.push(withRng(state, (rng) => rng.pick(betrayal)));
  }
  const dealPile = withRng(state, (rng) => rng.shuffle(candidates));

  state.seating.forEach((id, i) => {
    const card = dealPile[i];
    if (card) getPlayer(state, id).secretObjectiveIds.push(card);
  });

  const dealt = new Set(state.seating.flatMap((id) => getPlayer(state, id).secretObjectiveIds));
  state.decks.returnedToBox.objectives.push(
    ...[...nonBetrayal, ...betrayal].filter((id) => !dealt.has(id)),
  );

  pushLog(state, now, {
    category: 'setup',
    // §3: the *count* is public, the identities are not.
    message: 'Secret objectives are dealt face down.',
    data: {
      event: 'secretObjectivesDealt',
      perPlayer: 1,
      betrayalIncluded: settings.includeBetrayalObjective,
      candidatePool: dealPile.length,
    },
  });
}

/* ------------------------------------------------------------------ *
 * §4.5-§4.9 — decks
 * ------------------------------------------------------------------ */

function prepareDecks(
  state: GameState,
  now: number,
  content: ContentIndex,
  profile: SetupProfile,
  settings: GameSettings,
): void {
  /*
   * §4.7 and §19.1 both filter *before* shuffling, which matters for replay:
   * filtering afterwards would consume different random values for the same
   * seed depending on the filter, and §22 requires the seed alone to reproduce
   * the deck order.
   */
  const keepCard = (card: { nonCooperative: boolean; matureContent: boolean }): boolean => {
    if (settings.matureContentFilter && card.matureContent) return false;
    if (profile.removeNonCooperative && card.nonCooperative) return false;
    return true;
  };

  state.decks.crisis = withRng(state, (rng) =>
    rng.shuffle(content.pack.crises.filter(keepCard).map((c) => c.id)),
  );

  state.decks.crossroads = withRng(state, (rng) =>
    rng.shuffle(
      content.pack.crossroads
        .filter(keepCard)
        // §19.6: optionally drop content that depends on exiled survivors.
        .filter((c) => !(profile.removeExileDependent && c.dependsOnExile))
        .map((c) => c.id),
    ),
  );

  state.decks.survivors = withRng(state, (rng) =>
    rng.shuffle(content.pack.survivors.filter(keepCard).map((s) => s.id)),
  );

  // One instance per printed card. Two copies of the same card would be two
  // definitions in the pack, because §18.5 pins usage state to the instance.
  const mint = (cardId: CardId): string => {
    const iid = nextId(state, 'it');
    state.items[iid] = { iid, cardId, usedThisTurn: [], usedThisRound: [], usedThisGame: [] };
    return iid;
  };

  const usableItems = content.pack.items.filter(keepCard);
  state.decks.starterItems = withRng(state, (rng) =>
    rng.shuffle(usableItems.filter((i) => i.deck === 'starter').map((i) => i.id)),
  ).map(mint);

  // §4.9: each location's deck is shuffled and placed at that location.
  for (const loc of NON_COLONY_LOCATIONS) {
    const ids = usableItems.filter((i) => i.deck === (loc as NonColonyLocationId)).map((i) => i.id);
    state.locations[loc]!.deck = withRng(state, (rng) => rng.shuffle(ids)).map(mint);
  }

  pushLog(state, now, {
    category: 'setup',
    message: 'Decks are shuffled.',
    data: {
      event: 'decksReady',
      crisis: state.decks.crisis.length,
      crossroads: state.decks.crossroads.length,
      survivors: state.decks.survivors.length,
      starter: state.decks.starterItems.length,
    },
  });
}

/** §4.8: deal the starting hand; unused starter cards go back to the box. */
function dealStarterHands(state: GameState, now: number, profile: SetupProfile): void {
  for (const id of state.seating) {
    const player = getPlayer(state, id);
    for (let i = 0; i < profile.starterHandSize; i++) {
      const iid = state.decks.starterItems.shift();
      /*
       * §22: "a rules error must fail closed … it must not discard hidden
       * choices or silently skip effects". A short starter deck is a content
       * defect — §2.0 fixes the deck at 25 and §4.8 deals a fixed hand — and
       * dealing the last player a smaller hand hides it behind a playable-
       * looking game. Refusing to build the table surfaces it at setup instead.
       */
      if (!iid) {
        throw new Error(
          `Content error: the starter deck ran out while dealing §4.8's ` +
            `${profile.starterHandSize}-card hand to ${state.seating.length} players. ` +
            `The pack must hold at least ${profile.starterHandSize * state.seating.length} ` +
            `starter items that survive this mode's card filters.`,
        );
      }
      player.hand.push(iid);
    }
  }
  // §2.4: the box is not the removed-from-game pile.
  state.decks.returnedToBox.items.push(...state.decks.starterItems);
  state.decks.starterItems = [];
  pushLog(state, now, {
    category: 'setup',
    message: `Each player takes ${profile.starterHandSize} starter cards.`,
    data: { event: 'startingHands', size: profile.starterHandSize },
  });
}

/* ------------------------------------------------------------------ *
 * §4.10-§4.13 — survivors, leaders and the first player
 * ------------------------------------------------------------------ */

/**
 * §4.10: four survivors each, privately keep two (three under §19.2/§19.6) and
 * return the rest.
 *
 * All players choose at once — the platform allows it because `allowsOutOfTurn`
 * says setup choices bypass the turn clock — so this pushes one choice per
 * player rather than serialising the table through five prompts.
 */
export function dealSurvivorChoices(state: GameState, now: number): void {
  const profile = setupProfile(state.settings);
  const content = contentOf(state);
  for (const id of state.seating) {
    const dealt: CardId[] = [];
    for (let i = 0; i < 4; i++) {
      const card = state.decks.survivors.shift();
      if (card) dealt.push(card);
    }
    pushChoice(state, {
      kind: 'setupKeepSurvivors',
      playerId: id,
      prompt: `Keep ${profile.survivorsKept} of these ${dealt.length} survivors.`,
      options: dealt.map((cardId) => ({
        id: cardId,
        label: content.survivors.get(cardId)?.name ?? cardId,
        legal: true,
      })),
      minPicks: profile.survivorsKept,
      maxPicks: profile.survivorsKept,
      // §3: the four cards dealt to this player are private to them.
      private: true,
      data: { dealt },
    });
  }
  pushLog(state, now, {
    category: 'setup',
    message: 'Survivors are dealt.',
    data: { event: 'survivorsDealt', perPlayer: 4, kept: profile.survivorsKept },
  });
}

/**
 * Applies one player's keep decision: §4.10 returns the rejects to the deck and
 * §4.12 puts the keepers in empty colony survivor spaces.
 */
export function applySurvivorKeep(
  state: GameState,
  now: number,
  playerId: string,
  dealt: CardId[],
  kept: CardId[],
): void {
  for (const cardId of kept) placeSurvivor(state, now, playerId, cardId, COLONY, false);
  const returned = dealt.filter((c) => !kept.includes(c));
  // §4.10: "reshuffle the returned survivors into the survivor deck".
  state.decks.survivors.push(...returned);
  state.decks.survivors = withRng(state, (rng) => rng.shuffle(state.decks.survivors));
}

/** §4.11: one keeper becomes the group leader, the rest are followers. */
export function pushLeaderChoices(state: GameState, now: number): void {
  const content = contentOf(state);
  for (const id of state.seating) {
    const mine = survivorsOf(state, id);
    if (mine.length === 0) continue;
    if (mine.length === 1) {
      mine[0]!.isLeader = true;
      getPlayer(state, id).leaderSurvivorId = mine[0]!.id;
      continue;
    }
    pushChoice(state, {
      kind: 'setupChooseLeader',
      playerId: id,
      prompt: 'Choose your group leader.',
      options: mine.map((s) => ({
        id: s.id,
        label: content.survivors.get(s.cardId)?.name ?? s.cardId,
        legal: true,
      })),
    });
  }
  pushLog(state, now, {
    category: 'setup',
    message: 'Players choose their group leaders.',
    data: { event: 'leaderChoice' },
  });
}

/**
 * §4.13: the first-player token goes to the highest-influence group leader.
 *
 * §4 admits it "does not state how to break an initial tie"; the decision lives
 * in `policy.breakInitialFirstPlayerTie` and is logged so the table can see a
 * tie happened rather than wondering why the token landed where it did.
 */
export function assignFirstPlayer(state: GameState, now: number): void {
  const content = contentOf(state);
  const influence = (playerId: string): number => {
    const leaderId = getPlayer(state, playerId).leaderSurvivorId;
    const leader: SurvivorInstance | undefined = leaderId ? state.survivors[leaderId] : undefined;
    return leader ? (content.survivors.get(leader.cardId)?.influence ?? 0) : -1;
  };

  let best = -Infinity;
  for (const id of state.seating) best = Math.max(best, influence(id));
  const tied = state.seating.filter((id) => influence(id) === best);
  const chosen = withRng(state, (rng) => breakInitialFirstPlayerTie(tied, rng));
  state.firstPlayerId = chosen;

  pushLog(state, now, {
    category: 'setup',
    playerId: chosen,
    message:
      tied.length > 1
        ? `${getPlayer(state, chosen).name} wins the first-player token on a tie at influence ${best}.`
        : `${getPlayer(state, chosen).name} has the most influential leader and goes first.`,
    data: { event: 'firstPlayer', playerId: chosen, influence: best, tied },
  });
}
