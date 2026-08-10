/**
 * Selector and condition evaluation (§17).
 *
 * This half of the effect engine is pure: it reads state and answers questions,
 * it never mutates and it never asks a player anything. Anything that needs a
 * human — a `chosen` selector with more than one candidate — is the runner's
 * problem, and the functions here treat `chosen` as "every candidate" so a
 * condition can still be evaluated without prompting.
 *
 * §17's last paragraph is why `holdsCards` counts rather than consumes: "when
 * two objective requirements can be satisfied by the same cards, the same card
 * may count for both unless the objective text consumes or assigns it".
 */

import { COLONY, type LocationId, type NonColonyLocationId } from '../../content/primitives.js';
import type {
  CardRequirement,
  Condition,
  LocationSelector,
  PlayerSelector,
  SurvivorSelector,
} from '../../content/effects.js';
import type { EffectContext, GameState, PlayerId, SurvivorInstance } from '../../types.js';
import {
  activeSeating,
  allSurvivors,
  barricadesAt,
  colonyOccupants,
  contentOf,
  freeSurvivorSpaces,
  getPlayer,
  influenceOf,
  nonExiledPlayers,
  survivorsAt,
  survivorsOf,
  zombiesAt,
} from '../state.js';
import { locationOrder, orderCasualtyCandidates } from '../policy.js';

/** Everything an evaluation needs beyond the state itself. */
export interface EvalScope {
  ctx: EffectContext;
  vars: Record<string, number>;
}

export const scopeOf = (ctx: EffectContext, vars: Record<string, number> = {}): EvalScope => ({
  ctx,
  vars,
});

/* ------------------------------------------------------------------ *
 * Player selection
 * ------------------------------------------------------------------ */

export function resolvePlayers(
  state: GameState,
  sel: PlayerSelector,
  scope: EvalScope,
): PlayerId[] {
  switch (sel.kind) {
    case 'ref':
      return state.players[sel.id] ? [sel.id] : [];
    case 'activePlayer':
      return state.activePlayerId ? [state.activePlayerId] : [];
    case 'effectController':
      return scope.ctx.controllerId ? [scope.ctx.controllerId] : [];
    case 'firstPlayer':
      return [state.firstPlayerId];
    case 'allPlayers':
      return activeSeating(state);
    case 'allNonExiledPlayers':
      return nonExiledPlayers(state).map((p) => p.id);
    case 'otherPlayers': {
      const me = scope.ctx.controllerId ?? state.activePlayerId;
      return activeSeating(state).filter((id) => id !== me);
    }
    case 'chosen':
      // Unprompted evaluation: every candidate. The runner narrows this before
      // any effect actually fires.
      return resolvePlayers(state, { kind: sel.among } as PlayerSelector, scope);
    default:
      return [];
  }
}

/** The single player an effect is "for", used where a selector must be scalar. */
export function principalPlayer(
  state: GameState,
  sel: PlayerSelector,
  scope: EvalScope,
): PlayerId | null {
  return resolvePlayers(state, sel, scope)[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * Location selection
 * ------------------------------------------------------------------ */

export function resolveLocations(
  state: GameState,
  sel: LocationSelector,
  scope: EvalScope,
): LocationId[] {
  const content = contentOf(state);
  switch (sel.kind) {
    case 'fixed':
      return [sel.location];
    case 'colony':
      return [COLONY];
    case 'sourceLocation': {
      const sid = scope.ctx.sourceSurvivorId;
      const s = sid ? state.survivors[sid] : undefined;
      return s ? [s.location] : [];
    }
    case 'eachNonColony':
      return locationOrder(content) as LocationId[];
    case 'chosen': {
      const pool: LocationId[] =
        sel.among === 'nonColony'
          ? (locationOrder(content) as LocationId[])
          : [COLONY, ...(locationOrder(content) as LocationId[])];
      if (sel.among === 'occupied') return pool.filter((l) => survivorsAt(state, l).length > 0);
      return pool;
    }
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ *
 * Survivor selection
 * ------------------------------------------------------------------ */

export function resolveSurvivors(
  state: GameState,
  sel: SurvivorSelector,
  scope: EvalScope,
): SurvivorInstance[] {
  switch (sel.kind) {
    case 'ref': {
      const s = state.survivors[sel.id];
      return s ? [s] : [];
    }
    case 'source': {
      const sid = scope.ctx.sourceSurvivorId;
      const s = sid ? state.survivors[sid] : undefined;
      return s ? [s] : [];
    }
    case 'lowestInfluenceAt': {
      const locs = resolveLocations(state, sel.location, scope);
      const pool = locs.flatMap((l) => survivorsAt(state, l));
      return lowestInfluence(state, pool);
    }
    case 'allAt': {
      const locs = resolveLocations(state, sel.location, scope);
      let pool = locs.flatMap((l) => survivorsAt(state, l));
      if (sel.controlledBy) {
        const owners = new Set(resolvePlayers(state, sel.controlledBy, scope));
        pool = pool.filter((s) => owners.has(s.controllerId));
      }
      return pool;
    }
    case 'allControlledBy': {
      const owners = resolvePlayers(state, sel.player, scope);
      return owners.flatMap((id) => survivorsOf(state, id));
    }
    case 'chosen':
      return resolveSurvivors(state, sel.among, scope);
    default:
      return [];
  }
}

/**
 * §18.4: a survivor flagged `cannotBeKilled` is never an automatic casualty,
 * even though it occupies a space and counts for zombie generation.
 */
export function isCasualtyEligible(state: GameState, s: SurvivorInstance): boolean {
  return contentOf(state).survivors.get(s.cardId)?.cannotBeKilled !== true;
}

/**
 * The lowest-influence survivors in a pool, in the order §15's tie authority
 * establishes. Callers that need exactly one take the head.
 */
export function lowestInfluence(
  state: GameState,
  pool: readonly SurvivorInstance[],
): SurvivorInstance[] {
  const eligible = pool.filter((s) => isCasualtyEligible(state, s));
  if (eligible.length === 0) return [];
  let best = Infinity;
  for (const s of eligible) best = Math.min(best, influenceOf(state, s));
  return orderCasualtyCandidates(
    state,
    eligible.filter((s) => influenceOf(state, s) === best),
  );
}

/* ------------------------------------------------------------------ *
 * Card requirements (§8.3, §11.3, §18.2)
 * ------------------------------------------------------------------ */

/** Does this item instance satisfy a requirement? */
export function itemMatches(
  state: GameState,
  iid: string,
  requirement: CardRequirement | undefined,
): boolean {
  const inst = state.items[iid];
  if (!inst) return false;
  const def = contentOf(state).items.get(inst.cardId);
  if (!def) return false;
  if (!requirement) return true;
  // §18.2: a "non-starter cards" objective refuses the starter deck outright,
  // whatever symbols the card happens to carry.
  if (requirement.excludeStarter && def.deck === 'starter') return false;
  if (requirement.cardIds && requirement.cardIds.length > 0) {
    if (!requirement.cardIds.includes(def.id)) return false;
  }
  if (requirement.symbols && requirement.symbols.length > 0) {
    if (!def.symbols.some((s) => requirement.symbols!.includes(s))) return false;
  }
  return true;
}

/** Cards a player holds (hand, optionally equipment) that match a requirement. */
export function heldMatching(
  state: GameState,
  playerId: PlayerId,
  requirement: CardRequirement | undefined,
  includeEquipped = false,
): string[] {
  const player = getPlayer(state, playerId);
  const pool = [...player.hand];
  if (includeEquipped) {
    for (const s of survivorsOf(state, playerId)) pool.push(...s.equipped);
  }
  return pool.filter((iid) => itemMatches(state, iid, requirement));
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

const within = (value: number, atLeast?: number, atMost?: number): boolean =>
  (atLeast === undefined || value >= atLeast) && (atMost === undefined || value <= atMost);

export function evalCondition(state: GameState, cond: Condition, scope: EvalScope): boolean {
  switch (cond.kind) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'not':
      return !evalCondition(state, cond.of, scope);
    case 'all':
      return cond.of.every((c) => evalCondition(state, c, scope));
    case 'any':
      return cond.of.some((c) => evalCondition(state, c, scope));

    case 'morale':
      return within(state.colony.morale, cond.atLeast, cond.atMost);
    case 'roundsRemaining':
      return within(state.colony.rounds, cond.atLeast, cond.atMost);
    case 'food':
      return within(state.colony.food, cond.atLeast, cond.atMost);
    case 'wasteCount':
      return within(state.colony.waste.length, cond.atLeast, cond.atMost);
    case 'starvationTokens':
      return within(state.colony.starvation, cond.atLeast, undefined);
    case 'roundsSurvived':
      return state.roundsSurvived >= cond.atLeast;

    case 'zombiesAt': {
      const total = resolveLocations(state, cond.location, scope).reduce(
        (n, l) => n + zombiesAt(state, l),
        0,
      );
      return within(total, cond.atLeast, cond.atMost);
    }
    case 'survivorsAt': {
      let pool = resolveLocations(state, cond.location, scope).flatMap((l) => survivorsAt(state, l));
      if (cond.controlledBy) {
        const owners = new Set(resolvePlayers(state, cond.controlledBy, scope));
        pool = pool.filter((s) => owners.has(s.controllerId));
      }
      return within(pool.length, cond.atLeast, cond.atMost);
    }
    case 'helplessSurvivors':
      return within(state.colony.helpless, cond.atLeast, cond.atMost);
    case 'colonyHasEmptySurvivorSpace':
      return freeSurvivorSpaces(state, COLONY) > 0;
    case 'barricadesAt': {
      const total = resolveLocations(state, cond.location, scope).reduce(
        (n, l) => n + barricadesAt(state, l),
        0,
      );
      return total >= cond.atLeast;
    }

    case 'playerExiled':
      return resolvePlayers(state, cond.player, scope).every((id) => getPlayer(state, id).exiled);
    case 'handCount': {
      const ids = resolvePlayers(state, cond.player, scope);
      return ids.every((id) => within(getPlayer(state, id).hand.length, cond.atLeast, cond.atMost));
    }
    case 'strictlyMostCardsInHand': {
      // §18.2 `Hoarder`: tying for most is not enough.
      const me = principalPlayer(state, cond.player, scope);
      if (!me) return false;
      const mine = getPlayer(state, me).hand.length;
      return activeSeating(state)
        .filter((id) => id !== me)
        .every((id) => getPlayer(state, id).hand.length < mine);
    }
    case 'holdsCards': {
      const ids = resolvePlayers(state, cond.player, scope);
      return ids.every(
        (id) =>
          heldMatching(state, id, cond.requirement, cond.includeEquipped ?? false).length >=
          cond.atLeast,
      );
    }
    case 'controlsSurvivors': {
      const ids = resolvePlayers(state, cond.player, scope);
      return ids.every((id) => within(survivorsOf(state, id).length, cond.atLeast, cond.atMost));
    }

    case 'objectiveContributions': {
      const matching = state.mainObjective.contributions.filter((iid) =>
        itemMatches(state, iid, cond.requirement),
      );
      return matching.length >= cond.atLeast;
    }
    case 'counter':
      return within(state.mainObjective.counters[cond.counter] ?? 0, cond.atLeast, cond.atMost);
    case 'counterPerStartingPlayer': {
      const value = state.mainObjective.counters[cond.counter] ?? 0;
      return value >= cond.atLeast * state.mainObjective.startingPlayerCount;
    }

    case 'variable':
      return within(scope.vars[cond.name] ?? 0, cond.atLeast, cond.atMost);

    default:
      // A condition kind the engine does not know is malformed content, and §22
      // requires a rules error rather than a silent pass.
      throw new Error(`Unsupported condition '${(cond as { kind: string }).kind}'`);
  }
}

/* ------------------------------------------------------------------ *
 * Convenience for phase code
 * ------------------------------------------------------------------ */

export const emptyScope = (): EvalScope => ({
  ctx: { sourceCardId: null, sourceInstanceId: null, controllerId: null, sourceSurvivorId: null },
  vars: {},
});

/** All survivors on the board, in canonical location order. §2.1, §11.4. */
export function survivorsInLocationOrder(state: GameState): SurvivorInstance[] {
  const order: LocationId[] = [COLONY, ...(locationOrder(contentOf(state)) as NonColonyLocationId[])];
  return order.flatMap((l) => survivorsAt(state, l));
}

export { colonyOccupants, allSurvivors };
