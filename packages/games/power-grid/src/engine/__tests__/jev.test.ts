import { expect, it } from 'vitest';
import { jevChoices, jevContext } from '../jev.js';
import { applyAction, validateAction } from '../index.js';
import { start } from './helpers.js';

it('offers only legal bounded choices throughout a complete game, without private context', () => {
  let state = start({ playerCount: 2, seed: 'jev-choices' });
  let turns = 0;
  while (state.phase !== 'gameOver' && turns++ < 1500) {
    const actor = state.activePlayerId!;
    const choices = jevChoices(state, actor);
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.length).toBeLessThanOrEqual(255);
    for (const action of choices) expect(validateAction(state, actor, action).ok).toBe(true);
    const context = JSON.stringify(jevContext(state, actor));
    expect(context).not.toContain('commitments');
    expect(context).not.toContain('rngCursor');
    expect(context).not.toContain('jev-choices');
    state = applyAction(state, actor, choices[0]!, turns);
  }
  expect(state.phase).toBe('gameOver');
});
