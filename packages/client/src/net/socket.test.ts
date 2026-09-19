import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAnonymousGames,
  sessionTokenForInvite,
  markAnonymousGameStartedByToken,
  removeAnonymousGameById,
  removeAnonymousGameByToken,
  upsertAnonymousGame,
  writeStored,
  type AnonymousGame,
} from './socket';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const game = (overrides: Partial<AnonymousGame> = {}): AnonymousGame => ({
  gameId: 'game-a',
  gameKey: 'power-grid',
  code: 'ABC234',
  started: true,
  updatedAt: 100,
  playerName: 'Ada',
  sessionToken: 'token-a',
  ...overrides,
});

describe('anonymous game storage', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an invite never resumes an unrelated legacy seat', () => {
    writeStored('tt.sessionToken', 'other-game');
    upsertAnonymousGame(game());
    expect(sessionTokenForInvite('ABC234')).toBe('token-a');
    expect(sessionTokenForInvite('NEW234')).toBeNull();
    expect(sessionTokenForInvite()).toBe('other-game');
  });

  it('keeps multiple games newest-first and replaces matching game ids', () => {
    upsertAnonymousGame(game());
    upsertAnonymousGame(game({
      gameId: 'game-b',
      gameKey: 'dead-of-winter',
      code: 'WIN234',
      updatedAt: 200,
      sessionToken: 'token-b',
    }));
    upsertAnonymousGame(game({ updatedAt: 300, playerName: 'Ada Updated' }));

    expect(loadAnonymousGames()).toEqual([
      game({ updatedAt: 300, playerName: 'Ada Updated' }),
      game({
        gameId: 'game-b',
        gameKey: 'dead-of-winter',
        code: 'WIN234',
        updatedAt: 200,
        sessionToken: 'token-b',
      }),
    ]);
  });

  it('removes stale seats by token or game id and ignores corrupt storage', () => {
    upsertAnonymousGame(game());
    upsertAnonymousGame(game({ gameId: 'game-b', sessionToken: 'token-b' }));

    expect(removeAnonymousGameByToken('token-a').map((entry) => entry.gameId)).toEqual(['game-b']);
    expect(markAnonymousGameStartedByToken('token-b')[0]?.started).toBe(true);
    expect(removeAnonymousGameById('game-b')).toEqual([]);

    writeStored('tt.anonymousGames', '{not-json');
    expect(loadAnonymousGames()).toEqual([]);
  });
});
