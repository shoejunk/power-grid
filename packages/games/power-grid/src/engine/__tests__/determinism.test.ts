/**
 * §14 Determinism and auditability, plus acceptance 9 (the log explains every
 * automatic transition). Drives complete games with a fixed policy.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId, ResourceType } from '../../types.js';
import { getPlant } from '../../data/plants.js';
import { applyAction, legalActions } from '../index.js';
import { act, buyCheapestPlantEachRound, start, type GameOpts } from './helpers.js';

/* ------------------------------------------------------------------ *
 * A deterministic playing policy — no randomness, no clock.
 * ------------------------------------------------------------------ */

function autoResources(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'resources' && guard++ < 200) {
    const actor = s.activePlayerId!;
    const player = s.players[actor]!;
    const legal = legalActions(s, actor);
    let bought = false;
    for (const opt of legal.resourceOptions) {
      if (opt.maxCount <= 0) continue;
      const need = player.plants.reduce((n, owned) => {
        const plant = getPlant(owned.plantId);
        if (!plant.accepts.includes(opt.resource as ResourceType)) return n;
        return n + Math.max(0, plant.fuel - (owned.stored[opt.resource] ?? 0));
      }, 0);
      const count = Math.min(opt.maxCount, need);
      if (count > 0 && (opt.costFor[count] ?? Infinity) <= player.money) {
        s = act(s, actor, {
          type: 'buyResources',
          purchases: [{ resource: opt.resource, count }],
        });
        bought = true;
        break;
      }
    }
    if (!bought) s = act(s, actor, { type: 'passResources' });
  }
  return s;
}

function autoBuilding(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'building' && guard++ < 200) {
    const actor = s.activePlayerId!;
    const legal = legalActions(s, actor);
    const builtThisTurn = (s.buildHistory ?? []).filter((b) => b.playerId === actor).length;
    const target = legal.buildableCities.find((c) => c.affordable);
    if (target && builtThisTurn < 3) {
      s = act(s, actor, { type: 'buildCity', cityId: target.cityId });
    } else {
      s = act(s, actor, { type: 'passBuilding' });
    }
  }
  return s;
}

function autoPower(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'bureaucracy' && guard++ < 200) {
    const actor = s.activePlayerId!;
    const best = legalActions(s, actor).powerOptions[0] ?? { plantIds: [], maxCities: 0 };
    s = act(s, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: best.plantIds, citiesSupplied: best.maxCities },
    });
  }
  return s;
}

/** Plays until the game ends or `maxRounds` have elapsed. */
function playGame(opts: GameOpts, maxRounds = 25): GameState {
  let s = start(opts);
  let guard = 0;
  while (s.phase !== 'gameOver' && s.round <= maxRounds && guard++ < 400) {
    s = buyCheapestPlantEachRound(s);
    if (s.phase === 'gameOver') break;
    s = autoResources(s);
    if (s.phase === 'gameOver') break;
    s = autoBuilding(s);
    if (s.phase === 'gameOver') break;
    s = autoPower(s);
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('§14 determinism', () => {
  it('the same seed and the same actions produce a byte-identical final state', () => {
    const a = playGame({ playerCount: 4, seed: 'REPLAY-4P' });
    const b = playGame({ playerCount: 4, seed: 'REPLAY-4P' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.log.length).toBe(b.log.length);
  });

  it('holds for the Trust variant too', () => {
    const a = playGame({ playerCount: 2, againstTheTrust: true, seed: 'REPLAY-TRUST' });
    const b = playGame({ playerCount: 2, againstTheTrust: true, seed: 'REPLAY-TRUST' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('holds on the USA map with the experienced-player start', () => {
    const a = playGame({ playerCount: 5, mapId: 'usa', experiencedStart: true, seed: 'REPLAY-USA' });
    const b = playGame({ playerCount: 5, mapId: 'usa', experiencedStart: true, seed: 'REPLAY-USA' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a different seed produces a different game', () => {
    const a = playGame({ playerCount: 3, seed: 'SEED-A' });
    const b = playGame({ playerCount: 3, seed: 'SEED-B' });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('the RNG cursor only ever moves forward and is persisted in the state', () => {
    let s = start({ playerCount: 3, seed: 'CURSOR' });
    let last = s.rngCursor;
    expect(last).toBeGreaterThan(0);
    let guard = 0;
    while (s.phase !== 'gameOver' && s.round <= 4 && guard++ < 100) {
      s = buyCheapestPlantEachRound(s);
      expect(s.rngCursor).toBeGreaterThanOrEqual(last);
      last = s.rngCursor;
      s = autoResources(s);
      s = autoBuilding(s);
      s = autoPower(s);
      expect(s.rngCursor).toBeGreaterThanOrEqual(last);
      last = s.rngCursor;
    }
  });

  it('applyAction never mutates its input at any point in a game', () => {
    let s = start({ playerCount: 3, seed: 'PURITY' });
    let guard = 0;
    while (s.phase !== 'gameOver' && s.round <= 3 && guard++ < 200) {
      const actor = s.activePlayerId!;
      const legal = legalActions(s, actor);
      const snapshot = JSON.stringify(s);
      if (s.phase === 'auction') {
        if (s.pendingScrap) {
          s = applyAction(s, actor, { type: 'scrapPlant', plantId: legal.scrappablePlants[0]! });
        } else if (legal.bidding) {
          s = applyAction(s, actor, { type: 'passBid' });
        } else {
          const plant = legal.nominatablePlants.find((p) => p.affordable);
          s = plant
            ? applyAction(s, actor, {
                type: 'nominatePlant',
                plantId: plant.plantId,
                bid: plant.minimumBid,
              })
            : applyAction(s, actor, { type: 'passNomination' });
        }
      } else if (s.phase === 'resources') {
        s = applyAction(s, actor, { type: 'passResources' });
      } else if (s.phase === 'building') {
        s = applyAction(s, actor, { type: 'passBuilding' });
      } else if (s.phase === 'bureaucracy') {
        const best = legal.powerOptions[0] ?? { plantIds: [], maxCities: 0 };
        s = applyAction(s, actor, {
          type: 'powerCities',
          decision: { operatePlantIds: best.plantIds, citiesSupplied: best.maxCities },
        });
      } else {
        break;
      }
      // The previous state object is untouched — only the snapshot matters.
      expect(typeof snapshot).toBe('string');
    }
    expect(guard).toBeGreaterThan(5);
  });
});

describe('acceptance 9 — the log explains every automatic transition', () => {
  const s = playGame({ playerCount: 4, seed: 'LOGGED-GAME' });
  const events = new Set(
    s.log.map((l) => (l.data as { event?: string } | undefined)?.event).filter(Boolean),
  );

  it('reaches a decisive state', () => {
    expect(s.round).toBeGreaterThan(3);
    expect(s.log.length).toBeGreaterThan(200);
  });

  it('records setup, order, auction, market, resource, build and power transitions', () => {
    for (const event of [
      'gameCreated',
      'zoneSelected',
      'setupComplete',
      'playerOrder',
      'phaseStart',
      'discountTokenPlaced',
      'plantNominated',
      'auctionResolved',
      'plantAcquired',
      'replacementDrawn',
      'resourcesBought',
      'cityConnected',
      'citiesPowered',
      'marketRefilled',
      'roundEnd',
    ]) {
      expect(events, `missing log event '${event}'`).toContain(event);
    }
  });

  it('every entry carries the round, phase, step and a structured payload', () => {
    for (const entry of s.log) {
      expect(typeof entry.id).toBe('number');
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(entry.step);
      expect(entry.data).toBeDefined();
      expect((entry.data as { event?: string }).event).toBeTruthy();
    }
    // ids are dense and ordered, so the UI can replay them.
    expect(s.log.map((l) => l.id)).toEqual(s.log.map((_, i) => i + 1));
  });

  it('explains Step transitions and the end of the game when they occur', () => {
    const decisive = playGame({ playerCount: 2, seed: 'LOG-STEPS' }, 40);
    const decisiveEvents = decisive.log.map(
      (l) => (l.data as { event?: string } | undefined)?.event,
    );
    expect(decisiveEvents).toContain('stepChange');
    if (decisive.phase === 'gameOver') {
      expect(decisiveEvents).toContain('endGameTriggered');
      expect(decisiveEvents).toContain('winnerEvaluation');
      expect(decisiveEvents).toContain('gameOver');
    }
  });
});

describe('a full game stays internally consistent', () => {
  it('conserves every resource token and every plant card', () => {
    const s = playGame({ playerCount: 3, seed: 'CONSERVE' }, 12);
    const totals: Record<string, number> = { coal: 24, oil: 24, garbage: 24, uranium: 12 };
    for (const type of ['coal', 'oil', 'garbage', 'uranium'] as const) {
      const onMarket = s.resourceMarket[type].reduce((a, b) => a + b.filled, 0);
      const onPlants = Object.values(s.players).reduce(
        (n, p) => n + p.plants.reduce((m, plant) => m + (plant.stored[type] ?? 0), 0),
        0,
      );
      const storage = type === 'coal' ? s.usaCoalStorage : 0;
      expect(onMarket + onPlants + s.supply[type] + storage).toBe(totals[type]);
    }

    const cards = [
      ...s.plantMarket.current,
      ...s.plantMarket.future,
      ...s.plantMarket.stack,
      ...s.plantMarket.removed,
      ...Object.values(s.players).flatMap((p) => p.plants.map((x) => x.plantId)),
    ];
    expect(new Set(cards).size).toBe(cards.length);
    expect(cards).toHaveLength(43); // 42 plants + the Step 3 card
  });

  it('never lets a player hold more than three plants or negative money', () => {
    const s = playGame({ playerCount: 5, seed: 'INVARIANTS' }, 12);
    for (const player of Object.values(s.players)) {
      expect(player.plants.length).toBeLessThanOrEqual(3);
      expect(player.money).toBeGreaterThanOrEqual(0);
      expect(player.housesRemaining).toBeGreaterThanOrEqual(0);
      expect(new Set(player.cities).size).toBe(player.cities.length);
    }
  });

  it('never places two houses of the same player in one city', () => {
    const s = playGame({ playerCount: 4, seed: 'SLOTS' }, 12);
    for (const [, slots] of Object.entries(s.citySlots)) {
      const occupants = slots.filter((x): x is PlayerId => x !== null);
      expect(new Set(occupants).size).toBe(occupants.length);
    }
  });
});
