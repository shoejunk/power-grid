import { describe, expect, it } from 'vitest';
import { fresh, start, survivorsOfPlayer } from './helpers.js';

describe('harness smoke', () => {
  it('creates a game blocked on setup choices', () => {
    const s = fresh({ playerCount: 4 });
    expect(s.phase).toBe('setup');
    expect(s.pendingChoices.length).toBeGreaterThan(0);
  });
  it('drives setup to player turns', () => {
    const s = start({ playerCount: 4 });
    expect(s.phase).toBe('playerTurns');
    expect(s.round).toBe(1);
    expect(survivorsOfPlayer(s, 'p1').length).toBe(2);
    expect(s.activePlayerId).toBeTruthy();
  });
});
