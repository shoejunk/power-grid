/**
 * The effect interpreter (§17, §20).
 *
 * One effect is executed per call. That granularity is the whole design: §20
 * requires the game to be able to stop between any two effects and resume after
 * a reconnection, and §8.1 requires an effect already in progress to be
 * uninterruptible by ordinary item play. Both fall out of "the remaining work
 * lives in `state.effectStack`, and a pending choice blocks the stack".
 *
 * Two verbs are kept rigorously apart throughout, per §7.1:
 *
 *   killZombies  — a kill. Rolls exposure, satisfies kill-based objectives.
 *   removeZombies — not a kill. Neither of those things happens.
 *
 * `isAttack` is a third, independent axis: §7.1 says "an ability that kills
 * zombies is not automatically an attack, but it is still a kill".
 */

import { COLONY, type LocationId, type NonColonyLocationId } from '../../content/primitives.js';
import type { Effect, EffectOption, SurvivorSelector } from '../../content/effects.js';
import type {
  EffectFrame,
  EngineEffect,
  GameState,
  InternalEffect,
  PlayerId,
  SurvivorInstance,
} from '../../types.js';
import {
  adjustMorale,
  contentOf,
  detachItem,
  discardPlayedCard,
  getPlayer,
  locationState,
  pushChoice,
  pushLog,
  removeFromGame,
  survivorsAt,
  trySurvivor,
  unshiftIntoCurrentFrame,
  withRng,
} from '../state.js';
import { clampMorale } from '../policy.js';
import {
  evalCondition,
  heldMatching,
  itemMatches,
  principalPlayer,
  resolveLocations,
  resolvePlayers,
  resolveSurvivors,
  scopeOf,
  type EvalScope,
} from './conditions.js';
import {
  addSurvivorToPlayer,
  addWounds,
  checkLastSurvivor,
  healWounds,
  killSurvivor,
  moveSurvivor,
  rollExposure,
  stepBiteChain,
  survivorName,
} from '../survivors.js';
import {
  addBarricade,
  addNoise,
  placeZombie,
  removeBarricade,
  removeNoise,
  removeZombies,
  resetEntrancePointer,
  resolveOverrun,
  rollNoise,
} from '../zombies.js';
import { beginRound, beginTurn, endTurn, moraleCheckpoint, runColonyStep } from '../flow.js';
import { colonyElectorate, exileElectorate, stepExileRelocation } from '../exile.js';
import { checkAllEliminated, endGame } from '../endgame.js';

/* ------------------------------------------------------------------ *
 * The step function
 * ------------------------------------------------------------------ */

/**
 * Executes at most one effect. Returns false when there is nothing to run —
 * either the stack is empty or a choice is blocking it.
 */
export function stepEffects(state: GameState, now: number): boolean {
  if (state.pendingChoices.length > 0) return false;
  while (state.effectStack.length > 0) {
    const frame = state.effectStack[state.effectStack.length - 1]!;
    if (frame.queue.length === 0) {
      state.effectStack.pop();
      continue;
    }
    const effect = frame.queue.shift()!;
    execute(state, now, frame, effect);
    return true;
  }
  return false;
}

const scopeFor = (frame: EffectFrame): EvalScope => scopeOf(frame.ctx, frame.vars);

/* ------------------------------------------------------------------ *
 * Target resolution with a pause for choices
 * ------------------------------------------------------------------ */

/**
 * Resolves a survivor selector, pausing for the chooser when the selector is a
 * `chosen` with real alternatives.
 *
 * `rebind` produces the same effect with the selector replaced by a concrete
 * `ref`, so the resumed effect never re-asks. This is what §17's "choices with
 * legality predicates" costs in practice: the effect has to be re-expressible
 * with its choice already made.
 */
function survivorTargets(
  state: GameState,
  frame: EffectFrame,
  sel: SurvivorSelector,
  rebind: (survivorId: string) => EngineEffect,
): SurvivorInstance[] | null {
  const scope = scopeFor(frame);
  if (sel.kind !== 'chosen') return resolveSurvivors(state, sel, scope);

  const candidates = resolveSurvivors(state, sel.among, scope);
  if (candidates.length <= 1) return candidates;

  const chooser =
    principalPlayer(state, sel.by, scope) ?? state.activePlayerId ?? state.firstPlayerId;
  pushChoice(state, {
    kind: 'chooseSurvivor',
    playerId: chooser,
    prompt: 'Choose a survivor.',
    options: candidates.map((s) => ({ id: s.id, label: survivorName(state, s), legal: true })),
    outcomes: Object.fromEntries(candidates.map((s) => [s.id, rebind(s.id)])),
    frameId: frame.id,
  });
  return null;
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

function execute(state: GameState, now: number, frame: EffectFrame, effect: EngineEffect): void {
  if (effect.kind.startsWith('i.')) {
    executeInternal(state, now, effect as InternalEffect);
    return;
  }
  executeAuthored(state, now, frame, effect as Effect);
}

/* ------------------------------------------------------------------ *
 * Internal effects — rulebook procedures
 * ------------------------------------------------------------------ */

function executeInternal(state: GameState, now: number, effect: InternalEffect): void {
  switch (effect.kind) {
    case 'i.beginRound':
      beginRound(state, now);
      return;
    case 'i.beginTurn':
      beginTurn(state, now, effect.playerId);
      return;
    case 'i.endTurn':
      endTurn(state, now);
      return;
    case 'i.colonyStep':
      runColonyStep(state, now, effect.step);
      return;
    case 'i.resetEntrancePointer':
      resetEntrancePointer(state);
      return;
    case 'i.placeZombie':
      placeZombie(state, now, effect.location, effect.cycleEntrances);
      return;
    case 'i.overrun':
      resolveOverrun(state, now, effect.location);
      return;
    case 'i.noiseRoll':
      rollNoise(state, now, effect.location);
      return;
    case 'i.moraleCheckpoint':
      moraleCheckpoint(state, now);
      return;
    case 'i.exposure':
      rollExposure(state, now, effect.survivorId);
      return;
    case 'i.kill': {
      const outcome = killSurvivor(state, now, effect.survivorId, effect.cause);
      if (!outcome) return;
      if (effect.cause === 'bite') {
        // §9.2: the chain starts once the bitten survivor is dead, and §9.2
        // defers this player's replacement until the chain ends.
        const survivor = effect.survivorId;
        unshiftIntoCurrentFrame(state, [
          {
            kind: 'i.biteChain',
            location: locationOfDeath(state, survivor) ?? COLONY,
            excluded: [survivor],
            deferred: outcome.lostLastSurvivor ? [outcome.controllerId] : [],
          },
        ]);
        return;
      }
      if (outcome.lostLastSurvivor) {
        unshiftIntoCurrentFrame(state, [
          { kind: 'i.checkLastSurvivor', playerId: outcome.controllerId },
        ]);
      }
      return;
    }
    case 'i.biteChain':
      stepBiteChain(state, now, effect.location, effect.excluded, effect.deferred);
      return;
    case 'i.checkLastSurvivor':
      checkLastSurvivor(state, now, effect.playerId);
      checkAllEliminated(state, now);
      return;
    case 'i.resolveExile':
      stepExileRelocation(state, now, effect.playerId);
      return;
    case 'i.checkCrossroads':
      return;
    case 'i.endGame':
      endGame(state, now, effect.reason);
      return;
    default:
      throw new Error(`Unknown internal effect '${(effect as { kind: string }).kind}'`);
  }
}

/**
 * Where a just-killed survivor stood.
 *
 * The instance is already gone by the time the bite chain is queued, so the
 * location is recovered from the death log entry rather than the entity — the
 * alternative, keeping a tombstone in `state.survivors`, would leak a dead
 * survivor into every selector in the engine.
 */
function locationOfDeath(state: GameState, survivorId: string): LocationId | null {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const entry = state.log[i]!;
    if (entry.data?.['event'] === 'survivorDied' && entry.data['survivorId'] === survivorId) {
      return (entry.data['location'] as LocationId) ?? null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Authored effects — the content language
 * ------------------------------------------------------------------ */

function executeAuthored(state: GameState, now: number, frame: EffectFrame, effect: Effect): void {
  const scope = scopeFor(frame);

  switch (effect.kind) {
    case 'noop':
      return;

    /*
     * §8.1/§20: a sequence is atomic. Unshifting its children into the *current*
     * frame keeps them contiguous at the head of the queue, so nothing an
     * outer effect queued later can slip between them.
     */
    case 'sequence':
      frame.queue.unshift(...effect.effects);
      return;

    /*
     * §17 asks for "simultaneous operations when card text demands them". A
     * single-threaded reducer cannot literally act at once, so simultaneity is
     * implemented as an uninterruptible block in card order — the observable
     * difference being that no player choice may be interleaved. It is logged
     * distinctly so a rules dispute can see which reading was applied.
     */
    case 'simultaneous':
      pushLog(state, now, {
        category: 'effect',
        message: 'Simultaneous effects resolve together.',
        data: { event: 'simultaneous', count: effect.effects.length },
      });
      frame.queue.unshift(...effect.effects);
      return;

    /*
     * §10: "A clause qualified by 'if able' may fail without cancelling
     * unqualified parts of the same effect." Every effect below is already
     * written to do nothing rather than fault when it cannot apply, so the
     * wrapper is a marker for the log and a guarantee for the author.
     */
    case 'ifAble':
      frame.queue.unshift(effect.effect);
      return;

    case 'branch': {
      const next = evalCondition(state, effect.test, scope) ? effect.then : effect.otherwise;
      if (next) frame.queue.unshift(next);
      return;
    }

    case 'repeat':
      frame.queue.unshift(...Array.from({ length: Math.max(0, effect.times) }, () => effect.effect));
      return;

    /* -- colony counters ------------------------------------------ */

    case 'adjustMorale':
      adjustMorale(state, now, effect.amount, 'a card effect');
      return;

    case 'adjustFood':
      state.colony.food = Math.max(0, state.colony.food + effect.amount);
      pushLog(state, now, {
        category: 'card',
        message: `The colony's food is now ${state.colony.food}.`,
        data: { event: 'food', amount: effect.amount, total: state.colony.food },
      });
      return;

    case 'adjustRounds':
      state.colony.rounds = Math.max(0, state.colony.rounds + effect.amount);
      return;

    case 'addStarvation':
      state.colony.starvation += effect.amount;
      return;

    case 'adjustCounter': {
      const before = state.mainObjective.counters[effect.counter] ?? 0;
      state.mainObjective.counters[effect.counter] = Math.max(0, before + effect.amount);
      pushLog(state, now, {
        category: 'objective',
        message: `${effect.counter}: ${state.mainObjective.counters[effect.counter]}.`,
        data: {
          event: 'counter',
          counter: effect.counter,
          before,
          after: state.mainObjective.counters[effect.counter],
        },
      });
      return;
    }

    /* -- zombies -------------------------------------------------- */

    case 'addZombies': {
      const queue: EngineEffect[] = [];
      for (const loc of resolveLocations(state, effect.location, scope)) {
        // §11.4: a fresh add-zombies sequence restarts the colony cycle.
        if (loc === COLONY) queue.push({ kind: 'i.resetEntrancePointer' });
        for (let i = 0; i < effect.count; i++) {
          queue.push({ kind: 'i.placeZombie', location: loc, cycleEntrances: loc === COLONY });
        }
      }
      frame.queue.unshift(...queue);
      return;
    }

    case 'removeZombies':
      // §7.1: removal is not a kill — no exposure, no objective credit.
      for (const loc of resolveLocations(state, effect.location, scope)) {
        const gone = removeZombies(state, loc, effect.count);
        if (gone > 0) {
          pushLog(state, now, {
            category: 'zombie',
            message: `${gone} zombie${gone === 1 ? '' : 's'} removed from ${loc}.`,
            data: { event: 'zombiesRemoved', location: loc, count: gone, isKill: false },
          });
        }
      }
      return;

    case 'killZombies': {
      const killerList = effect.killer
        ? resolveSurvivors(state, effect.killer, scope)
        : frame.ctx.sourceSurvivorId
          ? resolveSurvivors(state, { kind: 'source' }, scope)
          : [];
      const killer = killerList[0];
      const follow: EngineEffect[] = [];
      for (const loc of resolveLocations(state, effect.location, scope)) {
        for (let i = 0; i < effect.count; i++) {
          if (removeZombies(state, loc, 1) === 0) break;
          killZombieBookkeeping(state, now, loc, effect.isAttack, killer?.id);
          const objectiveHook = zombieKillHook(state);
          if (objectiveHook) follow.push(objectiveHook);
          // §7.1/§18.5: one exposure roll per zombie killed, unless cancelled.
          if (effect.rollExposure && killer) follow.push({ kind: 'i.exposure', survivorId: killer.id });
        }
      }
      frame.queue.unshift(...follow);
      return;
    }

    /* -- survivors ------------------------------------------------ */

    case 'addSurvivor':
      for (const playerId of resolvePlayers(state, effect.to, scope)) {
        for (let i = 0; i < effect.count; i++) addSurvivorToPlayer(state, now, playerId);
      }
      return;

    case 'addHelpless': {
      // §14.2: an exiled player "does not add helpless survivors when
      // instructed to do so".
      const controller = frame.ctx.controllerId;
      if (controller && getPlayer(state, controller).exiled) return;
      // §13: nothing may be added with no empty colony survivor space.
      const free = state.colony.survivorSpaces - survivorsAt(state, COLONY).length - state.colony.helpless;
      const added = Math.max(0, Math.min(effect.count, free));
      state.colony.helpless += added;
      if (added > 0) {
        pushLog(state, now, {
          category: 'card',
          message: `${added} helpless survivor${added === 1 ? '' : 's'} arrive at the colony.`,
          data: { event: 'helplessAdded', count: added },
        });
      }
      return;
    }

    case 'killSurvivor': {
      const targets = survivorTargets(state, frame, effect.target, (id) => ({
        ...effect,
        target: { kind: 'ref', id },
      }));
      if (targets === null) return;
      frame.queue.unshift(
        ...targets.map((s) => ({ kind: 'i.kill', survivorId: s.id, cause: 'effect' }) as const),
      );
      return;
    }

    case 'removeSurvivor': {
      const targets = survivorTargets(state, frame, effect.target, (id) => ({
        ...effect,
        target: { kind: 'ref', id },
      }));
      if (targets === null) return;
      for (const survivor of targets) removeSurvivorFromGame(state, now, survivor, effect.reduceMorale === true);
      return;
    }

    case 'wound': {
      const targets = survivorTargets(state, frame, effect.target, (id) => ({
        ...effect,
        target: { kind: 'ref', id },
      }));
      if (targets === null) return;
      for (const survivor of targets) {
        addWounds(state, now, survivor.id, effect.amount, effect.frostbite === true);
      }
      return;
    }

    case 'heal': {
      const targets = survivorTargets(state, frame, effect.target, (id) => ({
        ...effect,
        target: { kind: 'ref', id },
      }));
      if (targets === null) return;
      // §8.1: "A healing card effect cannot be refused when it targets a legal
      // survivor" — so there is no decline branch here by design.
      for (const survivor of targets) {
        healWounds(state, now, survivor.id, effect.amount, effect.frostbiteFirst === true);
      }
      return;
    }

    case 'rollExposure': {
      const targets = survivorTargets(state, frame, effect.target, (id) => ({
        ...effect,
        target: { kind: 'ref', id },
      }));
      if (targets === null) return;
      frame.queue.unshift(
        ...targets.map((s) => ({ kind: 'i.exposure', survivorId: s.id }) as const),
      );
      return;
    }

    case 'moveSurvivor': {
      const targets = survivorTargets(state, frame, effect.target, (id) => ({
        ...effect,
        target: { kind: 'ref', id },
      }));
      if (targets === null) return;
      const destinations = resolveLocations(state, effect.to, scope);
      const destination = destinations[0];
      if (!destination) return;
      for (const survivor of targets) {
        moveSurvivor(state, now, survivor.id, destination, {
          rollExposure: effect.rollExposure !== false,
          consumesAllowance: effect.consumesMoveAllowance === true,
        });
      }
      return;
    }

    /* -- cards ---------------------------------------------------- */

    case 'drawItems': {
      for (const playerId of resolvePlayers(state, effect.to, scope)) {
        for (let i = 0; i < effect.count; i++) {
          const deck = deckArrayFor(state, effect.deck, frame);
          const iid = deck?.shift();
          if (!iid) break;
          getPlayer(state, playerId).hand.push(iid);
          pushLog(state, now, {
            category: 'card',
            playerId,
            // §3: the count is public, the identity is not.
            message: `${getPlayer(state, playerId).name} draws a card.`,
            data: { event: 'drawItem', playerId },
            audience: [playerId],
          });
        }
      }
      return;
    }

    case 'discardItems': {
      for (const playerId of resolvePlayers(state, effect.from, scope)) {
        const matching = heldMatching(state, playerId, effect.requirement);
        if (matching.length === 0) continue;
        if (matching.length <= effect.count) {
          for (const iid of matching) discardPlayedCard(state, iid, playerId);
          continue;
        }
        pushChoice(state, {
          kind: 'effectOption',
          playerId,
          prompt: `Discard ${effect.count} card${effect.count === 1 ? '' : 's'}.`,
          options: matching.map((iid) => ({ id: iid, label: cardName(state, iid), legal: true })),
          minPicks: effect.count,
          maxPicks: effect.count,
          private: true,
          data: { discard: true, playerId },
        });
      }
      return;
    }

    case 'stealRandomCard': {
      const from = principalPlayer(state, effect.from, scope);
      const to = principalPlayer(state, effect.to, scope);
      if (!from || !to || from === to) return;
      const victim = getPlayer(state, from);
      if (victim.hand.length === 0) return;
      // §7.2: "The random card selection must be authoritative and reveal the
      // stolen card only to its new owner and the former owner."
      const iid = withRng(state, (rng) => rng.pick(victim.hand));
      detachItem(state, iid);
      getPlayer(state, to).hand.push(iid);
      pushLog(state, now, {
        category: 'card',
        playerId: to,
        message: `${getPlayer(state, to).name} takes a card from ${victim.name}.`,
        data: { event: 'stealCard', from, to, iid },
        audience: [from, to],
      });
      return;
    }

    case 'searchDeckForCard': {
      const deck = deckArrayFor(state, effect.deck, frame);
      const to = principalPlayer(state, effect.to, scope);
      if (!deck || !to) return;
      const idx = deck.findIndex((iid) => state.items[iid]?.cardId === effect.cardId);
      if (idx >= 0) {
        const [iid] = deck.splice(idx, 1);
        if (iid) getPlayer(state, to).hand.push(iid);
      }
      // §10: "If a crossroads effect searches a deck for a named card,
      // reshuffle that deck afterward" — whether or not the card was found.
      const shuffled = withRng(state, (rng) => rng.shuffle(deck));
      deck.length = 0;
      deck.push(...shuffled);
      return;
    }

    case 'removeCrisisContributions': {
      // §18.4 `Old Divisions`: the thumbs-up option removes existing crisis
      // contributions *without revealing them*.
      const count = state.crisis.contributions.length;
      for (const contribution of [...state.crisis.contributions]) {
        removeFromGame(state, contribution.iid);
      }
      state.crisis.contributions = [];
      pushLog(state, now, {
        category: 'crisis',
        message: `${count} crisis contribution${count === 1 ? '' : 's'} withdrawn${
          effect.reveal ? '' : ' unseen'
        }.`,
        data: { event: 'crisisContributionsRemoved', count, revealed: effect.reveal },
      });
      return;
    }

    /* -- board furniture ------------------------------------------ */

    case 'addBarricade':
      for (const loc of resolveLocations(state, effect.location, scope)) {
        for (let i = 0; i < effect.count; i++) if (!addBarricade(state, loc)) break;
      }
      return;

    case 'removeBarricade':
      for (const loc of resolveLocations(state, effect.location, scope)) {
        for (let i = 0; i < effect.count; i++) if (!removeBarricade(state, loc)) break;
      }
      return;

    case 'addNoise':
      for (const loc of resolveLocations(state, effect.location, scope)) {
        if (loc !== COLONY) addNoise(state, loc as NonColonyLocationId, effect.count);
      }
      return;

    case 'removeNoise':
      for (const loc of resolveLocations(state, effect.location, scope)) {
        if (loc !== COLONY) removeNoise(state, loc as NonColonyLocationId, effect.count);
      }
      return;

    /* -- decisions ------------------------------------------------ */

    case 'choice': {
      const chooser =
        principalPlayer(state, effect.chooser, scope) ?? state.activePlayerId ?? state.firstPlayerId;
      const options = effect.options.map((opt: EffectOption) => {
        const legal = opt.requires === undefined || evalCondition(state, opt.requires, scope);
        return {
          id: opt.id,
          label: opt.text,
          legal,
          ...(legal ? {} : { reason: 'Conditions for this option are not met.' }),
        };
      });
      if (!options.some((o) => o.legal)) {
        // §10: malformed content fails closed rather than being skipped.
        throw new Error(`Effect choice '${effect.prompt}' has no legal option (§10).`);
      }
      pushChoice(state, {
        kind: 'effectOption',
        playerId: chooser,
        prompt: effect.prompt,
        options,
        outcomes: Object.fromEntries(effect.options.map((o) => [o.id, o.outcome])),
        frameId: frame.id,
      });
      return;
    }

    case 'vote': {
      const electorate =
        effect.electorate === 'colonySurvivors' ? colonyElectorate(state) : exileElectorate(state);
      if (electorate.length === 0) {
        frame.queue.unshift(effect.onFail);
        return;
      }
      state.vote = {
        prompt: effect.prompt,
        electorate,
        votes: {},
        committed: [],
        nomineeId: null,
        onPass: effect.onPass,
        onFail: effect.onFail,
      };
      pushChoice(state, {
        kind: 'vote',
        playerId: null,
        prompt: effect.prompt,
        options: [
          { id: 'yes', label: 'Yes', legal: true },
          { id: 'no', label: 'No', legal: true },
        ],
        data: { electorate },
      });
      return;
    }

    case 'requestCard': {
      // §8.6: giving is voluntary, and the given card must be played
      // immediately by the requester. `Request is a permitted nested action`,
      // which is why it is an effect at all.
      const requester = principalPlayer(state, effect.requester, scope);
      const target = principalPlayer(state, effect.from, scope);
      if (!requester || !target || requester === target) return;
      beginRequest(state, requester, target);
      if (effect.then) frame.queue.unshift(effect.then);
      return;
    }

    case 'rollDie': {
      const value = withRng(state, (rng) => rng.die(effect.sides));
      frame.vars[effect.store] = value;
      pushLog(state, now, {
        category: 'effect',
        message: `A d${effect.sides} rolls ${value}.`,
        data: { event: 'effectRoll', sides: effect.sides, value, store: effect.store },
      });
      return;
    }

    case 'endGame':
      endGame(state, now, 'effect');
      return;

    default:
      // §22: an unknown effect kind is malformed content. Fail closed.
      throw new Error(`Unsupported effect '${(effect as { kind: string }).kind}'`);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers shared with the action layer
 * ------------------------------------------------------------------ */

export function cardName(state: GameState, iid: string): string {
  const item = state.items[iid];
  if (!item) return iid;
  return contentOf(state).items.get(item.cardId)?.name ?? item.cardId;
}

/**
 * Bookkeeping every zombie kill shares, whatever verb produced it: the log
 * entry, the `zombieKilled` trigger event and the attack/non-attack
 * distinction §7.1 insists on keeping visible.
 */
export function killZombieBookkeeping(
  state: GameState,
  now: number,
  location: LocationId,
  isAttack: boolean,
  killerId?: string,
): void {
  pushLog(state, now, {
    category: 'combat',
    message: `A zombie is killed at ${location}.`,
    data: { event: 'zombieKilled', location, isAttack, killerId },
  });
  if (state.turn) {
    state.turn.events.push({ event: 'zombieKilled', ...(killerId ? { survivorId: killerId } : {}) });
  }
}

/**
 * §18.2: the objective's own per-kill hook, run before exposure.
 *
 * Returns the effect to queue, or null when the objective has none.
 */
export function zombieKillHook(state: GameState): Effect | null {
  const card = contentOf(state).mainObjectives.get(state.mainObjective.cardId);
  if (!card) return null;
  const side = state.mainObjective.side === 'hardcore' ? card.hardcore : card.standard;
  return side.onZombieKilled ?? null;
}

/**
 * §9.3: removal is not death. The survivor leaves the board and the card leaves
 * the game, but morale is untouched "unless that effect explicitly says to".
 */
function removeSurvivorFromGame(
  state: GameState,
  now: number,
  survivor: SurvivorInstance,
  reduceMorale: boolean,
): void {
  if (reduceMorale) {
    killSurvivor(state, now, survivor.id, 'effect');
    return;
  }
  const controllerId = survivor.controllerId;
  const controller = getPlayer(state, controllerId);
  for (const iid of [...survivor.equipped]) {
    detachItem(state, iid);
    if (survivor.location === COLONY) controller.hand.push(iid);
    else locationState(state, survivor.location).deck.push(iid);
  }
  delete state.survivors[survivor.id];
  state.decks.removedFromGame.survivors.push(survivor.cardId);
  if (survivor.isLeader) controller.leaderSurvivorId = null;
  pushLog(state, now, {
    category: 'death',
    playerId: controllerId,
    message: `${survivorName(state, survivor)} is removed from the game (no morale lost).`,
    data: { event: 'survivorRemoved', survivorId: survivor.id, cardId: survivor.cardId },
  });
  unshiftIntoCurrentFrame(state, [{ kind: 'i.checkLastSurvivor', playerId: controllerId }]);
}

/** Resolves a `DeckSelector` to the live array it names. */
function deckArrayFor(
  state: GameState,
  deck: { kind: string; location?: string },
  frame: EffectFrame,
): string[] | null {
  switch (deck.kind) {
    case 'locationItems':
      return state.locations[deck.location as string]?.deck ?? null;
    case 'sourceLocationItems': {
      const survivor = frame.ctx.sourceSurvivorId
        ? trySurvivor(state, frame.ctx.sourceSurvivorId)
        : undefined;
      if (!survivor || survivor.location === COLONY) return null;
      return state.locations[survivor.location]?.deck ?? null;
    }
    default:
      return null;
  }
}

/** §8.6: opens a request and asks the target whether they will give a card. */
export function beginRequest(state: GameState, requesterId: PlayerId, targetId: PlayerId): void {
  state.request = { requesterId, targetId };
  const target = getPlayer(state, targetId);
  pushChoice(state, {
    kind: 'requestResponse',
    playerId: targetId,
    prompt: `${getPlayer(state, requesterId).name} asks you for a card.`,
    options: [
      ...target.hand.map((iid) => ({ id: iid, label: cardName(state, iid), legal: true })),
      // Giving is voluntary (§8.6), so refusal is always a legal answer.
      { id: 'decline', label: 'Give nothing', legal: true },
    ],
    private: true,
    data: { requesterId, targetId },
  });
}

/** Clamped morale write used by the choice resolver for card outcomes. */
export const clamp = clampMorale;

export { itemMatches };
