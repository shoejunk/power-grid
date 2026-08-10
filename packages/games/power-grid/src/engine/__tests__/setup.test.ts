/** §2 Setup, §1 game model, acceptance criterion 1. */

import { describe, expect, it } from 'vitest';
import { PLUG_PLANT_IDS, SETUP_REMOVALS, SOCKET_PLANT_IDS } from '../../data/plants.js';
import { MARKET_LAYOUT, ZONE_AREA_COUNT } from '../../data/tables.js';
import { RESOURCE_TYPES, STEP3_PLANT_ID } from '../../types.js';
import { getMap } from '../../data/maps/index.js';
import { isZoneContiguous } from '../../data/maps/index.js';
import { act, fresh, start } from './helpers.js';
import { validateAction } from '../index.js';

const MAPS = ['germany', 'usa'] as const;
const COUNTS = [2, 3, 4, 5, 6] as const;

describe('§2 setup — acceptance 1: every player count on either map', () => {
  for (const mapId of MAPS) {
    for (const playerCount of COUNTS) {
      it(`${mapId} / ${playerCount} players sets up legally`, () => {
        const s = start({ mapId, playerCount, seed: `S-${mapId}-${playerCount}` });

        expect(s.phase).toBe('auction');
        expect(s.round).toBe(1);
        expect(s.step).toBe(1);
        expect(Object.keys(s.players)).toHaveLength(playerCount);
        expect(s.playerOrder).toHaveLength(playerCount);

        // 2. 22 houses and 50 Elektro each.
        for (const p of Object.values(s.players)) {
          expect(p.money).toBe(50);
          expect(p.housesRemaining).toBe(22);
          expect(p.cities).toEqual([]);
          expect(p.plants).toEqual([]);
        }

        // Zone size and contiguity.
        const map = getMap(mapId);
        expect(s.zone).toHaveLength(ZONE_AREA_COUNT[playerCount]!);
        expect(isZoneContiguous(map, s.zone)).toBe(true);

        // 8. Opening market: 8 plug plants, four lowest current.
        const opening = [...s.plantMarket.current, ...s.plantMarket.future];
        expect(opening).toHaveLength(8);
        expect(opening.every((id) => PLUG_PLANT_IDS.includes(id))).toBe(true);
        expect([...opening].sort((a, b) => a - b)).toEqual(opening);
        expect(s.plantMarket.current).toEqual(opening.slice(0, 4));
        expect(s.plantMarket.future).toEqual(opening.slice(4));

        // 9. Exact setup removals.
        const removals = SETUP_REMOVALS[playerCount]!;
        const removedPlugs = s.plantMarket.removed.filter((id) => PLUG_PLANT_IDS.includes(id));
        const removedSockets = s.plantMarket.removed.filter((id) => SOCKET_PLANT_IDS.includes(id));
        expect(removedPlugs).toHaveLength(removals.plug);
        expect(removedSockets).toHaveLength(removals.socket);

        // Every card is accounted for exactly once.
        const all = [
          ...s.plantMarket.current,
          ...s.plantMarket.future,
          ...s.plantMarket.stack,
          ...s.plantMarket.removed,
        ];
        expect(new Set(all).size).toBe(all.length);
        expect(all).toHaveLength(PLUG_PLANT_IDS.length + SOCKET_PLANT_IDS.length + 1);

        // Step 3 card is at the bottom, and a plug-backed card sits on top.
        expect(s.plantMarket.stack[s.plantMarket.stack.length - 1]).toBe(STEP3_PLANT_ID);
        expect(PLUG_PLANT_IDS).toContain(s.plantMarket.stack[0]!);
        expect(s.plantMarket.step3CardRevealed).toBe(false);
      });
    }
  }
});

describe('§1 resource market at setup', () => {
  it('fills the printed starting spaces and puts the rest in the supply', () => {
    const s = start({ playerCount: 4 });
    for (const type of RESOURCE_TYPES) {
      const layout = MARKET_LAYOUT[type];
      const spaces = s.resourceMarket[type];
      expect(spaces.map((x) => x.price)).toEqual(layout.prices);
      for (const space of spaces) {
        const shouldBeFull = layout.initiallyOccupiedPrices.includes(space.price);
        expect(space.filled).toBe(shouldBeFull ? layout.capacityPerSpace : 0);
      }
      const onMarket = spaces.reduce((a, b) => a + b.filled, 0);
      expect(onMarket + s.supply[type]).toBe(layout.totalTokens);
    }
    // Coal 1-8, oil 3-8, garbage 6-8, uranium 14-16.
    expect(s.supply.coal).toBe(0);
    expect(s.supply.oil).toBe(6);
    expect(s.supply.garbage).toBe(15);
    expect(s.supply.uranium).toBe(10);
  });

  it('§2.6 USA starts with an empty separate coal storage area', () => {
    const s = start({ mapId: 'usa', playerCount: 3 });
    expect(s.usaCoalStorage).toBe(0);
    const onMarket = s.resourceMarket.coal.reduce((a, b) => a + b.filled, 0);
    expect(onMarket).toBe(24);
  });
});

describe('zone selection', () => {
  it('rejects a non-contiguous zone', () => {
    const s = fresh({ playerCount: 3 });
    const verdict = validateAction(s, s.hostId, {
      type: 'selectZone',
      areas: ['north', 'south', 'southwest'],
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects the wrong number of areas', () => {
    const s = fresh({ playerCount: 3 });
    expect(validateAction(s, s.hostId, { type: 'selectZone', areas: ['north', 'east'] }).ok).toBe(
      false,
    );
  });

  it('rejects a non-host', () => {
    const s = fresh({ playerCount: 3 });
    expect(validateAction(s, 'p2', { type: 'selectZone', areas: [] }).ok).toBe(false);
  });

  it('accepts an explicit contiguous zone', () => {
    let s = fresh({ playerCount: 3 });
    s = act(s, s.hostId, { type: 'selectZone', areas: ['north', 'northeast', 'east'] });
    expect(s.zone).toEqual(['north', 'northeast', 'east']);
    expect(s.phase).toBe('auction');
  });
});

describe('§2 optional experienced-player starting cities', () => {
  it('marks one city per player, in player order', () => {
    const s = start({ playerCount: 3, experiencedStart: true });
    const marked = s.playerOrder.map((id) => s.players[id]!.markedStartCity);
    expect(marked.every((c) => typeof c === 'string')).toBe(true);
    expect(new Set(marked).size).toBe(3);
  });

  it('does not ask for starting cities when the option is off', () => {
    const s = start({ playerCount: 3, experiencedStart: false });
    for (const p of Object.values(s.players)) expect(p.markedStartCity).toBeUndefined();
  });
});

describe('determinism of setup (§14)', () => {
  it('the same seed produces byte-identical setup', () => {
    const a = start({ playerCount: 4, seed: 'REPLAY-ME' });
    const b = start({ playerCount: 4, seed: 'REPLAY-ME' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different setups', () => {
    const a = start({ playerCount: 4, seed: 'AAA' });
    const b = start({ playerCount: 4, seed: 'BBB' });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('createGame does not consult the clock', () => {
    const a = fresh({ seed: 'X' });
    const b = fresh({ seed: 'X' });
    expect(a.createdAt).toBe(b.createdAt);
    expect(a.rngCursor).toBe(b.rngCursor);
  });
});
