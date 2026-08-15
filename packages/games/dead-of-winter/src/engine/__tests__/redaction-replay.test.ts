import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameState, PlayerId } from '../../types.js';
import { validateAction } from '../index.js';
import { NON_COLONY_LOCATIONS } from '../../content/primitives.js';
import { NOW, act, pending, start, survivorsOfPlayer } from './helpers.js';

interface Step {
  playerId: PlayerId;
  action: GameAction;
}

function drive(seed: string, maxTurns = 40) {
  let s = start({ playerCount: 4, seed, settings: { mainObjectiveId: 'mo-stockpile' } });
  const script: Step[] = [];
  const record = (playerId: PlayerId, action: GameAction) => {
    script.push({ playerId, action });
    s = act(s, playerId, action, NOW);
  };
  let turns = 0;
  let guard = 0;
  const stackWhilePending: string[] = [];
  while (s.phase !== 'gameOver' && turns < maxTurns && guard++ < 5000) {
    const choice = pending(s);
    if (choice) {
      stackWhilePending.push(
        `${choice.kind}:frames=${s.effectStack.length}:q=${s.effectStack.map((f) => f.queue.length).join(',')}`,
      );
      const legal = choice.options.filter((o) => o.legal);
      const picks = Math.max(1, choice.minPicks ?? 1);
      const actor = choice.playerId ?? s.seating[0]!;
      record(actor, {
        type: 'resolveChoice',
        choiceId: choice.id,
        optionIds: legal.slice(0, picks).map((o) => o.id),
      });
      continue;
    }
    if (!s.turn) break;
    const p = s.turn.playerId;
    turns++;
    // move + search + barricade, then end turn
    const mine = survivorsOfPlayer(s, p);
    for (let i = 0; i < mine.length; i++) {
      const sv = mine[i]!;
      const to = NON_COLONY_LOCATIONS[(turns + i) % NON_COLONY_LOCATIONS.length]!;
      const a: GameAction = { type: 'moveSurvivor', survivorId: sv.id, to };
      if (validateAction(s, p, a).ok) record(p, a);
      if (pending(s)) break;
    }
    while (!pending(s) && s.turn?.playerId === p) {
      const dice = [...(s.players[p]?.unusedDice ?? [])].sort((a, b) => b - a);
      let did = false;
      for (const sv of survivorsOfPlayer(s, p)) {
        for (const die of dice) {
          const a: GameAction = { type: 'search', survivorId: sv.id, die };
          if (validateAction(s, p, a).ok) {
            record(p, a);
            did = true;
            break;
          }
        }
        if (did) break;
      }
      if (!did) break;
    }
    if (!pending(s) && s.turn?.playerId === p) {
      record(p, { type: 'endTurn' });
    }
  }
  return { state: s, script, stackWhilePending };
}

describe('explore', () => {
  it('explores', () => {
    const r = drive('SEED-ALPHA');
    // eslint-disable-next-line no-console
    console.log({
      phase: r.state.phase,
      round: r.state.round,
      steps: r.script.length,
      log: r.state.log.length,
      rngCursor: r.state.rngCursor,
      stackWhilePending: [...new Set(r.stackWhilePending)],
      outcome: r.state.outcome?.reason,
    });
    expect(r.script.length).toBeGreaterThan(0);
  });
});
