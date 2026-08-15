import { describe, expect, it } from 'vitest';

import { start, PACK } from './helpers.js';
import { turnOrder } from '../index.js';

describe('probe', () => {
  it('probe', () => {
    const s = start({ playerCount: 4, settings: { mainObjectiveId: 'mo-stockpile' } });
    console.log('seating', s.seating);
    console.log('firstPlayer', s.firstPlayerId);
    console.log('turnOrder', turnOrder(s));
    console.log('turn', s.turn);
    console.log('pending', s.pendingChoices.map((c) => [c.kind, c.playerId]));
    console.log('morale', s.colony.morale, 'food', s.colony.food, 'rounds', s.rounds);
    console.log('survivorSpaces', s.colony.survivorSpaces, 'helpless', s.colony.helpless);
    console.log('crossroads deck len', s.decks.crossroads.length);
    console.log('hands', s.seating.map((id) => s.players[id]!.hand.length));
    console.log('pack colony', PACK.pack.colony);
    expect(true).toBe(true);
  });
});
