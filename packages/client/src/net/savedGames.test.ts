import { afterEach, expect, it, vi } from 'vitest';
import { net, useGameStore } from './store';

const initial = useGameStore.getState();
afterEach(() => {
  useGameStore.setState(initial);
  vi.unstubAllGlobals();
});

it('refreshes anonymous turn badges in both directions without changing saved order', async () => {
  useGameStore.setState({ anonymousGames: [{
    gameId: 'game', gameKey: 'stub', code: 'ABC123', started: true,
    playerName: 'Ada', updatedAt: 10, sessionToken: 'secret',
  }] });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ gameName: 'Table', started: true, isYourTurn: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ gameName: 'Table', started: true, isYourTurn: false }) });
  vi.stubGlobal('fetch', fetchMock);
  const signal = new AbortController().signal;
  await net.refreshSavedGames(signal);
  expect(useGameStore.getState().anonymousGames[0]).toMatchObject({ isYourTurn: true, updatedAt: 10 });
  expect(fetchMock).toHaveBeenCalledWith('/api/games/code/ABC123', expect.objectContaining({
    headers: { Authorization: 'Bearer secret' }, cache: 'no-store', signal,
  }));
  await net.refreshSavedGames(signal);
  expect(useGameStore.getState().anonymousGames[0]?.isYourTurn).toBe(false);
});

it('refreshes account games quietly and ignores a response after leaving the list', async () => {
  const account = { id: 'account', name: 'Ada', email: '' };
  useGameStore.setState({ auth: { ...initial.auth, account, loading: false } });
  const games = [{ gameId: 'game', isYourTurn: true }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account, games }) }));
  await net.refreshSavedGames(new AbortController().signal);
  expect(useGameStore.getState().auth).toMatchObject({ games, loading: false });
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    controller.abort();
    return { ok: true, json: async () => ({ account, games: [] }) };
  }));
  await net.refreshSavedGames(controller.signal);
  expect(useGameStore.getState().auth.games).toEqual(games);
});
