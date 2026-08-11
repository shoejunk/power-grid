/**
 * A realistic mid-game state for the board preview harness.
 *
 * Built with the *real* engine (`createGame` + `applyAction`) so the layout,
 * zone and slot data are exactly what the server would produce, then fast
 * forwarded into Phase 4 by writing the fields a completed auction/resource
 * round would have written. Only the harness does this — the shipped board
 * never mutates state.
 */

import {
  applyAction,
  createGame,
  type CityId,
  type GameSettings,
  type GameState,
  type PlayerId,
} from '@game/power-grid';

const SETTINGS: GameSettings = {
  mapId: 'germany',
  playerCount: 5,
  experiencedStart: false,
  againstTheTrust: false,
  seed: 'board-preview-01',
};

const SEATS = [
  { id: 'p1', name: 'Ada' },
  { id: 'p2', name: 'Brunel' },
  { id: 'p3', name: 'Curie' },
  { id: 'p4', name: 'Diesel' },
  { id: 'p5', name: 'Edison' },
] as const;

/** Five contiguous Germany areas — the sixth is deliberately out of play (§1). */
const ZONE = ['north', 'west', 'southwest', 'east', 'south'];

function place(state: GameState, playerId: PlayerId, cityId: CityId, slot: number): void {
  const slots = state.citySlots[cityId];
  const player = state.players[playerId];
  if (!slots || !player || slots[slot]) return;
  slots[slot] = playerId;
  player.cities.push(cityId);
  player.housesRemaining -= 1;
  player.hasNetwork = true;
}

export function previewState(): GameState {
  // `createGame` already hands back `setupStage: 'zoneSelection'`.
  let state = createGame(SETTINGS, SEATS, 'p1', 'PRVW', { now: 0, gameId: 'preview' });
  state = applyAction(state, 'p1', { type: 'selectZone', areas: ZONE }, 2);

  // Fast-forward to Phase 4 of round 4, mid Step 2.
  state.phase = 'building';
  state.step = 2;
  state.round = 4;
  state.step2Triggered = true;
  state.buildHistory = [];
  state.activePlayerId = 'p1';
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (p) p.phaseStatus = id === 'p1' ? 'acting' : 'acted';
  }

  place(state, 'p2', 'essen', 0);
  place(state, 'p2', 'dortmund', 0);
  place(state, 'p2', 'koeln', 0);
  place(state, 'p2', 'kassel', 1);

  place(state, 'p3', 'muenchen', 0);
  place(state, 'p3', 'augsburg', 0);
  place(state, 'p3', 'nuernberg', 0);
  place(state, 'p3', 'stuttgart', 1);

  place(state, 'p4', 'hamburg', 0);
  place(state, 'p4', 'bremen', 0);
  place(state, 'p4', 'hannover', 0);
  place(state, 'p4', 'kiel', 1);

  place(state, 'p5', 'frankfurt-m', 0);
  place(state, 'p5', 'wiesbaden', 0);
  place(state, 'p5', 'mannheim', 1);

  place(state, 'p1', 'leipzig', 0);
  place(state, 'p1', 'halle', 0);
  place(state, 'p1', 'erfurt', 0);
  place(state, 'p1', 'dresden', 1);

  const me = state.players['p1'];
  if (me) me.money = 68;

  return state;
}

export const PREVIEW_PLAYER_ID: PlayerId = 'p1';
