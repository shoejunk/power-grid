/**
 * Zombie placement, barricades and overruns — §12, plus the Attract rules of
 * §7.6 that deliberately do *not* use them.
 *
 * §12's placement loop is one zombie at a time and every zombie can start a
 * death, so each placement is an effect rather than an iteration: an overrun in
 * the middle of a batch must be able to stop the batch, kill someone, run a
 * last-survivor replacement, and then continue with the next zombie exactly
 * where it left off (§9.4 even calls out that a replacement "interrupts the
 * current placement sequence").
 */

import { COLONY, type LocationId, type NonColonyLocationId } from '../content/primitives.js';
import type { EngineEffect, EntranceState, GameState, PlayerId } from '../types.js';
import {
  entranceFree,
  entrancesOf,
  getPlayer,
  locationState,
  pushChoice,
  pushLog,
  survivorsAt,
  unshiftIntoCurrentFrame,
  withRng,
} from './state.js';
import { lowestInfluence } from './effects/conditions.js';
import { killHelpless } from './survivors.js';

/* ------------------------------------------------------------------ *
 * Entrance selection (§12)
 * ------------------------------------------------------------------ */

/**
 * §11.4: "When a separate effect starts a new add-zombies sequence, colony
 * entrance cycling restarts at entrance 1." Every batch calls this first, and
 * crisis-driven placement calls it too — which is what stops crisis zombies
 * from advancing the pointer the later Add Zombies step uses.
 */
export function resetEntrancePointer(state: GameState): void {
  state.colony.entrancePointer = 0;
}

/**
 * Places one zombie and returns what happened, so the caller can log it and
 * queue the consequences.
 *
 * §12's three outcomes at a full entrance are deliberately distinct: a
 * barricade absorbs the zombie and is destroyed, an unbarricaded full entrance
 * overruns, and either way the *next* zombie moves on round the cycle.
 */
export type PlacementOutcome = 'placed' | 'barricadeDestroyed' | 'overrun' | 'discarded';

export function placeZombie(
  state: GameState,
  now: number,
  location: LocationId,
  cycleEntrances: boolean,
): PlacementOutcome {
  const entrances = entrancesOf(state, location);
  if (entrances.length === 0) return 'discarded';

  let entrance: EntranceState;
  if (location === COLONY && cycleEntrances) {
    const idx = state.colony.entrancePointer % entrances.length;
    entrance = entrances[idx]!;
    // §12: the pointer advances after every incoming zombie, whether it landed,
    // ate a barricade or overran.
    state.colony.entrancePointer = (idx + 1) % entrances.length;
  } else {
    entrance = entrances[0]!;
  }

  let outcome: PlacementOutcome;
  if (entranceFree(entrance) > 0) {
    entrance.zombies += 1;
    outcome = 'placed';
  } else if (entrance.barricades > 0) {
    // §12: destroy one barricade and *discard* the incoming zombie — it does
    // not take the space it just cleared.
    entrance.barricades -= 1;
    outcome = 'barricadeDestroyed';
  } else {
    outcome = 'overrun';
  }

  pushLog(state, now, {
    category: 'zombie',
    message:
      outcome === 'placed'
        ? `A zombie arrives at ${location}${location === COLONY ? ` entrance ${entrance.index}` : ''}.`
        : outcome === 'barricadeDestroyed'
          ? `A barricade at ${location}${
              location === COLONY ? ` entrance ${entrance.index}` : ''
            } is destroyed.`
          : `${location}${location === COLONY ? ` entrance ${entrance.index}` : ''} is overrun.`,
    data: { event: 'zombiePlacement', location, entrance: entrance.index, outcome },
  });

  if (outcome === 'overrun') {
    // §12: death cleanup and replacement finish before the next incoming zombie.
    unshiftIntoCurrentFrame(state, [{ kind: 'i.overrun', location }]);
  }
  return outcome;
}

/* ------------------------------------------------------------------ *
 * Overrun (§12)
 * ------------------------------------------------------------------ */

/**
 * Resolves an overrun casualty.
 *
 * §12 names the lowest-influence *normal* survivor, falls back to a helpless
 * survivor, and otherwise does nothing at all. Where several survivors tie for
 * lowest, §15's tie authority makes it the first player's call, and §21
 * requires the game to pause for it rather than pick silently.
 */
export function resolveOverrun(state: GameState, now: number, location: LocationId): void {
  const candidates = lowestInfluence(state, survivorsAt(state, location));

  if (candidates.length === 0) {
    if (location === COLONY && state.colony.helpless > 0) {
      killHelpless(state, now, 'an overrun at the colony');
      return;
    }
    pushLog(state, now, {
      category: 'zombie',
      message: `The overrun at ${location} finds nobody.`,
      data: { event: 'overrunEmpty', location },
    });
    return;
  }

  if (candidates.length === 1) {
    unshiftIntoCurrentFrame(state, [
      { kind: 'i.kill', survivorId: candidates[0]!.id, cause: 'overrun' },
      { kind: 'i.checkLastSurvivor', playerId: candidates[0]!.controllerId },
    ]);
    return;
  }

  pushChoice(state, {
    kind: 'overrunCasualty',
    // §15: the first player breaks every tied group decision.
    playerId: state.firstPlayerId,
    prompt: `Several survivors tie for lowest influence at ${location}. Choose the casualty.`,
    options: candidates.map((s) => ({ id: s.id, label: s.id, legal: true })),
    data: { location },
  });
}

/* ------------------------------------------------------------------ *
 * Noise (§11.4)
 * ------------------------------------------------------------------ */

/**
 * Removes one noise token and rolls for it. §11.4: a result of three or lower
 * adds one zombie at that location. Each token is a separate roll, which is why
 * §2.5 insists noise is represented individually.
 */
export function rollNoise(state: GameState, now: number, location: NonColonyLocationId): void {
  const loc = locationState(state, location);
  if (loc.noise <= 0) return;
  loc.noise -= 1;
  const roll = withRng(state, (rng) => rng.die(6));
  pushLog(state, now, {
    category: 'zombie',
    message: `Noise at ${location} rolls ${roll}.`,
    data: { event: 'noiseRoll', location, roll },
  });
  if (roll <= 3) placeZombie(state, now, location, false);
}

/* ------------------------------------------------------------------ *
 * Barricades and noise placement (§7.4, §7.3)
 * ------------------------------------------------------------------ */

export function addBarricade(state: GameState, location: LocationId, entranceIndex?: number): boolean {
  const entrances = entrancesOf(state, location);
  const target =
    entranceIndex !== undefined
      ? entrances.find((e) => e.index === entranceIndex)
      : entrances.find((e) => entranceFree(e) > 0);
  if (!target || entranceFree(target) <= 0) return false;
  target.barricades += 1;
  return true;
}

export function removeBarricade(state: GameState, location: LocationId): boolean {
  for (const e of entrancesOf(state, location)) {
    if (e.barricades > 0) {
      e.barricades -= 1;
      return true;
    }
  }
  return false;
}

export function addNoise(state: GameState, location: NonColonyLocationId, count: number): number {
  const loc = locationState(state, location);
  const added = Math.min(count, Math.max(0, loc.noiseSpaces - loc.noise));
  loc.noise += added;
  return added;
}

export function removeNoise(state: GameState, location: NonColonyLocationId, count: number): number {
  const loc = locationState(state, location);
  const removed = Math.min(count, loc.noise);
  loc.noise -= removed;
  return removed;
}

/* ------------------------------------------------------------------ *
 * Removing and killing zombies (§7.1)
 * ------------------------------------------------------------------ */

/**
 * Takes zombies off the board without treating it as a kill.
 *
 * §7.1: "An effect that says it removes a zombie, rather than kills it, is not
 * a kill and does not satisfy kill-based objectives" — so this function never
 * rolls exposure and never records a `zombieKilled` event. `killZombies` in the
 * effect runner is the other verb, and the two must not be merged.
 */
export function removeZombies(
  state: GameState,
  location: LocationId,
  count: number,
  fromEntrances?: number[],
): number {
  let left = count;
  let removed = 0;
  const entrances = entrancesOf(state, location).filter(
    (e) => fromEntrances === undefined || fromEntrances.includes(e.index),
  );
  for (const e of entrances) {
    while (left > 0 && e.zombies > 0) {
      e.zombies -= 1;
      left -= 1;
      removed += 1;
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ *
 * Attract (§7.6)
 * ------------------------------------------------------------------ */

export interface AttractPlan {
  from: LocationId;
  to: LocationId;
  count: number;
  fromEntrances?: number[];
  toEntrances?: number[];
}

/**
 * Why Attract is not a zombie-addition effect (§12's closing line, §18.5's
 * Megaphone ruling): attracted zombies "can occupy only currently empty
 * entrance spaces. They never destroy a barricade and never cause an overrun".
 *
 * Returns the number actually moved, which §18.1's errata allows to be fewer
 * than two, including zero.
 */
export function attractZombies(state: GameState, now: number, plan: AttractPlan): number {
  const destination = entrancesOf(state, plan.to);
  const capacity = destination
    .filter((e) => plan.toEntrances === undefined || plan.toEntrances.includes(e.index))
    .reduce((n, e) => n + entranceFree(e), 0);

  const available = entrancesOf(state, plan.from)
    .filter((e) => plan.fromEntrances === undefined || plan.fromEntrances.includes(e.index))
    .reduce((n, e) => n + e.zombies, 0);

  const moving = Math.min(plan.count, capacity, available);
  if (moving <= 0) return 0;

  removeZombies(state, plan.from, moving, plan.fromEntrances);

  // §7.6: arrivals at the colony "may be distributed among its entrances in any
  // way; the normal 1-through-6 placement cycle does not apply".
  let left = moving;
  const targets =
    plan.toEntrances === undefined
      ? destination
      : plan.toEntrances
          .map((i) => destination.find((e) => e.index === i))
          .filter((e): e is EntranceState => e !== undefined);
  for (const e of targets) {
    while (left > 0 && entranceFree(e) > 0) {
      e.zombies += 1;
      left -= 1;
    }
  }

  pushLog(state, now, {
    category: 'zombie',
    message: `${moving} zombie${moving === 1 ? '' : 's'} attracted from ${plan.from} to ${plan.to}.`,
    data: { event: 'attract', from: plan.from, to: plan.to, count: moving },
  });
  return moving;
}

/* ------------------------------------------------------------------ *
 * Batch construction (§11.4)
 * ------------------------------------------------------------------ */

/** Effects for one location's worth of placements, newest batch first. */
export function placementEffects(
  location: LocationId,
  count: number,
  cycleEntrances: boolean,
): EngineEffect[] {
  return Array.from({ length: Math.max(0, count) }, () => ({
    kind: 'i.placeZombie' as const,
    location,
    cycleEntrances,
  }));
}

/** Convenience for tests and effects that need "who controls anything here". */
export function controllersAt(state: GameState, location: LocationId): PlayerId[] {
  const ids = new Set(survivorsAt(state, location).map((s) => s.controllerId));
  return [...ids].filter((id) => getPlayer(state, id) !== undefined);
}
