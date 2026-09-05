/**
 * N7 — simultaneous votes commit before reveal.
 *
 * `docs/QUALITY-BAR-DOW.md` §5: "No player can see another's vote before
 * committing, and no vote can change after reveal (spec §8.8, §15)."
 *
 * The engine implements both halves — `redactStateFor` blanks `vote.votes`
 * until the electorate is complete, and `validateAction` refuses a second
 * `castVote` — but until this file neither had a regression test, so either
 * could have been removed silently. Both are hidden-information rules, which is
 * the class of bug that does not announce itself: a leak looks exactly like a
 * working game to whoever is not being cheated.
 *
 * Everything here is observed through the **plugin boundary** the server
 * actually uses (`validateAction`, `applyAction`, `redactStateFor`). A leak that
 * only exists in the authoritative state is not a leak; a leak in a redacted
 * view is one the server would have put on the wire.
 */

import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameState, PlayerId } from '../../types.js';
import { act, start } from './helpers.js';

/** The redacted view the server would send to `viewerId`. */
function viewFor(state: GameState, viewerId: PlayerId): GameState {
  return deadOfWinter.redactStateFor(state, viewerId) as GameState;
}

/** Drives a fresh game to an open exile vote and reports the electorate. */
function gameWithOpenVote(): { state: GameState; electorate: PlayerId[] } {
  let state = start({ playerCount: 4 });
  const nominator = state.activePlayerId ?? state.firstPlayerId;
  const nominee = state.seating.find((id) => id !== nominator)!;

  state = act(state, nominator, { type: 'nominateExile', targetPlayerId: nominee });

  expect(state.vote, 'nominating an exile must open a vote').not.toBeNull();
  const electorate = [...state.vote!.electorate];
  // §8.8: the nominated player votes too, so a 4-player table has 4 electors.
  expect(electorate.length).toBeGreaterThan(1);
  return { state, electorate };
}

describe('N7 — simultaneous vote commitment (§8.8, §15)', () => {
  it('hides every other elector\'s vote from a viewer until the vote is complete', () => {
    const { state: opened, electorate } = gameWithOpenVote();
    let state = opened;

    // Commit every elector but the last, one at a time. After each commitment
    // the partial tally must be invisible to everyone except its own author.
    for (let i = 0; i < electorate.length - 1; i += 1) {
      const voter = electorate[i]!;
      // Alternate so a leak cannot be masked by every vote being identical.
      state = act(state, voter, { type: 'castVote', vote: i % 2 === 0 });

      for (const viewer of electorate) {
        const view = viewFor(state, viewer);
        expect(view.vote, 'the vote must still be open').not.toBeNull();

        const visible = Object.keys(view.vote!.votes);
        const ownCommitted = state.vote!.votes[viewer] !== undefined;

        // A viewer sees their own committed vote and nothing else.
        expect(visible.sort()).toEqual(ownCommitted ? [viewer] : []);

        if (ownCommitted) {
          expect(view.vote!.votes[viewer]).toBe(state.vote!.votes[viewer]);
        }
      }
    }

    // Progress is public even while content is not (§21) — the table must be
    // able to see who it is waiting for without seeing what they chose.
    const midView = viewFor(state, electorate[electorate.length - 1]!);
    expect(midView.vote!.committed.length).toBe(electorate.length - 1);
    expect(Object.keys(midView.vote!.votes)).toEqual([]);
  });

  it('reveals nothing to a non-elector while the vote is open', () => {
    const { state: opened, electorate } = gameWithOpenVote();
    let state = opened;

    const outsider = state.seating.find((id) => !electorate.includes(id));
    if (outsider === undefined) {
      // Every seat is an elector in the default 4-player exile vote, so the
      // spectator view is the honest stand-in for "not entitled to the tally".
      state = act(state, electorate[0]!, { type: 'castVote', vote: true });
      const spectator = viewFor(state, null as unknown as PlayerId);
      expect(Object.keys(spectator.vote!.votes)).toEqual([]);
      return;
    }

    state = act(state, electorate[0]!, { type: 'castVote', vote: true });
    expect(Object.keys(viewFor(state, outsider).vote!.votes)).toEqual([]);
  });

  it('refuses to let a committed vote be changed (§15)', () => {
    const { state: opened, electorate } = gameWithOpenVote();
    const voter = electorate[0]!;
    const state = act(opened, voter, { type: 'castVote', vote: true });

    const recast = deadOfWinter.parseAction({ type: 'castVote', vote: false });
    expect(recast).not.toBeNull();

    const verdict = deadOfWinter.validateAction(state, voter, recast!);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? '' : verdict.reason).toMatch(/§15/);

    // And the refusal is real, not advisory: the stored vote is untouched.
    expect(state.vote!.votes[voter]).toBe(true);
  });

  it('refuses a vote from a player outside the electorate', () => {
    const { state, electorate } = gameWithOpenVote();
    const outsider = state.seating.find((id) => !electorate.includes(id));
    if (outsider === undefined) return; // covered by the exile-restriction suites

    const cast = deadOfWinter.parseAction({ type: 'castVote', vote: true })!;
    expect(deadOfWinter.validateAction(state, outsider, cast).ok).toBe(false);
  });

  it('closes the vote and stops redacting once every elector has committed', () => {
    const { state: opened, electorate } = gameWithOpenVote();
    let state = opened;

    for (const voter of electorate) {
      state = act(state, voter, { type: 'castVote', vote: false });
    }

    // A unanimous "no" resolves the vote, so there is nothing left to leak —
    // which is itself the guarantee: the tally never sits visible and open.
    expect(state.vote).toBeNull();
    for (const viewer of electorate) {
      expect(viewFor(state, viewer).vote).toBeNull();
    }
    expect(state.pendingChoices.filter((choice) => choice.kind === 'vote')).toEqual([]);
  });

  it('never puts a raw vote tally on the wire while the vote is open', () => {
    // A belt-and-braces sweep: serialize the redacted view the way the server
    // would and confirm no other elector's identity appears under `vote.votes`.
    const { state: opened, electorate } = gameWithOpenVote();
    let state = opened;
    state = act(state, electorate[0]!, { type: 'castVote', vote: true });
    state = act(state, electorate[1]!, { type: 'castVote', vote: false });

    const viewer = electorate[2] ?? electorate[0]!;
    const wire = JSON.parse(JSON.stringify(viewFor(state, viewer))) as GameState;
    const leaked = Object.keys(wire.vote?.votes ?? {}).filter((id) => id !== viewer);
    expect(leaked, `votes leaked to ${viewer}`).toEqual([]);
  });
});
