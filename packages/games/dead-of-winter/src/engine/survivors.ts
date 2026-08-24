/**
 * Exposure, wounds, frostbite, death, the bite chain and last-survivor
 * replacement — §9 end to end, plus §13's rules for adding a survivor.
 *
 * The whole section is one long chain of mandatory consequences, and §20
 * insists none of it may be interrupted. Every function here therefore either
 * completes its own step or *queues* the next one as an effect; nothing loops
 * over deaths internally, because a bite chain has to be able to stop and wait
 * for a controller's answer in the middle.
 */

import { COLONY, type LocationId, type SurvivorInstanceId } from '../content/primitives.js';
import type {
  AbilityId,
  DeathCause,
  ExposureFace,
  GameState,
  PlayerId,
  SurvivorInstance,
} from '../types.js';
import {
  adjustMorale,
  allSurvivors,
  contentOf,
  detachItem,
  freeSurvivorSpaces,
  getPlayer,
  getSurvivor,
  influenceOf,
  locationState,
  nextId,
  pushChoice,
  pushLog,
  survivorsAt,
  survivorsOf,
  trySurvivor,
  unshiftIntoCurrentFrame,
  withRng,
} from './state.js';
import { lowestInfluence } from './effects/conditions.js';
import { eligibleExiledEntryLocations, fullColonyReplacementPolicy, locationOrder } from './policy.js';

/** §9.1: three wound tokens of any mix kill a survivor immediately. */
export const LETHAL_WOUNDS = 3;

export const totalWounds = (s: SurvivorInstance): number => s.wounds + s.frostbite;

const nameOf = (state: GameState, s: SurvivorInstance): string =>
  contentOf(state).survivors.get(s.cardId)?.name ?? s.cardId;

function johnPriceAbilities(state: GameState, john: SurvivorInstance): AbilityId[] {
  if (john.cardId !== 'sv-john-price' || john.location === COLONY) return [];
  const ids = new Set<AbilityId>();
  for (const other of survivorsAt(state, john.location)) {
    if (other.id === john.id) continue;
    const ability = contentOf(state).survivors.get(other.cardId)?.ability;
    if (ability) ids.add(ability.id);
  }
  return [...ids];
}

/**
 * Reconciles the two survivor-specific dynamic rules after automatic effects
 * have settled.  Keeping this at the reducer boundary means a persisted game
 * and a newly created game apply the same copy/death rule, while direct card
 * effects still remain atomic.
 */
export function reconcileSpecialSurvivors(state: GameState, now: number): boolean {
  let queuedDeath = false;
  for (const survivor of Object.values(state.survivors)) {
    if (contentOf(state).survivors.has(survivor.cardId)) continue;
    const owner = getPlayer(state, survivor.controllerId);
    if (owner.leaderSurvivorId === survivor.id) owner.leaderSurvivorId = null;
    delete state.survivors[survivor.id];
    pushLog(state, now, {
      category: 'error',
      playerId: survivor.controllerId,
      message: `Removed orphan survivor standee ${survivor.id}; its card is not in the content pack.`,
      data: { event: 'contentError', survivorId: survivor.id, cardId: survivor.cardId },
    });
  }
  for (const survivor of Object.values(state.survivors)) {
    if (survivor.cardId !== 'sv-john-price') continue;
    survivor.copiedAbilityIds = johnPriceAbilities(state, survivor);
    const moved = state.turn?.events.some((event) => {
      const row = event as { event?: string; survivorId?: string };
      return row.event === 'moveCompleted' && row.survivorId === survivor.id;
    });
    if (moved && totalWounds(survivor) >= LETHAL_WOUNDS) {
      unshiftIntoCurrentFrame(state, [{ kind: 'i.kill', survivorId: survivor.id, cause: 'wounds' }]);
      queuedDeath = true;
    }
  }
  return queuedDeath;
}

/* ------------------------------------------------------------------ *
 * Exposure (§9.1)
 * ------------------------------------------------------------------ */

/**
 * Rolls the exposure die for one survivor and applies the face.
 *
 * The face distribution is content (§2.5), so the roll is a single d6 into the
 * pack's six-entry face table — one value off the random stream, replayable.
 */
export function rollExposure(state: GameState, now: number, survivorId: SurvivorInstanceId): void {
  const survivor = trySurvivor(state, survivorId);
  if (!survivor) return; // already dead; a cancelled roll is not an error

  const faces = contentOf(state).pack.exposureDie;
  const roll = withRng(state, (rng) => rng.die(6));
  const face = faces[roll - 1] as ExposureFace;

  pushLog(state, now, {
    category: 'exposure',
    playerId: survivor.controllerId,
    message: `${nameOf(state, survivor)} is exposed: ${face}.`,
    data: { event: 'exposure', survivorId, face, roll },
  });

  switch (face) {
    case 'blank':
      return;
    case 'wound':
      addWounds(state, now, survivorId, 1, false);
      return;
    case 'frostbite':
      addWounds(state, now, survivorId, 1, true);
      return;
    case 'bitten':
      // §9.1: a bite kills outright, whatever the wound count, and starts the
      // spread chain — it is not "three wounds' worth of damage".
      queueKill(state, survivorId, 'bite');
      return;
    default:
      throw new Error(`Content pack declares unknown exposure face '${String(face)}'`);
  }
}

/* ------------------------------------------------------------------ *
 * Wounds (§9.1)
 * ------------------------------------------------------------------ */

/**
 * Adds wounds and kills the survivor the instant the third lands.
 *
 * §8.1 is explicit that "a medicine card cannot interrupt a third wound to save
 * a survivor; the survivor dies before another card can be played", which is
 * why the kill is queued at the *front* of the current frame rather than
 * appended after whatever else is pending.
 */
export function addWounds(
  state: GameState,
  now: number,
  survivorId: SurvivorInstanceId,
  amount: number,
  frostbite: boolean,
): void {
  const survivor = trySurvivor(state, survivorId);
  if (!survivor || amount <= 0) return;
  if (frostbite) survivor.frostbite += amount;
  else survivor.wounds += amount;

  pushLog(state, now, {
    category: 'death',
    playerId: survivor.controllerId,
    message: `${nameOf(state, survivor)} takes ${amount} ${frostbite ? 'frostbite' : 'wound'}${
      amount === 1 ? '' : 's'
    } (${totalWounds(survivor)}/${LETHAL_WOUNDS}).`,
    data: { event: 'wound', survivorId, amount, frostbite, total: totalWounds(survivor) },
  });

  if (totalWounds(survivor) >= LETHAL_WOUNDS) queueKill(state, survivorId, 'wounds');
}

export function healWounds(
  state: GameState,
  now: number,
  survivorId: SurvivorInstanceId,
  amount: number,
  frostbiteFirst: boolean,
): void {
  const survivor = trySurvivor(state, survivorId);
  if (!survivor || amount <= 0) return;
  let left = amount;
  const order: ('frostbite' | 'wounds')[] = frostbiteFirst
    ? ['frostbite', 'wounds']
    : ['wounds', 'frostbite'];
  for (const bucket of order) {
    const take = Math.min(left, survivor[bucket]);
    survivor[bucket] -= take;
    left -= take;
  }
  pushLog(state, now, {
    category: 'card',
    playerId: survivor.controllerId,
    message: `${nameOf(state, survivor)} is healed (${totalWounds(survivor)}/${LETHAL_WOUNDS}).`,
    data: { event: 'heal', survivorId, amount: amount - left },
  });
}

/**
 * §6/§9.1: at the start of its controller's turn, a survivor with any frostbite
 * takes one further regular wound, and any survivor at three wounds dies before
 * the controller may act.
 */
export function applyFrostbiteAtTurnStart(state: GameState, now: number, playerId: PlayerId): void {
  for (const survivor of survivorsOf(state, playerId)) {
    if (survivor.frostbite > 0) addWounds(state, now, survivor.id, 1, false);
  }
}

const queueKill = (state: GameState, survivorId: SurvivorInstanceId, cause: DeathCause): void => {
  unshiftIntoCurrentFrame(state, [{ kind: 'i.kill', survivorId, cause }]);
};

/* ------------------------------------------------------------------ *
 * Death (§9.3)
 * ------------------------------------------------------------------ */

/**
 * Runs the full death cleanup for one survivor and queues everything §9 makes
 * follow from it: a new group leader, a bite chain, a last-survivor
 * replacement.
 *
 * Returns the effects that must run next, which the caller queues — the caller
 * decides *where*, because §9.2 defers replacement to the end of a bite chain.
 */
export function killSurvivor(
  state: GameState,
  now: number,
  survivorId: SurvivorInstanceId,
  cause: DeathCause,
): { controllerId: PlayerId; lostLastSurvivor: boolean } | null {
  const survivor = trySurvivor(state, survivorId);
  if (!survivor) return null;
  const controllerId = survivor.controllerId;
  const controller = getPlayer(state, controllerId);
  const location = survivor.location;
  const name = nameOf(state, survivor);

  /*
   * §9.3, in the printed order. Equipment disposal depends on where the
   * survivor stood, so it has to happen before the standee leaves the board.
   */
  for (const iid of [...survivor.equipped]) {
    detachItem(state, iid);
    if (location === COLONY) controller.hand.push(iid);
    else {
      // §9.3: shuffled into that location's deck, not placed on top — the
      // searcher must not learn the deck's next card from a death.
      const loc = locationState(state, location);
      loc.deck.push(iid);
      loc.deck = withRng(state, (rng) => rng.shuffle(loc.deck));
    }
  }

  delete state.survivors[survivorId];
  state.decks.removedFromGame.survivors.push(survivor.cardId);

  pushLog(state, now, {
    category: 'death',
    playerId: controllerId,
    message: `${name} dies (${cause}).`,
    data: { event: 'survivorDied', survivorId, cardId: survivor.cardId, cause, location },
  });
  if (state.turn) state.turn.events.push({ event: 'survivorKilled', survivorId });

  // §9.3: an exiled player's death costs the colony nothing (§14.2 repeats it).
  if (!controller.exiled) adjustMorale(state, now, -1, `${name} died`, controllerId);

  const remaining = survivorsOf(state, controllerId);
  if (survivor.isLeader && remaining.length > 0) {
    // §9.3: the player immediately chooses a new group leader.
    controller.leaderSurvivorId = null;
    if (remaining.length === 1) {
      remaining[0]!.isLeader = true;
      controller.leaderSurvivorId = remaining[0]!.id;
    } else {
      pushChoice(state, {
        kind: 'chooseNewLeader',
        playerId: controllerId,
        prompt: 'Choose your new group leader.',
        options: remaining.map((s) => ({
          id: s.id,
          label: nameOf(state, s),
          legal: true,
        })),
      });
    }
  }

  return { controllerId, lostLastSurvivor: remaining.length === 0 };
}

/**
 * §9.3: a helpless survivor's death removes one token and costs one morale. It
 * is never a "survivor death" for anything else — no equipment, no leader, no
 * replacement, because §2.3 gives helpless survivors none of those things.
 */
export function killHelpless(state: GameState, now: number, reason: string): boolean {
  if (state.colony.helpless <= 0) return false;
  state.colony.helpless -= 1;
  pushLog(state, now, {
    category: 'death',
    message: `A helpless survivor dies (${reason}).`,
    data: { event: 'helplessDied', reason },
  });
  adjustMorale(state, now, -1, 'a helpless survivor died');
  return true;
}

/* ------------------------------------------------------------------ *
 * Bite spread (§9.2)
 * ------------------------------------------------------------------ */

/**
 * One link of a bite chain.
 *
 * The chain is expressed as a self-requeuing effect so it can pause between
 * links: §9.2 gives each candidate's *controller* a genuine choice, and §20
 * requires that pause to survive a reconnection.
 */
export function stepBiteChain(
  state: GameState,
  now: number,
  location: LocationId,
  excluded: SurvivorInstanceId[],
  deferred: PlayerId[],
): void {
  // §9.2: helpless survivors "do not receive spreading bites", and §2.3 says
  // they cannot be attacked at all, so they are never candidates.
  const pool = survivorsAt(state, location).filter((s) => !excluded.includes(s.id));
  const candidates = lowestInfluence(state, pool);
  const victim = candidates[0];

  if (!victim) {
    // §9.2 step 3: the chain stops, and only now may replacements arrive.
    if (deferred.length > 0) {
      unshiftIntoCurrentFrame(
        state,
        deferred.map((playerId) => ({ kind: 'i.checkLastSurvivor', playerId }) as const),
      );
    }
    pushLog(state, now, {
      category: 'death',
      message: 'The bite finds no one else.',
      data: { event: 'biteChainEnded', location },
    });
    return;
  }

  // §9.2 identifies the lowest-influence survivor, while §15 gives the first
  // player authority over a tied game decision. Preserve that decision as an
  // explicit pending choice so a disconnect can resume it exactly.
  if (candidates.length > 1) {
    pushChoice(state, {
      kind: 'biteTarget',
      playerId: state.firstPlayerId,
      prompt: `Several survivors tie for lowest influence at ${location}. Choose who faces the bite.`,
      options: candidates.map((candidate) => ({
        id: candidate.id,
        label: nameOf(state, candidate),
        legal: true,
      })),
      data: { location, excluded, deferred },
    });
    return;
  }

  pushBiteResponseChoice(state, victim, location, excluded, deferred);
}

function pushBiteResponseChoice(
  state: GameState,
  victim: SurvivorInstance,
  location: LocationId,
  excluded: SurvivorInstanceId[],
  deferred: PlayerId[],
): void {

  pushChoice(state, {
    kind: 'biteResponse',
    playerId: victim.controllerId,
    prompt: `${nameOf(state, victim)} is the lowest-influence survivor here. Kill outright, or risk exposure?`,
    options: [
      { id: 'kill', label: 'Kill immediately and stop the chain', legal: true },
      { id: 'roll', label: 'Roll exposure — a blank saves them', legal: true },
    ],
    data: { survivorId: victim.id, location, excluded, deferred },
  });
}

/** Resumes a bite chain after the first player resolves a lowest-influence tie. */
export function resolveBiteTarget(
  state: GameState,
  survivorId: SurvivorInstanceId,
  location: LocationId,
  excluded: SurvivorInstanceId[],
  deferred: PlayerId[],
): void {
  const victim = trySurvivor(state, survivorId);
  if (!victim) {
    unshiftIntoCurrentFrame(state, [
      { kind: 'i.biteChain', location, excluded: [...excluded, survivorId], deferred },
    ]);
    return;
  }
  pushBiteResponseChoice(state, victim, location, excluded, deferred);
}

/**
 * Resolves one bite response. Called by the choice resolver, which owns the
 * decision plumbing; the rules live here.
 */
export function resolveBiteResponse(
  state: GameState,
  now: number,
  survivorId: SurvivorInstanceId,
  location: LocationId,
  excluded: SurvivorInstanceId[],
  deferred: PlayerId[],
  decision: 'kill' | 'roll',
): void {
  const survivor = trySurvivor(state, survivorId);
  if (!survivor) {
    unshiftIntoCurrentFrame(state, [
      { kind: 'i.biteChain', location, excluded: [...excluded, survivorId], deferred },
    ]);
    return;
  }

  if (decision === 'kill') {
    // §9.2: the automatic kill stops the chain. Nobody else is tested.
    const outcome = killSurvivor(state, now, survivorId, 'bite');
    const nextDeferred =
      outcome?.lostLastSurvivor && !deferred.includes(outcome.controllerId)
        ? [...deferred, outcome.controllerId]
        : deferred;
    if (nextDeferred.length > 0) {
      unshiftIntoCurrentFrame(
        state,
        nextDeferred.map((playerId) => ({ kind: 'i.checkLastSurvivor', playerId }) as const),
      );
    }
    return;
  }

  const faces = contentOf(state).pack.exposureDie;
  const roll = withRng(state, (rng) => rng.die(6));
  const face = faces[roll - 1] as ExposureFace;
  pushLog(state, now, {
    category: 'exposure',
    playerId: survivor.controllerId,
    message: `${nameOf(state, survivor)} rolls against the bite: ${face}.`,
    data: { event: 'biteRoll', survivorId, face, roll },
  });

  if (face === 'blank') {
    // §9.2: a blank lets the survivor live *and* stops the chain — the survivor
    // takes no wound from this roll, whatever the face would normally mean.
    if (deferred.length > 0) {
      unshiftIntoCurrentFrame(
        state,
        deferred.map((playerId) => ({ kind: 'i.checkLastSurvivor', playerId }) as const),
      );
    }
    return;
  }

  const outcome = killSurvivor(state, now, survivorId, 'bite');
  const nextDeferred =
    outcome?.lostLastSurvivor && !deferred.includes(outcome.controllerId)
      ? [...deferred, outcome.controllerId]
      : deferred;
  unshiftIntoCurrentFrame(state, [
    {
      kind: 'i.biteChain',
      location,
      excluded: [...excluded, survivorId],
      deferred: nextDeferred,
    },
  ]);
}

/* ------------------------------------------------------------------ *
 * Adding survivors (§13) and last-survivor replacement (§9.4)
 * ------------------------------------------------------------------ */

/** Draws the top survivor card, or `null` when the deck is exhausted. */
function drawSurvivorCard(state: GameState): string | null {
  return state.decks.survivors.shift() ?? null;
}

export function placeSurvivor(
  state: GameState,
  now: number,
  playerId: PlayerId,
  cardId: string,
  location: LocationId,
  asLeader: boolean,
): SurvivorInstance {
  const survivor: SurvivorInstance = {
    id: nextId(state, 'sv'),
    cardId,
    controllerId: playerId,
    location,
    wounds: 0,
    frostbite: 0,
    equipped: [],
    // §13: "The new survivor may act later in the current controller's turn",
    // so it arrives with its move allowance intact.
    movedThisTurn: false,
    isLeader: asLeader,
    usedThisTurn: [],
    usedThisRound: [],
    usedThisGame: [],
    ...(cardId === 'sv-john-price' ? { copiedAbilityIds: [] } : {}),
  };
  state.survivors[survivor.id] = survivor;
  if (asLeader) getPlayer(state, playerId).leaderSurvivorId = survivor.id;
  pushLog(state, now, {
    category: 'setup',
    playerId,
    message: `${contentOf(state).survivors.get(cardId)?.name ?? cardId} joins at ${location}.`,
    data: { event: 'survivorAdded', survivorId: survivor.id, cardId, location, playerId },
  });
  return survivor;
}

/**
 * §13: adds a drawn survivor to a player, refusing when there is nowhere legal
 * to put it. Returns false when the addition could not happen, which §13 and
 * §10 both treat as "the effect cannot be used" rather than an error.
 */
export function addSurvivorToPlayer(
  state: GameState,
  now: number,
  playerId: PlayerId,
): boolean {
  const player = getPlayer(state, playerId);
  const cardId = drawSurvivorCard(state);
  if (!cardId) return false;

  if (!player.exiled) {
    if (freeSurvivorSpaces(state, COLONY) <= 0) {
      // §13: no colony space means the addition simply cannot happen. The card
      // goes back so the deck order stays truthful.
      state.decks.survivors.unshift(cardId);
      return false;
    }
    placeSurvivor(state, now, playerId, cardId, COLONY, player.leaderSurvivorId === null);
    return true;
  }

  // §13/§14.2: an exiled player's new survivor enters a non-colony location of
  // that player's choice.
  const eligible = eligibleExiledEntryLocations(contentOf(state), (loc) =>
    freeSurvivorSpaces(state, loc),
  );
  if (eligible.length === 0) {
    state.decks.survivors.unshift(cardId);
    return false;
  }
  if (eligible.length === 1) {
    placeSurvivor(state, now, playerId, cardId, eligible[0]!, player.leaderSurvivorId === null);
    return true;
  }
  pushChoice(state, {
    kind: 'lastSurvivorPlacement',
    playerId,
    prompt: 'Choose where your new survivor enters.',
    options: eligible.map((loc) => ({ id: loc, label: loc, legal: true })),
    data: { cardId, asLeader: player.leaderSurvivorId === null },
    private: true,
  });
  return true;
}

/**
 * §9.4: a player who has just lost their last survivor draws a replacement —
 * unless §19.5's elimination variant is on, in which case they leave the game.
 *
 * Both branches first remove the player's whole hand from the game, which is
 * the one thing §9.4 and §19.5 agree on.
 */
export function checkLastSurvivor(state: GameState, now: number, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  if (player.eliminated) return;
  if (survivorsOf(state, playerId).length > 0) return;

  for (const iid of [...player.hand]) {
    detachItem(state, iid);
    state.decks.removedFromGame.items.push(iid);
  }
  player.hand = [];

  if (state.settings.playerElimination) {
    player.eliminated = true;
    player.leaderSurvivorId = null;
    player.unusedDice = [];
    player.usedDice = [];
    pushLog(state, now, {
      category: 'death',
      playerId,
      message: `${player.name} is eliminated.`,
      data: { event: 'playerEliminated', playerId },
    });
    return;
  }

  player.leaderSurvivorId = null;
  const placed = addReplacementSurvivor(state, now, playerId);
  if (!placed) {
    pushLog(state, now, {
      category: 'error',
      playerId,
      message: `${player.name} has no survivor and none could be added.`,
      data: { event: 'replacementFailed', playerId },
    });
  }
}

/**
 * The mandatory replacement of §9.4, including §24's full-colony policy.
 *
 * §13 forbids adding a survivor with no colony space free, while §9.4 makes
 * this particular addition mandatory. `policy.fullColonyReplacementPolicy`
 * owns the resolution; this function only carries it out.
 */
function addReplacementSurvivor(state: GameState, now: number, playerId: PlayerId): boolean {
  const player = getPlayer(state, playerId);

  if (!player.exiled && freeSurvivorSpaces(state, COLONY) <= 0) {
    const policy = fullColonyReplacementPolicy(state);
    if (policy === 'displaceHelpless') {
      killHelpless(state, now, 'making room for a replacement survivor (§24 policy)');
    } else if (policy === 'skip') {
      return false;
    } else {
      const cardId = drawSurvivorCard(state);
      if (!cardId) return false;
      const eligible = eligibleExiledEntryLocations(contentOf(state), (loc) =>
        freeSurvivorSpaces(state, loc),
      );
      if (eligible.length === 0) {
        state.decks.survivors.unshift(cardId);
        return false;
      }
      placeSurvivor(state, now, playerId, cardId, eligible[0]!, true);
      return true;
    }
  }

  const cardId = drawSurvivorCard(state);
  if (!cardId) return false;

  if (!player.exiled) {
    placeSurvivor(state, now, playerId, cardId, COLONY, true);
    return true;
  }

  const eligible = eligibleExiledEntryLocations(contentOf(state), (loc) =>
    freeSurvivorSpaces(state, loc),
  );
  if (eligible.length === 0) {
    state.decks.survivors.unshift(cardId);
    return false;
  }
  if (eligible.length === 1) {
    placeSurvivor(state, now, playerId, cardId, eligible[0]!, true);
    return true;
  }
  pushChoice(state, {
    kind: 'lastSurvivorPlacement',
    playerId,
    prompt: 'Choose where your replacement survivor enters.',
    options: eligible.map((loc) => ({ id: loc, label: loc, legal: true })),
    data: { cardId, asLeader: true },
    private: true,
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * Movement (§8.4)
 * ------------------------------------------------------------------ */

/**
 * Commits a move and queues the arrival exposure roll.
 *
 * §8.4 is precise about the ordering — the allowance is marked "only after the
 * move is committed", the roll happens on arrival, and a bite spreads "among
 * eligible survivors at the destination, not the origin" — so the roll is
 * queued after the location has already changed.
 */
export function moveSurvivor(
  state: GameState,
  now: number,
  survivorId: SurvivorInstanceId,
  to: LocationId,
  opts: { rollExposure?: boolean; consumesAllowance?: boolean } = {},
): void {
  const survivor = trySurvivor(state, survivorId);
  if (!survivor) return;
  const from = survivor.location;
  survivor.location = to;
  if (opts.consumesAllowance !== false) survivor.movedThisTurn = true;

  pushLog(state, now, {
    category: 'action',
    playerId: survivor.controllerId,
    message: `${nameOf(state, survivor)} moves from ${from} to ${to}.`,
    data: { event: 'move', survivorId, from, to },
  });
  if (state.turn) {
    state.turn.events.push({
      event: 'moveCompleted',
      survivorId,
      destination: to === COLONY ? 'colony' : 'nonColony',
    });
    state.turn.events.push({ event: 'actionPerformed', action: 'move', survivorId });
  }

  if (opts.rollExposure !== false) {
    unshiftIntoCurrentFrame(state, [{ kind: 'i.exposure', survivorId }]);
  }
}

/** Locations a survivor may legally move to right now (§8.4, §14.2). */
export function legalMoveDestinations(state: GameState, survivorId: SurvivorInstanceId): LocationId[] {
  const survivor = getSurvivor(state, survivorId);
  const exiled = getPlayer(state, survivor.controllerId).exiled;
  const all: LocationId[] = [COLONY, ...locationOrder(contentOf(state))];
  return all.filter((loc) => {
    if (loc === survivor.location) return false;
    // §14.2: an exiled player "cannot move survivors into the colony".
    if (exiled && loc === COLONY) return false;
    return freeSurvivorSpaces(state, loc) > 0;
  });
}

export { nameOf as survivorName, influenceOf, allSurvivors };
