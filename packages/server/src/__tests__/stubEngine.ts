/**
 * A deterministic, hermetic rules engine for the integration tests.
 *
 * The server under test must behave identically whatever engine is plugged in,
 * so the tests inject this instead of depending on the real (concurrently
 * authored) rules engine or on shared map data. It implements exactly enough
 * to exercise the transport contract: whose turn it is, what a legal move
 * looks like, and that state changes when a move is applied.
 */

import {
  emptyResources,
  type GameAction,
  type GameSettings,
  type GameState,
  type Player,
  type PlayerId,
  type ValidationResult,
} from '@pg/shared';
import type { EnginePlayerSeed, RulesEngine } from '../engine/types.js';

/** Face-down cards, so the redaction path in `GameRoom.stateFor` is exercised. */
const STACK = [20, 21, 22, 23, 24];

export const stubEngine: RulesEngine = {
  name: 'test-stub',

  createGame(settings: GameSettings, players: EnginePlayerSeed[], hostId: PlayerId, code: string): GameState {
    const order = players.map((p) => p.id); // deterministic: lobby order
    const playerRecords: Record<PlayerId, Player> = {};
    players.forEach((p, i) => {
      playerRecords[p.id] = {
        id: p.id,
        name: p.name,
        color: p.color,
        isTrust: false,
        isBot: p.isBot,
        money: 50,
        housesRemaining: 22,
        plants: [],
        cities: [],
        orderIndex: i,
        phaseStatus: 'eligible',
        hasNetwork: false,
        connected: false,
        lastSeen: 0,
      };
    });

    return {
      version: 1,
      gameId: 'stub',
      code,
      hostId,
      settings,
      phase: 'auction',
      setupStage: 'complete',
      step: 1,
      round: 1,
      zone: ['a1', 'a2', 'a3'],
      players: playerRecords,
      playerOrder: order,
      activePlayerId: order[0] ?? null,
      plantMarket: {
        current: [3, 4, 5, 6],
        future: [7, 8, 9, 10],
        stack: [...STACK],
        removed: [],
        discountPlantId: 3,
        discountReplacementRuleArmed: false,
        step3CardRevealed: false,
      },
      resourceMarket: { coal: [], oil: [], garbage: [], uranium: [] },
      supply: emptyResources(),
      usaCoalStorage: 0,
      citySlots: {},
      auction: null,
      pendingScrap: null,
      acquiredThisRound: [],
      passedThisPhase: [],
      uraniumPhaseOut: false,
      endGameTriggered: false,
      winnerId: null,
      rngCursor: 0,
      log: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
  },

  validateAction(state: GameState, playerId: PlayerId, action: GameAction): ValidationResult {
    if (!state.players[playerId]) return { ok: false, reason: 'You are not in this game.' };
    if (state.activePlayerId !== playerId) return { ok: false, reason: 'It is not your turn.' };
    switch (action.type) {
      case 'passNomination':
        return { ok: true };
      case 'nominatePlant':
        if (!state.plantMarket.current.includes(action.plantId)) {
          return { ok: false, reason: 'That plant is not in the current market.' };
        }
        if (action.bid < action.plantId) return { ok: false, reason: 'Bid below the minimum.' };
        if ((state.players[playerId]?.money ?? 0) < action.bid) {
          return { ok: false, reason: 'You cannot afford that bid.' };
        }
        return { ok: true };
      default:
        return { ok: false, reason: `Unsupported action '${action.type}'.` };
    }
  },

  applyAction(state: GameState, playerId: PlayerId, action: GameAction): GameState {
    const next = structuredClone(state);
    const player = next.players[playerId];
    if (!player) return next;

    if (action.type === 'nominatePlant') {
      player.money -= action.bid;
      player.plants.push({ plantId: action.plantId, stored: emptyResources() });
      next.plantMarket.current = next.plantMarket.current.filter((id) => id !== action.plantId);
      next.acquiredThisRound.push(playerId);
      player.phaseStatus = 'purchased';
    } else {
      player.phaseStatus = 'passed';
      next.passedThisPhase.push(playerId);
    }

    next.log.push({
      id: next.log.length + 1,
      round: next.round,
      phase: next.phase,
      step: next.step,
      category: 'auction',
      playerId,
      message: `${player.name}: ${action.type}`,
      at: 1_700_000_000_000 + next.log.length,
    });

    const idx = next.playerOrder.indexOf(playerId);
    const nextIdx = (idx + 1) % Math.max(1, next.playerOrder.length);
    if (nextIdx === 0) {
      next.round += 1;
      next.acquiredThisRound = [];
      next.passedThisPhase = [];
      for (const id of next.playerOrder) {
        const p = next.players[id];
        if (p) p.phaseStatus = 'eligible';
      }
    }
    next.activePlayerId = next.playerOrder[nextIdx] ?? null;
    // Deterministic: never `Date.now()`, so two runs produce identical states.
    next.updatedAt = state.updatedAt + 1;
    return next;
  },

  defaultActionFor(state: GameState, playerId: PlayerId): GameAction | null {
    return state.activePlayerId === playerId ? { type: 'passNomination' } : null;
  },
};
