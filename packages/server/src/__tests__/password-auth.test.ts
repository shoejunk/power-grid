import { scryptSync } from 'node:crypto';
import { MemoryGameStore } from '../persistence/memoryStore.js';
import { afterEach, expect, it } from 'vitest';
import { boot, makeDataDir, removeDataDir, createGame } from './helpers.js';
import { TestClient } from './testClient.js';
const servers: Awaited<ReturnType<typeof boot>>[] = [];
const dirs: string[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); for (const dir of dirs.splice(0)) removeDataDir(dir); });
const post = (url: string, body: unknown, cookie = '') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
it('registers without Google, links a local seat, and resumes after restart with a fresh login', async () => {
  const dataDir = makeDataDir(); dirs.push(dataDir);
  const server = await boot({ dataDir }); servers.push(server);
  const local = await createGame(server, 'Host', { tableSize: 2 });
  local.client.send({ t: 'addBot' });
  await local.client.wait('lobby');
  local.client.send({ t: 'startGame' });
  const originalState = await local.client.wait('state');
  const credentials = { username: 'CloudPlayer', password: 'Seven12!' };
  const registration = await post(`${server.url}/auth/register`, credentials);
  expect(registration.status).toBe(200);
  const cookie = registration.headers.get('set-cookie')!.split(';')[0]!;
  expect(registration.headers.get('set-cookie')).toContain('HttpOnly');
  const linked = await post(`${server.url}/api/auth/link-games`, { tokens: [local.sessionToken] }, cookie);
  expect(await linked.json()).toEqual({ linked: [local.sessionToken] });
  const account = server.store.loadAccounts()[0]!;
  expect(account.passwordHash).toBeTruthy();
  expect(account.passwordHash).not.toContain(credentials.password);
  const anonymous = await TestClient.connect(server.wsUrl);
  anonymous.send({ t: 'rejoin', sessionToken: local.sessionToken });
  expect((await anonymous.wait('error')).code).toBe('unknownSession');
  await anonymous.close(); await local.client.close(); await server.close();
  const restarted = await boot({ dataDir }); servers.push(restarted);
  const wrong = await post(`${restarted.url}/auth/login`, { ...credentials, password: 'incorrect password value' });
  expect(wrong.status).toBe(401);
  const login = await post(`${restarted.url}/auth/login`, { ...credentials, username: 'cloudplayer' });
  expect(login.status).toBe(200);
  const freshCookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const me = await fetch(`${restarted.url}/api/auth/me`, { headers: { Cookie: freshCookie } });
  const status = await me.json();
  expect(status.games).toHaveLength(1);
  expect(status.account.passwordHash).toBeUndefined();
  const otherMachine = await TestClient.connect(restarted.wsUrl, { headers: { Cookie: freshCookie } });
  otherMachine.send({ t: 'resumeGame', gameId: local.lobby.gameId });
  expect((await otherMachine.wait('welcome')).playerId).toBe(local.playerId);
  const resumedState = (await otherMachine.wait('state')).state;
  // Presence timestamps change on reconnect; gameplay state must not.
  const gameplay = (state: unknown) => JSON.parse(JSON.stringify(state, (key, value) => key === 'lastSeen' ? undefined : value));
  expect(gameplay(resumedState)).toEqual(gameplay(originalState.state));
  await otherMachine.close();
  const other = await post(`${restarted.url}/auth/register`, { username: 'otheruser', password: credentials.password });
  const otherCookie = other.headers.get('set-cookie')!.split(';')[0]!;
  expect(await (await post(`${restarted.url}/api/auth/link-games`, { tokens: [local.sessionToken] }, otherCookie)).json()).toEqual({ linked: [] });
  expect((await post(`${restarted.url}/auth/register`, credentials)).status).toBe(409);
  expect((await fetch(`${restarted.url}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.invalid', Cookie: freshCookie }, body: '{}' })).status).toBe(403);
  expect((await post(`${restarted.url}/auth/logout`, {}, freshCookie)).status).toBe(200);
  expect((await (await fetch(`${restarted.url}/api/auth/me`, { headers: { Cookie: freshCookie } })).json()).authenticated).toBe(false);
});

it('rejects new passwords missing a required component', async () => {
  const dataDir = makeDataDir(); dirs.push(dataDir);
  const server = await boot({ dataDir }); servers.push(server);
  for (const password of ['Short1!', 'NoNumbers!', 'Numbers123', 'Spaces12 ', 'Letters12é']) {
    const response = await post(`${server.url}/auth/register`, { username: 'policytest', password });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('one special character');
  }
  expect(server.store.loadAccounts()).toHaveLength(0);
});

it('still accepts an existing password without a number or special character', async () => {
  const store = new MemoryGameStore();
  const password = 'previous long passphrase';
  const salt = 'legacy-test-salt';
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex');
  store.saveAccount({ accountId: 'legacy', username: 'legacyuser', name: 'Legacy', email: '', passwordHash: `${salt}:${hash}`, createdAt: 1, lastSeen: 1 });
  const server = await boot({ store }); servers.push(server);
  expect((await post(`${server.url}/auth/login`, { username: 'legacyuser', password })).status).toBe(200);
});
