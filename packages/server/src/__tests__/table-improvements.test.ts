import { expect, it } from 'vitest';
import { boot, closeAll, createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';

it('keeps host-only game names across start and restart and makes every seat ready', async () => {
  const dataDir = makeDataDir();
  let server = await boot({ dataDir });
  const host = await createGame(server, 'Ada');
  const guest = await joinGame(server, host.code, 'Grace');
  try {
    const room = server.hub.roomByCode(host.code)!;
    expect(room.seats.every(s => s.ready)).toBe(true);
    guest.client.send({ t: 'setReady', ready: false });
    await guest.client.waitLobby(l => l.players.every(s => s.ready));
    guest.client.send({ t: 'setGameName', gameName: 'Not yours' });
    expect((await guest.client.wait('error')).code).toBe('notHost');
    host.client.send({ t: 'setGameName', gameName: 'Friday Power' });
    await guest.client.waitLobby(l => l.gameName === 'Friday Power');
    host.client.send({ t: 'startGame' });
    await host.client.wait('state');
    host.client.send({ t: 'setGameName', gameName: 'Saturday Power' });
    await guest.client.waitLobby(l => l.gameName === 'Saturday Power');
    await closeAll(host.client, guest.client);
    await server.close();
    server = await boot({ dataDir });
    expect(server.hub.roomByCode(host.code)?.gameName).toBe('Saturday Power');
  } finally {
    await closeAll(host.client, guest.client);
    await server.close();
    removeDataDir(dataDir);
  }
});
