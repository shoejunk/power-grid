import { expect, it, vi } from 'vitest';
import { jevChoices, jevContext } from '../jev.js';
import { applyAction, validateAction } from '../index.js';
import { start } from './helpers.js';
import * as autoplay from '../autoplay.js';
import { buildTargets } from '../building.js';
import { endGameThreshold } from '../endgame.js';
import { PAYMENT_TABLE } from '../constants.js';

it('offers only legal bounded choices throughout a complete game, without private context', () => {
  let state = start({ playerCount: 2, seed: 'jev-choices' });
  const localBot = vi.spyOn(autoplay, 'defaultActionFor');
  let turns = 0;
  while (state.phase !== 'gameOver' && turns++ < 1500) {
    const actor = state.activePlayerId!;
    localBot.mockClear();
    const choices = jevChoices(state, actor);
    expect(localBot).not.toHaveBeenCalled();
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.length).toBeLessThanOrEqual(255);
    for (const action of choices) expect(validateAction(state, actor, action).ok).toBe(true);
    const context = JSON.stringify(jevContext(state, actor));
    expect(context).not.toContain('"commitments"');
    expect(context).not.toContain('rngCursor');
    expect(context).not.toContain('jev-choices');
    // Drive the fixture independently; choosing menu index zero is not a strategy.
    state = applyAction(state, actor, autoplay.defaultActionFor(state, actor)!, turns);
  }
  expect(state.phase).toBe('gameOver');
  localBot.mockRestore();
});

it('provides expansion and income facts during auctions without leaking hidden state', () => {
  const state = start({ playerCount: 2, seed: 'private-seed', experiencedStart: true });
  const actor = state.activePlayerId!;
  state.players[actor]!.name = 'private-name';
  const before = JSON.stringify(state);
  const context = jevContext(state, actor);
  expect(context.expansion.targets).toEqual(buildTargets(state, actor));
  expect(context.expansion.targets.length).toBeGreaterThan(0);
  expect(context.tables.incomeByCitiesSupplied).toEqual(PAYMENT_TABLE);
  expect(context.tables.endGameCityThreshold).toBe(endGameThreshold(state));
  expect(context.settings.experiencedStart).toBe(true);
  expect(context.players.find(p => p.id === actor)!.markedStartCity).toBeDefined();
  expect(context.rules.combinedTurnHouseRule).toContain('ALL players');
  expect(context.rules.sealedAuctionHouseRule).toContain('current price + 1');
  expect(JSON.stringify(context)).not.toMatch(/private-seed|private-name|"stack"|"removed"|"commitments"|rngCursor/);
  expect(JSON.stringify(state)).toBe(before);
});

it('offers low and high resource baskets, passing, and partial production without a preferred move', () => {
  const state = start({ playerCount: 2 });
  const actor = state.activePlayerId!;
  const player = state.players[actor]!;
  player.plants = [{ plantId: 4, stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 } }];
  player.money = 100;
  state.phase = 'resources';
  player.phaseStatus = 'acting';
  const choices = jevChoices(state, actor);
  expect(choices).toContainEqual({ type: 'passResources' });
  for (const count of [1, 4]) expect(choices).toContainEqual({ type: 'buyResourcesAndFinish', purchases: [{ resource: 'coal', count }] });
  state.phase = 'building';
  player.phaseStatus = 'passed';
  player.cities = ['test-a', 'test-b'];
  player.plants[0]!.stored.coal = 2;
  const production = jevChoices(state, actor);
  for (const citiesSupplied of [0, 1]) expect(production).toContainEqual({ type: 'powerCities', decision: { operatePlantIds: [4], citiesSupplied } });
  for (const action of production) expect(validateAction(state, actor, action).ok).toBe(true);
});
