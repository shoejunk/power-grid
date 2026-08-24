/**
 * Player actions — §7 (needs a die), §8 (does not) and the universal decision
 * channel that answers a `PendingChoice`.
 *
 * Every action appears twice: once in `validateAction`, which is pure and
 * returns a reason a player can read (§21 wants the UI to show *why* something
 * is illegal), and once in `applyAction`, which assumes validation already
 * passed. The engine never throws on ordinary illegal input — a throw here is
 * reserved for malformed content and broken invariants (§22).
 */

import {
  COLONY,
  NON_COLONY_LOCATIONS,
  type LocationId,
  type NonColonyLocationId,
} from '../content/primitives.js';
import type { AbilityDefinition } from '../content/effects.js';
import type { GameAction, GameState, PendingChoice, PlayerId } from '../types.js';
import {
  activeSeating,
  contentOf,
  detachItem,
  discardPlayedCard,
  entranceFree,
  entrancesOf,
  fail,
  getItem,
  getPlayer,
  getSurvivor,
  hasDie,
  locationState,
  nonExiledPlayers,
  ok,
  pushChoice,
  pushFrame,
  pushLog,
  removeFromGame,
  spendDie,
  survivorsAt,
  survivorsOf,
  trySurvivor,
  unshiftIntoCurrentFrame,
  withRng,
  zoneOf,
} from './state.js';
import { orderUnkeptSearchCards } from './policy.js';
import { itemMatches } from './effects/conditions.js';
import { beginRequest, cardName, killZombieBookkeeping, zombieKillHook } from './effects/runner.js';
import {
  addWounds,
  legalMoveDestinations,
  moveSurvivor,
  placeSurvivor,
  resolveBiteTarget,
  survivorName,
} from './survivors.js';
import { addBarricade, attractZombies, removeZombies } from './zombies.js';
import {
  applyExileRelocation,
  applyExileSwap,
  beginExileVote,
  exilePlayer,
  exileRestriction,
  tallyVote,
  voteComplete,
} from './exile.js';
import { resolveBiteResponse } from './survivors.js';
import { applySurvivorKeep, setupProfile } from './setup.js';

/* ------------------------------------------------------------------ *
 * Shared gates
 * ------------------------------------------------------------------ */

type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * The gate every ordinary action passes.
 *
 * §5's "no phase or step may advance while it has an unresolved choice" and
 * §8.1's "item cards cannot interrupt an effect already in progress" are the
 * same check from two directions, so they live in one place.
 */
function turnGate(state: GameState, playerId: PlayerId): Verdict {
  if (state.pendingChoices.length > 0) {
    return fail('A decision is still outstanding. §5');
  }
  if (state.effectStack.some((f) => f.queue.length > 0)) {
    return fail('An effect is still resolving; nothing may interrupt it. §8.1');
  }
  if (state.phase !== 'playerTurns' || !state.turn) {
    return fail('That can only be done during a player turn.');
  }
  if (state.turn.playerId !== playerId) return fail('It is not your turn.');
  return ok;
}

function ownSurvivor(state: GameState, playerId: PlayerId, survivorId: string): Verdict {
  const survivor = trySurvivor(state, survivorId);
  if (!survivor) return fail('That survivor is not on the board.');
  if (survivor.controllerId !== playerId) return fail('You do not control that survivor.');
  return ok;
}

/**
 * §7.1 with §18.5's Switchblade ruling: a modifier lowers the *required* die
 * without replacing the attack, so it is folded into the threshold rather than
 * into the action.
 */
export function attackThresholdOf(state: GameState, survivorId: string): number {
  const survivor = getSurvivor(state, survivorId);
  const content = contentOf(state);
  const base = content.survivors.get(survivor.cardId)?.attackThreshold ?? 6;
  let modifier = 0;
  for (const iid of survivor.equipped) {
    const item = state.items[iid];
    const def = item ? content.items.get(item.cardId) : undefined;
    modifier += def?.attackDieModifier ?? 0;
  }
  return Math.max(1, base - modifier);
}

export function searchThresholdOf(state: GameState, survivorId: string): number {
  const survivor = getSurvivor(state, survivorId);
  return contentOf(state).survivors.get(survivor.cardId)?.searchThreshold ?? 6;
}

/* ------------------------------------------------------------------ *
 * Abilities (§7.7, §18.5)
 * ------------------------------------------------------------------ */

export interface AbilityLookup {
  ability: AbilityDefinition;
  /** Where the usage flags live — §18.5 pins them to the instance. */
  holder: { kind: 'survivor'; id: string } | { kind: 'item'; iid: string };
}

export function findAbility(
  state: GameState,
  survivorId: string,
  abilityId: string,
  itemIid?: string,
): AbilityLookup | null {
  const content = contentOf(state);
  const survivor = trySurvivor(state, survivorId);
  if (!survivor) return null;

  if (itemIid) {
    // §7.7: "A survivor cannot use another survivor's ability or equipped cards
    // unless an effect explicitly grants that access."
    if (!survivor.equipped.includes(itemIid)) return null;
    const item = state.items[itemIid];
    const def = item ? content.items.get(item.cardId) : undefined;
    const ability = def?.equippedAbilities?.find((a) => a.id === abilityId);
    return ability ? { ability, holder: { kind: 'item', iid: itemIid } } : null;
  }

  const def = content.survivors.get(survivor.cardId);
  if (survivor.cardId === 'sv-john-price' && survivor.copiedAbilityIds?.includes(abilityId)) {
    const copied = survivorsAt(state, survivor.location)
      .filter((other) => other.id !== survivor.id)
      .map((other) => content.survivors.get(other.cardId)?.ability)
      .find((ability) => ability?.id === abilityId);
    if (copied) {
      // John owns the copied usage window.  The original survivor's used flags
      // therefore cannot disable John's copy (§18.3).
      return { ability: copied, holder: { kind: 'survivor', id: survivorId } };
    }
  }
  if (def?.ability?.id !== abilityId || !def.ability) return null;
  return { ability: def.ability, holder: { kind: 'survivor', id: survivorId } };
}

function usageBuckets(state: GameState, holder: AbilityLookup['holder']) {
  return holder.kind === 'survivor' ? getSurvivor(state, holder.id) : getItem(state, holder.iid);
}

/** §7.7/§18.5: has this ability instance already been spent in its window? */
export function abilityAvailable(state: GameState, lookup: AbilityLookup): Verdict {
  const flags = usageBuckets(state, lookup.holder);
  const id = lookup.ability.id;
  switch (lookup.ability.usage) {
    case 'oncePerTurn':
      return flags.usedThisTurn.includes(id) ? fail('That ability is used up this turn.') : ok;
    case 'oncePerRound':
      // §18.5: transferring the card does not reset this, which is why the flag
      // is read off the instance rather than off the player.
      return flags.usedThisRound.includes(id) ? fail('That ability is used up this round.') : ok;
    case 'oncePerGame':
      return flags.usedThisGame.includes(id) ? fail('That ability has already been used.') : ok;
    default:
      return ok;
  }
}

function markAbilityUsed(state: GameState, lookup: AbilityLookup): void {
  const flags = usageBuckets(state, lookup.holder);
  const id = lookup.ability.id;
  if (lookup.ability.usage === 'oncePerTurn') flags.usedThisTurn.push(id);
  if (lookup.ability.usage === 'oncePerRound') flags.usedThisRound.push(id);
  if (lookup.ability.usage === 'oncePerGame') flags.usedThisGame.push(id);
}

/* ------------------------------------------------------------------ *
 * validateAction
 * ------------------------------------------------------------------ */

export function validateAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
): Verdict {
  if (!state.players[playerId]) return fail(`Unknown player '${playerId}'.`);
  if (state.phase === 'gameOver') return fail('The game is over.');
  const player = getPlayer(state, playerId);
  if (player.eliminated) return fail('You have been eliminated. §19.5');

  /* -- decisions first: they are legal while everything else is not -- */

  if (action.type === 'resolveChoice') {
    const choice = state.pendingChoices.find((c) => c.id === action.choiceId);
    if (!choice) return fail('That decision is no longer open.');
    if (choice.playerId !== playerId) return fail('That decision is not yours to make.');
    const min = choice.minPicks ?? 1;
    const max = choice.maxPicks ?? 1;
    if (action.optionIds.length < min || action.optionIds.length > max) {
      return fail(min === max ? `Choose exactly ${min}.` : `Choose between ${min} and ${max}.`);
    }
    for (const id of action.optionIds) {
      const option = choice.options.find((o) => o.id === id);
      if (!option) return fail('That is not one of the options.');
      if (!option.legal) return fail(option.reason ?? 'That option is not legal. §10');
    }
    return ok;
  }

  if (action.type === 'castVote') {
    if (!state.vote) return fail('No vote is in progress.');
    const barred = exileRestriction(state, playerId, 'castVote');
    if (barred) return fail(barred);
    if (!state.vote.electorate.includes(playerId)) return fail('You are not eligible to vote.');
    if (state.vote.votes[playerId] !== undefined) {
      return fail('Votes cannot be changed once committed. §15');
    }
    return ok;
  }

  const gate = turnGate(state, playerId);
  if (!gate.ok) return gate;

  switch (action.type) {
    /* -- §7 die actions ------------------------------------------ */

    case 'attackZombie': {
      const own = ownSurvivor(state, playerId, action.survivorId);
      if (!own.ok) return own;
      const survivor = getSurvivor(state, action.survivorId);
      const threshold = attackThresholdOf(state, action.survivorId);
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      if (action.die < threshold) return fail(`That attack needs a ${threshold} or better.`);
      const entrances = entrancesOf(state, survivor.location).filter(
        (e) => action.entrance === undefined || e.index === action.entrance,
      );
      if (!entrances.some((e) => e.zombies > 0)) return fail('There is no zombie to attack there.');
      return ok;
    }

    case 'attackSurvivor': {
      const own = ownSurvivor(state, playerId, action.survivorId);
      if (!own.ok) return own;
      const target = trySurvivor(state, action.targetId);
      if (!target) return fail('That survivor is not on the board.');
      // §7.2: "A player cannot target another survivor they control".
      if (target.controllerId === playerId) return fail('You cannot attack your own survivor.');
      const survivor = getSurvivor(state, action.survivorId);
      if (target.location !== survivor.location) return fail('That survivor is somewhere else.');
      const threshold = attackThresholdOf(state, action.survivorId);
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      if (action.die < threshold) return fail(`That attack needs a ${threshold} or better.`);
      return ok;
    }

    case 'search': {
      const own = ownSurvivor(state, playerId, action.survivorId);
      if (!own.ok) return own;
      const survivor = getSurvivor(state, action.survivorId);
      // §7.3: "A survivor may search only at a non-colony location."
      if (survivor.location === COLONY) return fail('You cannot search the colony. §7.3');
      const threshold = searchThresholdOf(state, action.survivorId);
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      if (action.die < threshold) return fail(`Searching here needs a ${threshold} or better.`);
      // §7.3: an empty location deck "is not replenished and nothing automatic
      // happens" — there is simply nothing to draw.
      if (locationState(state, survivor.location).deck.length === 0) {
        return fail('This location has been picked clean.');
      }
      return ok;
    }

    case 'barricade': {
      const own = ownSurvivor(state, playerId, action.survivorId);
      if (!own.ok) return own;
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      const survivor = getSurvivor(state, action.survivorId);
      const entrances = entrancesOf(state, survivor.location).filter(
        (e) => action.entrance === undefined || e.index === action.entrance,
      );
      if (!entrances.some((e) => entranceFree(e) > 0)) {
        return fail('There is no empty entrance space here. §7.4');
      }
      return ok;
    }

    case 'cleanWaste': {
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      // §7.5: "The player must control at least one survivor at the colony."
      if (!survivorsOf(state, playerId).some((s) => s.location === COLONY)) {
        return fail('You need a survivor at the colony to clean waste. §7.5');
      }
      if (state.colony.waste.length === 0) return fail('The waste pile is already empty.');
      return ok;
    }

    case 'attract': {
      const own = ownSurvivor(state, playerId, action.survivorId);
      if (!own.ok) return own;
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      const survivor = getSurvivor(state, action.survivorId);
      // §7.6: the source is "one other source location", and Attract "cannot
      // take zombies from two different source locations" nor move a zombie
      // between two colony entrances.
      if (action.from === survivor.location) {
        return fail('Attract must draw from a different location. §7.6');
      }
      // §18.1 errata: fewer than two, including zero, is legal.
      if (action.count < 0 || action.count > 2) return fail('Attract moves at most two zombies.');
      return ok;
    }

    case 'useAbility': {
      const own = ownSurvivor(state, playerId, action.survivorId);
      if (!own.ok) return own;
      const lookup = findAbility(state, action.survivorId, action.abilityId, action.itemIid);
      if (!lookup) return fail('That ability is not available to this survivor. §7.7');
      const survivor = getSurvivor(state, action.survivorId);
      if (lookup.ability.location !== 'ANYWHERE' && lookup.ability.location !== survivor.location) {
        return fail(`That ability only works at ${lookup.ability.location}. §7.7`);
      }
      const available = abilityAvailable(state, lookup);
      if (!available.ok) return available;
      if (action.abilityId === 'edward-clear' && !survivor.edwardAttackPending) {
        return fail('Edward White must complete a normal attack before this ability. §18.3');
      }
      if (lookup.ability.dieThreshold !== null) {
        if (action.die === undefined) return fail('That ability needs an action die.');
        if (!hasDie(player, action.die)) return fail('You have no such unused die.');
        if (action.die < lookup.ability.dieThreshold) {
          return fail(`That ability needs a ${lookup.ability.dieThreshold} or better.`);
        }
      }
      return ok;
    }

    /* -- §8 no-die actions --------------------------------------- */

    case 'playItem': {
      const zone = zoneOf(state, action.iid);
      if (zone.kind !== 'hand' || zone.playerId !== playerId) {
        return fail('That card is not in your hand.');
      }
      const def = contentOf(state).items.get(getItem(state, action.iid).cardId);
      if (!def) return fail('Unknown card.');
      if (def.kind === 'equip') {
        if (!action.targetSurvivorId) return fail('Choose a survivor to equip.');
        const own = ownSurvivor(state, playerId, action.targetSurvivorId);
        if (!own.ok) return own;
      }
      return ok;
    }

    case 'playFoodForDie': {
      if (!player.exiled) return fail('Only an exiled player may use a food card this way. §14.2');
      const zone = zoneOf(state, action.iid);
      if (zone.kind !== 'hand' || zone.playerId !== playerId) {
        return fail('That card is not in your hand.');
      }
      const def = contentOf(state).items.get(getItem(state, action.iid).cardId);
      if (!def) return fail('Unknown card.');
      if (!def.symbols.includes('food')) return fail('Only a food card can raise a die. §14.2');
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      if (action.die >= 6) return fail('A food card cannot raise a die above six. §14.2');
      return ok;
    }

    case 'contributeCrisis': {
      const barred = exileRestriction(state, playerId, 'contributeCrisis');
      if (barred) return fail(barred);
      if (!state.crisis.cardId) return fail('There is no active crisis.');
      if (action.iids.length === 0) return fail('Choose at least one card.');
      for (const iid of action.iids) {
        const zone = zoneOf(state, iid);
        const mine =
          (zone.kind === 'hand' && zone.playerId === playerId) ||
          (zone.kind === 'equipped' &&
            trySurvivor(state, zone.survivorId)?.controllerId === playerId);
        if (!mine) return fail('You can only contribute your own cards. §8.2');
      }
      return ok;
    }

    case 'contributeObjective': {
      const content = contentOf(state);
      const card = content.mainObjectives.get(state.mainObjective.cardId);
      const side = state.mainObjective.side === 'hardcore' ? card?.hardcore : card?.standard;
      if (!side?.contribution) return fail('This objective takes no contributions. §8.3');
      if (action.iids.length === 0) return fail('Choose at least one card.');
      const limit = side.contribution.maxPerTurn;
      if (limit !== undefined && state.mainObjective.contributionsThisTurn + action.iids.length > limit) {
        return fail(`This objective accepts ${limit} card(s) per turn. §8.3`);
      }
      for (const iid of action.iids) {
        const zone = zoneOf(state, iid);
        if (zone.kind !== 'hand' || zone.playerId !== playerId) {
          return fail('That card is not in your hand.');
        }
        // §8.3: "Only cards required by that objective may be added", and §18.2
        // excludes starter cards from a non-starter requirement.
        if (!itemMatches(state, iid, side.contribution.requirement)) {
          return fail('That card does not qualify for this objective. §8.3');
        }
      }
      return ok;
    }

    case 'moveSurvivor': {
      const own = ownSurvivor(state, playerId, action.survivorId);
      if (!own.ok) return own;
      const survivor = getSurvivor(state, action.survivorId);
      // §8.4: at most one move per turn.
      if (survivor.movedThisTurn) return fail('That survivor has already moved this turn. §8.4');
      if (action.to === survivor.location) return fail('They are already there.');
      if (player.exiled && action.to === COLONY) {
        return fail(exileRestriction(state, playerId, 'moveToColony')!);
      }
      if (!legalMoveDestinations(state, action.survivorId).includes(action.to)) {
        return fail('There is no empty survivor space there. §8.4');
      }
      return ok;
    }

    case 'spendFood': {
      const barred = exileRestriction(state, playerId, 'spendFood');
      if (barred) return fail(barred);
      if (action.count <= 0) return fail('Spend at least one food.');
      if (state.colony.food < action.count) return fail('The colony has less food than that.');
      if (!hasDie(player, action.die)) return fail('You have no such unused die.');
      // §8.5: "A die cannot be increased above six."
      if (action.die + action.count > 6) return fail('A die cannot go above six. §8.5');
      return ok;
    }

    case 'requestCards': {
      if (action.fromPlayerId === playerId) return fail('Ask somebody else.');
      const target = state.players[action.fromPlayerId];
      if (!target) return fail('Unknown player.');
      if (target.eliminated) return fail('That player is out of the game.');
      if (target.hand.length === 0) return fail('They have no cards.');
      return ok;
    }

    case 'handOff': {
      const zone = zoneOf(state, action.iid);
      if (zone.kind !== 'equipped') return fail('Only an equipped item can be handed off. §8.7');
      const giver = trySurvivor(state, zone.survivorId);
      if (!giver || giver.controllerId !== playerId) {
        return fail('That item is not equipped to one of your survivors.');
      }
      const receiver = trySurvivor(state, action.toSurvivorId);
      if (!receiver) return fail('That survivor is not on the board.');
      if (receiver.location !== giver.location) return fail('They are not at the same location. §8.7');
      if (receiver.id === giver.id) return fail('They already have it.');
      return ok;
    }

    case 'nominateExile': {
      if (!setupProfile(state.settings).exileEnabled) {
        return fail('Exile votes are disabled in this variant. §19.1');
      }
      if (state.vote) return fail('A vote is already in progress.');
      // §8.8: once during their turn, and never against themselves. An already
      // exiled player may still initiate one.
      if (player.nominatedThisTurn) return fail('You have already called a vote this turn. §8.8');
      if (action.targetPlayerId === playerId) return fail('You cannot nominate yourself. §8.8');
      const target = state.players[action.targetPlayerId];
      if (!target || target.eliminated) return fail('Unknown player.');
      if (target.exiled) return fail('They are already exiled.');
      if (nonExiledPlayers(state).length === 0) return fail('There is nobody left to vote.');
      return ok;
    }

    case 'endTurn':
      return ok;

    default:
      return fail('Unknown action.');
  }
}

/* ------------------------------------------------------------------ *
 * applyAction
 * ------------------------------------------------------------------ */

export function applyValidatedAction(
  state: GameState,
  now: number,
  playerId: PlayerId,
  action: GameAction,
): void {
  const player = getPlayer(state, playerId);

  switch (action.type) {
    case 'resolveChoice':
      resolveChoice(state, now, playerId, action.choiceId, action.optionIds);
      return;

    case 'castVote': {
      state.vote!.votes[playerId] = action.vote;
      state.vote!.committed.push(playerId);
      pushLog(state, now, {
        category: 'vote',
        playerId,
        // §15: commitments are simultaneous, so only the fact is public.
        message: `${player.name} has voted.`,
        data: { event: 'voteCommitted', playerId },
        audience: [playerId],
      });
      if (voteComplete(state)) finishVote(state, now);
      return;
    }

    case 'attackZombie': {
      spendDie(player, action.die);
      const survivor = getSurvivor(state, action.survivorId);
      // §7.1: at the colony the player may choose a zombie from any entrance.
      const entrances = entrancesOf(state, survivor.location).filter(
        (e) => (action.entrance === undefined || e.index === action.entrance) && e.zombies > 0,
      );
      const target = entrances[0]!;
      target.zombies -= 1;
      killZombieBookkeeping(state, now, survivor.location, true, survivor.id);
      const edwardCombo = survivor.cardId === 'sv-edward-white';
      if (edwardCombo) survivor.edwardAttackPending = true;
      state.turn?.events.push({
        event: 'actionPerformed',
        action: 'attackZombie',
        survivorId: survivor.id,
      });
      /*
       * §7.1's order, which §18.2 sharpens: resolve the mandatory on-kill
       * objective roll first, *then* roll exposure for the attacker.
       */
      const hook = zombieKillHook(state);
      pushFrame(
        state,
        [
          ...(hook ? [hook] : []),
          ...(!edwardCombo ? [{ kind: 'i.exposure' as const, survivorId: survivor.id }] : []),
        ],
        { controllerId: playerId, sourceSurvivorId: survivor.id },
      );
      return;
    }

    case 'attackSurvivor': {
      spendDie(player, action.die);
      const attacker = getSurvivor(state, action.survivorId);
      const target = getSurvivor(state, action.targetId);
      const targetValue = contentOf(state).survivors.get(target.cardId)?.attackThreshold ?? 6;
      // §7.2: "Reroll the spent action die as a new d6 result."
      const reroll = withRng(state, (rng) => rng.die(6));
      const hit = reroll <= targetValue;
      pushLog(state, now, {
        category: 'combat',
        playerId,
        message: `${survivorName(state, attacker)} attacks ${survivorName(state, target)}: ${reroll} vs ${targetValue} — ${
          hit ? 'hit' : 'miss'
        }.`,
        data: { event: 'survivorAttack', attacker: attacker.id, target: target.id, reroll, hit },
      });
      state.turn?.events.push({
        event: 'actionPerformed',
        action: 'attackSurvivor',
        survivorId: attacker.id,
      });
      if (!hit) return;
      // §7.2: a wound *and* one random card, and no exposure roll at all.
      pushFrame(
        state,
        [
          {
            kind: 'stealRandomCard',
            from: { kind: 'ref', id: target.controllerId },
            to: { kind: 'ref', id: playerId },
          },
        ],
        { controllerId: playerId, sourceSurvivorId: attacker.id },
      );
      addWounds(state, now, target.id, 1, false);
      return;
    }

    case 'search': {
      spendDie(player, action.die);
      const survivor = getSurvivor(state, action.survivorId);
      const location = survivor.location as NonColonyLocationId;
      state.search = {
        playerId,
        survivorId: survivor.id,
        location,
        drawn: [],
        noisePlaced: 0,
      };
      drawSearchCard(state, now);
      pushSearchChoice(state);
      return;
    }

    case 'barricade': {
      spendDie(player, action.die);
      const survivor = getSurvivor(state, action.survivorId);
      addBarricade(state, survivor.location, action.entrance);
      pushLog(state, now, {
        category: 'action',
        playerId,
        message: `${survivorName(state, survivor)} raises a barricade at ${survivor.location}.`,
        data: { event: 'barricade', location: survivor.location },
      });
      state.turn?.events.push({
        event: 'actionPerformed',
        action: 'barricade',
        survivorId: survivor.id,
      });
      return;
    }

    case 'cleanWaste': {
      spendDie(player, action.die);
      // §11.2: the pile is ordered, so cleaning always removes the most
      // recently played cards first.
      const removed: string[] = [];
      for (let i = 0; i < 3 && state.colony.waste.length > 0; i++) {
        const iid = state.colony.waste.pop()!;
        removeFromGame(state, iid);
        removed.push(iid);
      }
      pushLog(state, now, {
        category: 'action',
        playerId,
        message: `${player.name} burns ${removed.length} card${removed.length === 1 ? '' : 's'} from the waste pile.`,
        data: { event: 'cleanWaste', count: removed.length },
      });
      state.turn?.events.push({ event: 'actionPerformed', action: 'cleanWaste' });
      return;
    }

    case 'attract': {
      spendDie(player, action.die);
      const survivor = getSurvivor(state, action.survivorId);
      attractZombies(state, now, {
        from: action.from,
        to: survivor.location,
        count: action.count,
        ...(action.fromEntrances ? { fromEntrances: action.fromEntrances } : {}),
        ...(action.toEntrances ? { toEntrances: action.toEntrances } : {}),
      });
      state.turn?.events.push({
        event: 'actionPerformed',
        action: 'attract',
        survivorId: survivor.id,
      });
      return;
    }

    case 'useAbility': {
      const lookup = findAbility(state, action.survivorId, action.abilityId, action.itemIid)!;
      if (action.die !== undefined) spendDie(player, action.die);
      markAbilityUsed(state, lookup);
      const survivor = getSurvivor(state, action.survivorId);
      if (action.abilityId === 'edward-clear') survivor.edwardAttackPending = false;
      pushLog(state, now, {
        category: 'action',
        playerId,
        message: `${survivorName(state, survivor)} uses ${lookup.ability.text}`,
        data: { event: 'ability', abilityId: lookup.ability.id, survivorId: survivor.id },
      });
      state.turn?.events.push({
        event: 'actionPerformed',
        action: 'ability',
        survivorId: survivor.id,
      });
      pushFrame(state, [lookup.ability.effect], {
        controllerId: playerId,
        sourceSurvivorId: survivor.id,
        ...(action.itemIid ? { sourceInstanceId: action.itemIid } : {}),
      });
      return;
    }

    case 'playItem': {
      playItem(state, now, playerId, action.iid, action.targetSurvivorId);
      return;
    }

    case 'playFoodForDie': {
      const def = contentOf(state).items.get(getItem(state, action.iid).cardId)!;
      removeFromGame(state, action.iid);
      const i = player.unusedDice.indexOf(action.die);
      player.unusedDice[i] = action.die + 1;
      pushLog(state, now, {
        category: 'card',
        playerId,
        message: `${player.name} uses ${def.name} to raise an action die to ${action.die + 1}.`,
        data: { event: 'foodCardForDie', playerId, iid: action.iid, cardId: def.id, die: action.die + 1 },
      });
      state.turn?.events.push({ event: 'actionPerformed', action: 'playFoodForDie' });
      return;
    }

    case 'contributeCrisis': {
      for (const iid of action.iids) {
        // §8.2: "An equipped card ceases to be equipped when contributed."
        detachItem(state, iid);
        state.crisis.contributions.push({ playerId, iid });
      }
      pushLog(state, now, {
        category: 'crisis',
        playerId,
        // §3: the number is public, the identities are not.
        message: `${player.name} adds ${action.iids.length} card${
          action.iids.length === 1 ? '' : 's'
        } to the crisis.`,
        data: { event: 'crisisContribution', playerId, count: action.iids.length },
      });
      state.turn?.events.push({ event: 'actionPerformed', action: 'contributeCrisis' });
      return;
    }

    case 'contributeObjective': {
      for (const iid of action.iids) {
        detachItem(state, iid);
        state.mainObjective.contributions.push(iid);
      }
      state.mainObjective.contributionsThisTurn += action.iids.length;
      pushLog(state, now, {
        category: 'objective',
        playerId,
        // §3/§18.2: objective contributions are face up and public.
        message: `${player.name} adds ${action.iids.map((iid) => cardName(state, iid)).join(', ')} to the objective.`,
        data: { event: 'objectiveContribution', playerId, iids: [...action.iids] },
      });
      state.turn?.events.push({ event: 'actionPerformed', action: 'contributeObjective' });
      return;
    }

    case 'moveSurvivor':
      moveSurvivor(state, now, action.survivorId, action.to, {
        rollExposure: true,
        consumesAllowance: true,
      });
      return;

    case 'spendFood': {
      // §8.5: each token raises one selected unused die by one.
      state.colony.food -= action.count;
      const i = player.unusedDice.indexOf(action.die);
      player.unusedDice[i] = action.die + action.count;
      pushLog(state, now, {
        category: 'action',
        playerId,
        message: `${player.name} spends ${action.count} food to raise a die to ${action.die + action.count}.`,
        data: { event: 'spendFood', count: action.count, die: action.die + action.count },
      });
      return;
    }

    case 'requestCards':
      beginRequest(state, playerId, action.fromPlayerId);
      return;

    case 'handOff': {
      const zone = zoneOf(state, action.iid);
      const receiver = getSurvivor(state, action.toSurvivorId);
      if (zone.kind !== 'equipped') return;
      if (receiver.controllerId !== playerId) {
        // §8.7: "Both controllers must consent when the recipient belongs to
        // another player."
        pushChoice(state, {
          kind: 'handOffConsent',
          playerId: receiver.controllerId,
          prompt: `${player.name} offers ${cardName(state, action.iid)} to ${survivorName(state, receiver)}.`,
          options: [
            { id: 'accept', label: 'Accept', legal: true },
            { id: 'decline', label: 'Decline', legal: true },
          ],
          data: { iid: action.iid, toSurvivorId: action.toSurvivorId },
        });
        return;
      }
      completeHandOff(state, now, action.iid, action.toSurvivorId);
      return;
    }

    case 'nominateExile': {
      player.nominatedThisTurn = true;
      beginExileVote(state, now, playerId, action.targetPlayerId);
      return;
    }

    case 'endTurn':
      unshiftIntoCurrentFrame(state, [{ kind: 'i.endTurn' }]);
      return;

    default:
      throw new Error('Unknown action');
  }
}

/* ------------------------------------------------------------------ *
 * Playing a card (§8.1)
 * ------------------------------------------------------------------ */

function playItem(
  state: GameState,
  now: number,
  playerId: PlayerId,
  iid: string,
  targetSurvivorId?: string,
): void {
  const def = contentOf(state).items.get(getItem(state, iid).cardId)!;
  const player = getPlayer(state, playerId);

  pushLog(state, now, {
    category: 'card',
    playerId,
    message: `${player.name} plays ${def.name}.`,
    data: { event: 'playItem', playerId, iid, cardId: def.id, kind: def.kind },
  });
  state.turn?.events.push({ event: 'actionPerformed', action: 'playItem' });

  if (def.kind === 'equip' && targetSurvivorId) {
    detachItem(state, iid);
    getSurvivor(state, targetSurvivorId).equipped.push(iid);
    if (def.onPlay) {
      pushFrame(state, [def.onPlay], {
        controllerId: playerId,
        sourceSurvivorId: targetSurvivorId,
        sourceInstanceId: iid,
        sourceCardId: def.id,
      });
    }
    return;
  }

  /*
   * §8.1: the played card goes on top of the waste pile "unless it is equipped,
   * contributed, or removed by a rule/effect" — and §14.2 sends an exiled
   * player's played cards out of the game instead. `discardPlayedCard` owns
   * that fork. The card leaves the hand *before* its effect resolves so the
   * effect cannot see it as still held.
   */
  discardPlayedCard(state, iid, playerId);

  /*
   * Megaphone is a one-shot Attract card, not a no-op item.  Its printed
   * effect names the survivor's location but not a source location; the
   * digital action therefore uses the canonical board order and takes the
   * first other location that currently has zombies.  `attractZombies` still
   * owns the important rule: only empty destination entrance spaces may be
   * used, so a full destination moves fewer than two (including zero) and
   * never causes an overrun.  A future card-choice surface can replace this
   * deterministic source policy without changing the movement primitive.
   */
  if (def.id === 'it-megaphone') {
    const target = targetSurvivorId
      ? trySurvivor(state, targetSurvivorId)
      : survivorsOf(state, playerId)[0];
    if (target) {
      const sourceLocations: LocationId[] = [COLONY, ...NON_COLONY_LOCATIONS];
      const source = sourceLocations.find(
        (location) =>
          location !== target.location && entrancesOf(state, location).some((entrance) => entrance.zombies > 0),
      );
      if (source) {
        attractZombies(state, now, { from: source, to: target.location, count: 2 });
      }
    }
    return;
  }

  if (def.onPlay) {
    pushFrame(state, [def.onPlay], {
      controllerId: playerId,
      sourceInstanceId: iid,
      sourceCardId: def.id,
      ...(targetSurvivorId ? { sourceSurvivorId: targetSurvivorId } : {}),
    });
  }
}

function completeHandOff(state: GameState, now: number, iid: string, toSurvivorId: string): void {
  detachItem(state, iid);
  getSurvivor(state, toSurvivorId).equipped.push(iid);
  // §8.7/§18.5: "Used once-per-round state remains used." Nothing is cleared.
  pushLog(state, now, {
    category: 'card',
    message: `${cardName(state, iid)} changes hands.`,
    data: { event: 'handOff', iid, toSurvivorId },
  });
}

/* ------------------------------------------------------------------ *
 * Search (§7.3)
 * ------------------------------------------------------------------ */

function drawSearchCard(state: GameState, now: number): void {
  const search = state.search!;
  const deck = locationState(state, search.location).deck;
  const iid = deck.shift();
  if (!iid) return;
  search.drawn.push(iid);
  pushLog(state, now, {
    category: 'action',
    playerId: search.playerId,
    // §3: "Search results are private to the searching player."
    message: `${getPlayer(state, search.playerId).name} searches ${search.location}.`,
    data: { event: 'searchDraw', location: search.location, iid },
    audience: [search.playerId],
  });
}

function pushSearchChoice(state: GameState): void {
  const search = state.search!;
  const loc = locationState(state, search.location);
  const canMakeNoise = loc.noise < loc.noiseSpaces && loc.deck.length > 0;
  pushChoice(state, {
    kind: 'searchDecision',
    playerId: search.playerId,
    prompt: 'Keep one card, or make noise to see another.',
    options: [
      ...search.drawn.map((iid) => ({
        id: `keep:${iid}`,
        label: cardName(state, iid),
        legal: true,
      })),
      {
        id: 'noise',
        label: 'Place a noise token and draw another',
        legal: canMakeNoise,
        ...(canMakeNoise ? {} : { reason: 'No empty noise space or no cards left. §7.3' }),
      },
    ],
    // §3: even the option labels are secret here — they are the search results.
    private: true,
    data: { location: search.location, drawn: [...search.drawn] },
  });
}

function finishSearch(state: GameState, now: number, keptIid: string): void {
  const search = state.search!;
  const loc = locationState(state, search.location);
  getPlayer(state, search.playerId).hand.push(keptIid);
  // §7.3 + §24 policy: the rest go to the bottom in draw order.
  const rest = orderUnkeptSearchCards(search.drawn.filter((iid) => iid !== keptIid));
  loc.deck.push(...rest);
  pushLog(state, now, {
    category: 'action',
    playerId: search.playerId,
    message: `${getPlayer(state, search.playerId).name} keeps one card from the search.`,
    data: { event: 'searchKept', location: search.location, bottomed: rest.length },
    audience: [search.playerId],
  });
  state.search = null;
  state.turn?.events.push({ event: 'searchPerformed' });
  state.turn?.events.push({ event: 'actionPerformed', action: 'search' });
}

/* ------------------------------------------------------------------ *
 * Votes
 * ------------------------------------------------------------------ */

/**
 * Retires the open simultaneous-vote choice (§15).
 *
 * A simultaneous vote is the one decision that is never answered through
 * `resolveChoice`: every elector sends `castVote`, so nothing ever calls
 * `takeChoice` for it and the choice would otherwise outlive its own vote. That
 * matters more than a stray record — `advance()` returns while any choice is
 * pending and `turnGate` rejects every action behind one, so a surviving vote
 * choice deadlocks the match permanently at the first exile nomination.
 */
function closeVoteChoice(state: GameState): void {
  state.pendingChoices = state.pendingChoices.filter(
    (c) => !(c.kind === 'vote' && c.playerId === null),
  );
}

function finishVote(state: GameState, now: number): void {
  const vote = state.vote!;
  const result = tallyVote(state, now);

  // Retired before either branch: the tie-break below queues a *second* vote
  // choice, and leaving the first one behind would block the tie-break itself.
  closeVoteChoice(state);

  if (result === 'tie') {
    // §15: the first player breaks every tied group decision "even if the first
    // player did not otherwise participate".
    pushChoice(state, {
      kind: 'vote',
      playerId: state.firstPlayerId,
      prompt: `${vote.prompt} The vote is tied — you decide.`,
      options: [
        { id: 'yes', label: 'Yes', legal: true },
        { id: 'no', label: 'No', legal: true },
      ],
      data: { tieBreak: true },
    });
    return;
  }

  applyVoteResult(state, now, result === 'yes');
}

function applyVoteResult(state: GameState, now: number, passed: boolean): void {
  const vote = state.vote!;
  state.vote = null;
  if (vote.nomineeId) {
    if (passed) exilePlayer(state, now, vote.nomineeId);
    else {
      pushLog(state, now, {
        category: 'vote',
        message: `${getPlayer(state, vote.nomineeId).name} stays.`,
        data: { event: 'exileVoteFailed', nomineeId: vote.nomineeId },
      });
    }
    return;
  }
  const follow = passed ? vote.onPass : vote.onFail;
  if (follow) unshiftIntoCurrentFrame(state, [follow]);
}

/* ------------------------------------------------------------------ *
 * The universal decision channel
 * ------------------------------------------------------------------ */

function takeChoice(state: GameState, choiceId: string): PendingChoice {
  const i = state.pendingChoices.findIndex((c) => c.id === choiceId);
  const [choice] = state.pendingChoices.splice(i, 1);
  return choice!;
}

function resolveChoice(
  state: GameState,
  now: number,
  playerId: PlayerId,
  choiceId: string,
  optionIds: string[],
): void {
  const choice = takeChoice(state, choiceId);
  const pick = optionIds[0]!;

  switch (choice.kind) {
    case 'setupKeepSurvivors': {
      const dealt = (choice.data?.['dealt'] as string[]) ?? [];
      applySurvivorKeep(state, now, playerId, dealt, optionIds);
      return;
    }

    case 'setupChooseLeader':
    case 'chooseNewLeader': {
      const survivor = getSurvivor(state, pick);
      for (const s of survivorsOf(state, playerId)) s.isLeader = false;
      survivor.isLeader = true;
      getPlayer(state, playerId).leaderSurvivorId = survivor.id;
      pushLog(state, now, {
        category: 'setup',
        playerId,
        message: `${survivorName(state, survivor)} leads ${getPlayer(state, playerId).name}'s group.`,
        data: { event: 'leaderChosen', playerId, survivorId: survivor.id },
      });
      return;
    }

    case 'searchDecision': {
      if (pick === 'noise') {
        // §7.3: place one noise token in an empty noise space, then draw again.
        const search = state.search!;
        locationState(state, search.location).noise += 1;
        search.noisePlaced += 1;
        drawSearchCard(state, now);
        pushSearchChoice(state);
        return;
      }
      finishSearch(state, now, pick.slice('keep:'.length));
      return;
    }

    case 'biteTarget': {
      const data = choice.data ?? {};
      resolveBiteTarget(
        state,
        pick,
        data['location'] as LocationId,
        (data['excluded'] as string[]) ?? [],
        (data['deferred'] as PlayerId[]) ?? [],
      );
      return;
    }

    case 'biteResponse': {
      const data = choice.data ?? {};
      resolveBiteResponse(
        state,
        now,
        data['survivorId'] as string,
        data['location'] as LocationId,
        (data['excluded'] as string[]) ?? [],
        (data['deferred'] as PlayerId[]) ?? [],
        pick === 'kill' ? 'kill' : 'roll',
      );
      return;
    }

    case 'overrunCasualty': {
      const victim = getSurvivor(state, pick);
      unshiftIntoCurrentFrame(state, [
        { kind: 'i.kill', survivorId: victim.id, cause: 'overrun' },
        { kind: 'i.checkLastSurvivor', playerId: victim.controllerId },
      ]);
      return;
    }

    case 'exileRelocate':
      applyExileRelocation(
        state,
        now,
        playerId,
        choice.data!['survivorId'] as string,
        pick as NonColonyLocationId,
      );
      return;

    case 'exileSwap':
      applyExileSwap(state, now, playerId, choice.data!['survivorId'] as string, pick);
      return;

    case 'lastSurvivorPlacement': {
      const cardId = choice.data!['cardId'] as string;
      const asLeader = choice.data!['asLeader'] === true;
      placeSurvivor(state, now, playerId, cardId, pick as LocationId, asLeader);
      return;
    }

    case 'requestResponse': {
      const requesterId = choice.data!['requesterId'] as PlayerId;
      state.request = null;
      if (pick === 'decline') {
        pushLog(state, now, {
          category: 'card',
          playerId,
          message: `${getPlayer(state, playerId).name} gives nothing.`,
          data: { event: 'requestDeclined', requesterId, targetId: playerId },
        });
        return;
      }
      /*
       * §8.6: the given card "is revealed and must be played immediately by the
       * requester", and it "cannot be contributed directly to the crisis or main
       * objective" — which is exactly why it is played here rather than added
       * to the requester's hand as an ordinary draw.
       */
      detachItem(state, pick);
      getPlayer(state, requesterId).hand.push(pick);
      pushLog(state, now, {
        category: 'card',
        playerId,
        message: `${getPlayer(state, playerId).name} gives ${cardName(state, pick)} to ${getPlayer(state, requesterId).name}.`,
        data: { event: 'requestGranted', requesterId, targetId: playerId, iid: pick },
      });
      const def = contentOf(state).items.get(getItem(state, pick).cardId)!;
      if (def.kind === 'equip') {
        const candidates = survivorsOf(state, requesterId);
        if (candidates.length > 0) {
          playItem(state, now, requesterId, pick, candidates[0]!.id);
        }
      } else {
        playItem(state, now, requesterId, pick);
      }
      return;
    }

    case 'handOffConsent': {
      if (pick === 'accept') {
        completeHandOff(
          state,
          now,
          choice.data!['iid'] as string,
          choice.data!['toSurvivorId'] as string,
        );
      }
      return;
    }

    case 'vote': {
      // Only reached for the first player's tie-break (§15).
      applyVoteResult(state, now, pick === 'yes');
      return;
    }

    case 'chooseSurvivor':
    case 'effectOption': {
      if (choice.data?.['discard'] === true) {
        for (const iid of optionIds) discardPlayedCard(state, iid, playerId);
        return;
      }
      const outcome = choice.outcomes?.[pick];
      if (outcome) {
        const source = choice.data?.['cardId'] as string | undefined;
        const controllerId = (choice.data?.['controllerId'] as string | undefined) ?? playerId;
        unshiftIntoCurrentFrame(state, []);
        pushFrame(state, [outcome], {
          controllerId,
          ...(source ? { sourceCardId: source } : {}),
        });
      }
      return;
    }

    default:
      return;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers exported for the driver and tests
 * ------------------------------------------------------------------ */

/** Zombie count at a location, used by the client's legal-action preview. */
export function zombiesAtEntrance(state: GameState, location: LocationId, index: number): number {
  return entrancesOf(state, location).find((e) => e.index === index)?.zombies ?? 0;
}

export { removeZombies, survivorsAt, activeSeating };
