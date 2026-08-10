/**
 * Default action resolution — the anti-deadlock contract.
 *
 * Regression origin: every one of the server's fallback actions was pass-like,
 * but §6 makes passing illegal during the first round's mandatory purchase, so
 * any game containing a bot deadlocked on the very first
 * auction turn. These tests pin the invariant that broke.
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '../../types.js';
import { applyAction, defaultActionFor, legalActions, validateAction } from '../index.js';
import { NOW, fresh } from './helpers.js';
import { randomZone } from '../setup.js';

/**
 * Drives a game entirely by default actions.
 *
 * What this asserts is the safety property, not the quality of play: every
 * reachable state offers a legal action, so nothing ever hangs. The strength of
 * the move chosen is `bot.test.ts`'s subject.
 */
function autoplay(state: GameState, maxTurns = 600) {
  let s = state;
  let turns = 0;

  for (; turns < maxTurns; turns++) {
    if (s.phase === 'gameOver') break;
    const actor = s.activePlayerId;
    if (!actor) throw new Error(`No active player in phase '${s.phase}' round ${s.round}`);

    const action = defaultActionFor(s, actor);
    if (!action) {
      throw new Error(
        `Deadlock: no default action for ${actor} in phase '${s.phase}', round ${s.round}, step ${s.step}`,
      );
    }

    const verdict = validateAction(s, actor, action);
    if (!verdict.ok) {
      throw new Error(
        `Default action ${action.type} was illegal for ${actor} in phase '${s.phase}': ${verdict.reason}`,
      );
    }

    s = applyAction(s, actor, action, NOW + turns);
  }

  return { state: s, turns };
}

function started(opts: Parameters<typeof fresh>[0] = {}): GameState {
  const s = fresh(opts);
  return applyAction(s, s.hostId, { type: 'selectZone', areas: randomZone(s) }, NOW);
}

describe('defaultActionFor — setup stages', () => {
  /*
   * Regression: an audit found that a host dropping between "start game" and
   * "choose zone" stranded the table permanently — nobody else may choose
   * (§2 gives it to the host), no default action was offered, and the stale
   * state persisted across a server restart.
   *
   * The original version of this suite could not have caught it: its `started`
   * helper applied `selectZone` BEFORE handing the state to `autoplay`, so the
   * one setup stage with no default was never reached. These tests start from
   * a genuinely fresh game instead.
   */
  it('offers a legal zone selection when the host must choose', () => {
    const s = fresh({ playerCount: 3, seed: 'AUTO-ZONE' });
    expect(s.phase).toBe('setup');
    expect(s.setupStage).toBe('zoneSelection');
    expect(legalActions(s, s.hostId).zoneRequired).toBe(true);

    const action = defaultActionFor(s, s.hostId);
    expect(action).toEqual({ type: 'selectZone', areas: [] });
    expect(validateAction(s, s.hostId, action!).ok).toBe(true);
  });

  it('drives a game from creation through setup with no human input at all', () => {
    const { state, turns } = autoplay(fresh({ playerCount: 4, seed: 'AUTO-FULLSETUP' }), 200);
    expect(state.zone.length).toBeGreaterThan(0);
    expect(state.phase).not.toBe('setup');
    expect(turns).toBeGreaterThan(10);
  });

  it('covers the experienced-start setup stage from creation', () => {
    const { state } = autoplay(
      fresh({ playerCount: 3, seed: 'AUTO-EXPSETUP', experiencedStart: true }),
      200,
    );
    expect(state.phase).not.toBe('setup');
    for (const p of Object.values(state.players)) {
      if (!p.isTrust) expect(p.markedStartCity).toBeTruthy();
    }
  });
});

describe('defaultActionFor — never deadlocks', () => {
  it('§6 supplies a legal action during the first-round mandatory purchase', () => {
    const s = started({ playerCount: 3, seed: 'AUTOPLAY-R1' });
    expect(s.phase).toBe('auction');
    expect(s.round).toBe(1);

    const actor = s.activePlayerId!;
    const legal = legalActions(s, actor);

    // The precondition that caused the original bug: passing is NOT available.
    expect(legal.canPassNomination).toBe(false);

    const action = defaultActionFor(s, actor);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('nominatePlant');
    expect(validateAction(s, actor, action!).ok).toBe(true);
  });

  it('opens at the minimum bid on a plant it can afford', () => {
    const s = started({ playerCount: 4, seed: 'AUTOPLAY-CHEAP' });
    const actor = s.activePlayerId!;
    const legal = legalActions(s, actor);

    const action = defaultActionFor(s, actor);
    expect(action!.type).toBe('nominatePlant');
    const nomination = action as Extract<typeof action, { type: 'nominatePlant' }>;
    const chosen = legal.nominatablePlants.find((p) => p.plantId === nomination.plantId)!;
    // §6: opening above the floor only ever pays more for the same plant.
    expect(nomination.bid).toBe(chosen.minimumBid);
    expect(chosen.affordable).toBe(true);
  });

  it('answers a live auction with a sealed range it can pay', () => {
    let s = started({ playerCount: 3, seed: 'AUTOPLAY-BID' });
    const opener = s.activePlayerId!;
    const first = defaultActionFor(s, opener)!;
    s = applyAction(s, opener, first, NOW);

    // Someone else is now on the clock inside a live auction.
    expect(s.auction).not.toBeNull();
    const responder = s.activePlayerId!;
    const bidding = legalActions(s, responder).bidding!;
    const action = defaultActionFor(s, responder)!;

    if (action.type === 'passBid') return; // declining is a legal answer too
    expect(action.type).toBe('submitBidRange');
    const range = action as Extract<typeof action, { type: 'submitBidRange' }>;
    expect(range.minBid).toBe(bidding.minimumRaise);
    expect(range.maxBid).toBeGreaterThanOrEqual(range.minBid);
    expect(range.maxBid).toBeLessThanOrEqual(s.players[responder]!.money);
  });

  it('returns null for a player the engine is not waiting on', () => {
    const s = started({ playerCount: 3, seed: 'AUTOPLAY-IDLE' });
    const idle = s.playerOrder.find((id) => id !== s.activePlayerId)!;
    expect(defaultActionFor(s, idle)).toBeNull();
  });
});

describe('defaultActionFor — no reachable state can deadlock', () => {
  /* The real regression test. `autoplay` throws the moment any state offers no
     legal default, naming the phase that stalled. Running many rounds across
     every player count sweeps setup, all five phases, and Step transitions. */
  for (const playerCount of [2, 3, 4, 5, 6]) {
    it(`sustains a ${playerCount}-player game indefinitely with no human input`, () => {
      const { state, turns } = autoplay(started({ playerCount, seed: `AUTO-${playerCount}` }));
      expect(turns).toBeGreaterThan(50);
      expect(['order', 'auction', 'resources', 'building', 'bureaucracy', 'gameOver']).toContain(
        state.phase,
      );
      // Rounds really advanced — this is not one phase spinning in place.
      expect(state.round).toBeGreaterThan(3);
    });
  }

  it('handles the extra setup decision in an experienced-start game', () => {
    const { state } = autoplay(
      started({ playerCount: 3, seed: 'AUTO-EXP', experiencedStart: true }),
      200,
    );
    expect(state.round).toBeGreaterThan(2);
  });

  it('is deterministic — identical seeds produce identical states', () => {
    const a = autoplay(started({ playerCount: 4, seed: 'AUTO-DET' }), 200);
    const b = autoplay(started({ playerCount: 4, seed: 'AUTO-DET' }), 200);
    expect(a.turns).toBe(b.turns);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});
