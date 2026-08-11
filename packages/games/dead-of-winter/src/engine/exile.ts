/**
 * Exile and voting — §14 and §15.
 *
 * The awkward part of §14 is the relocation: every colony survivor of the newly
 * exiled player has to leave, each choice is that player's, and if the board
 * runs out of non-colony space the rules invent a swap that moves a *different*
 * player's survivor back into the colony. All of it is expressed as a
 * self-requeuing `i.resolveExile` effect so the game can stop between survivors
 * and wait for an answer (§20).
 */

import { COLONY, type LocationId, type NonColonyLocationId } from '../content/primitives.js';
import type { EngineEffect, GameState, PlayerId } from '../types.js';
import {
  activeSeating,
  contentOf,
  freeSurvivorSpaces,
  getPlayer,
  getSurvivor,
  nonExiledPlayers,
  pushChoice,
  pushLog,
  survivorsAt,
  survivorsOf,
  unshiftIntoCurrentFrame,
} from './state.js';
import { locationOrder } from './policy.js';
import { moveSurvivor, survivorName } from './survivors.js';
import { checkTwoExileLoss } from './endgame.js';

/* ------------------------------------------------------------------ *
 * Votes (§8.8, §15)
 * ------------------------------------------------------------------ */

/**
 * Who may vote right now.
 *
 * §8.8: everyone currently allowed to vote answers simultaneously and "the
 * nominated player may vote"; §14.2: "Exiled players cannot cast votes even
 * though they may initiate the vote".
 */
export function exileElectorate(state: GameState): PlayerId[] {
  return nonExiledPlayers(state).map((p) => p.id);
}

/** §15: `Outbreak`'s narrower electorate — only players with a colony survivor. */
export function colonyElectorate(state: GameState): PlayerId[] {
  const present = new Set(survivorsAt(state, COLONY).map((s) => s.controllerId));
  return activeSeating(state).filter((id) => present.has(id) && !getPlayer(state, id).exiled);
}

export function beginExileVote(
  state: GameState,
  now: number,
  nominatorId: PlayerId,
  nomineeId: PlayerId,
): void {
  const electorate = exileElectorate(state);
  state.vote = {
    prompt: `Exile ${getPlayer(state, nomineeId).name}?`,
    electorate,
    votes: {},
    committed: [],
    nomineeId,
  };
  pushChoice(state, {
    kind: 'vote',
    // §15: simultaneous, so nobody owns the clock.
    playerId: null,
    prompt: state.vote.prompt,
    options: [
      { id: 'yes', label: 'Exile them', legal: true },
      { id: 'no', label: 'Let them stay', legal: true },
    ],
    data: { nomineeId, nominatorId, electorate },
  });
  pushLog(state, now, {
    category: 'vote',
    playerId: nominatorId,
    message: `${getPlayer(state, nominatorId).name} calls for ${getPlayer(state, nomineeId).name} to be exiled.`,
    data: { event: 'exileVoteStarted', nominatorId, nomineeId, electorate },
  });
}

/** True once every eligible voter has committed (§15: no changes after reveal). */
export function voteComplete(state: GameState): boolean {
  const vote = state.vote;
  if (!vote) return false;
  return vote.electorate.every((id) => vote.votes[id] !== undefined);
}

/**
 * Tallies a completed vote.
 *
 * §8.8/§15: "The first player breaks a tie" — and §15 extends that to a first
 * player who "did not otherwise participate in that decision", which is why a
 * tie with no first-player vote raises a further choice instead of defaulting.
 */
export function tallyVote(state: GameState, now: number): 'yes' | 'no' | 'tie' {
  const vote = state.vote!;
  let yes = 0;
  let no = 0;
  for (const id of vote.electorate) (vote.votes[id] ? yes++ : no++);

  pushLog(state, now, {
    category: 'vote',
    message: `Votes revealed: ${yes} for, ${no} against.`,
    data: { event: 'voteRevealed', yes, no, votes: { ...vote.votes } },
  });

  if (yes > no) return 'yes';
  if (no > yes) return 'no';

  const firstVote = vote.votes[state.firstPlayerId];
  if (firstVote !== undefined) return firstVote ? 'yes' : 'no';
  return 'tie';
}

/* ------------------------------------------------------------------ *
 * Becoming exiled (§14.1)
 * ------------------------------------------------------------------ */

/**
 * Marks a player exiled and queues the relocation of their colony survivors.
 *
 * The steps are §14.1's, in its order: mark, draw the exiled objective, reveal
 * the original only if that card says to, then relocate.
 */
export function exilePlayer(state: GameState, now: number, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  if (player.exiled) return;
  player.exiled = true;

  const content = contentOf(state);
  const cardId = state.decks.exiledObjectives.shift() ?? null;
  player.exiledObjectiveId = cardId;
  const card = cardId ? content.secretObjectives.get(cardId) : undefined;

  pushLog(state, now, {
    category: 'exile',
    playerId,
    message: `${player.name} is exiled from the colony.`,
    data: { event: 'exiled', playerId, exiledObjectiveId: cardId },
  });

  /*
   * §14.1/§3: "the applicable exiled-objective card requires the original
   * secret objective to be revealed. A betrayer does not reveal the betrayal
   * objective merely because of exile." The reveal is therefore driven by the
   * drawn card *and* by the kind of objective actually held.
   */
  if (card?.revealsOriginalObjective) {
    for (const objectiveId of player.secretObjectiveIds) {
      const objective = content.secretObjectives.get(objectiveId);
      if (objective?.kind === 'betrayal') continue;
      player.revealedObjectiveIds.push(objectiveId);
      pushLog(state, now, {
        category: 'exile',
        playerId,
        message: `${player.name}'s objective is laid bare: ${objective?.name ?? objectiveId}.`,
        data: { event: 'objectiveRevealed', playerId, objectiveId },
      });
    }
  }

  unshiftIntoCurrentFrame(state, [{ kind: 'i.resolveExile', playerId }]);
  checkTwoExileLoss(state, now);
}

/* ------------------------------------------------------------------ *
 * Relocation (§14.1)
 * ------------------------------------------------------------------ */

/**
 * One step of the forced relocation.
 *
 * Returns having either finished (no colony survivors left for that player) or
 * installed exactly one choice. §14.1 is explicit that these relocations "do
 * not consume the survivors' once-per-turn move allowance" and that a normal
 * one "follows movement rules and rolls exposure" — but that the swap exception
 * rolls nothing for either survivor.
 */
export function stepExileRelocation(state: GameState, now: number, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const stranded = survivorsOf(state, playerId).filter((s) => s.location === COLONY);
  if (stranded.length === 0) {
    pushLog(state, now, {
      category: 'exile',
      playerId,
      message: `${player.name}'s survivors are all outside the walls.`,
      data: { event: 'exileRelocationComplete', playerId },
    });
    return;
  }

  const survivor = stranded[0]!;
  const open = (locationOrder(contentOf(state)) as NonColonyLocationId[]).filter(
    (loc) => freeSurvivorSpaces(state, loc) > 0,
  );

  if (open.length > 0) {
    pushChoice(state, {
      kind: 'exileRelocate',
      playerId,
      prompt: `Where does ${survivorName(state, survivor)} go?`,
      options: open.map((loc) => ({ id: loc, label: loc, legal: true })),
      data: { survivorId: survivor.id },
    });
    return;
  }

  /*
   * §14.1's exception. With no empty non-colony space, a *non-exiled* survivor
   * outside the walls is recalled to the colony and the exiled survivor takes
   * the space it vacated. Neither move counts as a move and neither rolls
   * exposure.
   */
  const swappable = (locationOrder(contentOf(state)) as LocationId[])
    .flatMap((loc) => survivorsAt(state, loc))
    .filter((s) => s.location !== COLONY && !getPlayer(state, s.controllerId).exiled);

  if (swappable.length === 0 || freeSurvivorSpaces(state, COLONY) <= 0) {
    // Nothing legal remains; the survivor stays put rather than vanishing.
    pushLog(state, now, {
      category: 'error',
      playerId,
      message: `${survivorName(state, survivor)} cannot be relocated; no space and no swap partner.`,
      data: { event: 'exileRelocationStuck', playerId, survivorId: survivor.id },
    });
    return;
  }

  pushChoice(state, {
    kind: 'exileSwap',
    playerId,
    prompt: `No space outside. Choose a survivor to recall so ${survivorName(state, survivor)} can take their place.`,
    options: swappable.map((s) => ({
      id: s.id,
      label: `${survivorName(state, s)} (${s.location})`,
      legal: true,
    })),
    data: { survivorId: survivor.id },
  });
}

/** Applies a chosen relocation and queues the next one. */
export function applyExileRelocation(
  state: GameState,
  now: number,
  playerId: PlayerId,
  survivorId: string,
  destination: NonColonyLocationId,
): void {
  // §14.1: a normal forced relocation follows the movement rules and rolls
  // exposure, but does not spend the move allowance.
  moveSurvivor(state, now, survivorId, destination, {
    rollExposure: true,
    consumesAllowance: false,
  });
  unshiftIntoCurrentFrame(state, [{ kind: 'i.resolveExile', playerId }]);
}

/** Applies the §14.1 no-space swap and queues the next relocation. */
export function applyExileSwap(
  state: GameState,
  now: number,
  playerId: PlayerId,
  exiledSurvivorId: string,
  recalledSurvivorId: string,
): void {
  const recalled = getSurvivor(state, recalledSurvivorId);
  const vacated = recalled.location;

  // Neither relocation counts as a move and neither rolls exposure (§14.1).
  moveSurvivor(state, now, recalledSurvivorId, COLONY, {
    rollExposure: false,
    consumesAllowance: false,
  });
  moveSurvivor(state, now, exiledSurvivorId, vacated, {
    rollExposure: false,
    consumesAllowance: false,
  });

  pushLog(state, now, {
    category: 'exile',
    playerId,
    message: `${survivorName(state, recalled)} is recalled to the colony to make room outside.`,
    data: { event: 'exileSwap', exiledSurvivorId, recalledSurvivorId, location: vacated },
  });
  unshiftIntoCurrentFrame(state, [{ kind: 'i.resolveExile', playerId }]);
}

/* ------------------------------------------------------------------ *
 * Exiled-player restrictions (§14.2)
 * ------------------------------------------------------------------ */

/**
 * The single place §14.2's prohibitions are written down.
 *
 * Returning a reason string rather than a boolean means `validateAction` can
 * quote it verbatim, which §21 asks for ("show why a die/action is illegal").
 */
export function exileRestriction(
  state: GameState,
  playerId: PlayerId,
  what: 'contributeCrisis' | 'spendFood' | 'castVote' | 'moveToColony' | 'addHelpless',
): string | null {
  if (!getPlayer(state, playerId).exiled) return null;
  switch (what) {
    case 'contributeCrisis':
      return 'Exiled players cannot add cards to a crisis. §14.2';
    case 'spendFood':
      return 'Exiled players cannot spend colony food tokens. §14.2';
    case 'castVote':
      return 'Exiled players cannot cast votes. §14.2';
    case 'moveToColony':
      return 'Exiled survivors cannot move into the colony. §14.2';
    case 'addHelpless':
      return 'Exiled players do not add helpless survivors. §14.2';
    default:
      return null;
  }
}

export function exileEffects(playerId: PlayerId): EngineEffect[] {
  return [{ kind: 'i.resolveExile', playerId }];
}
