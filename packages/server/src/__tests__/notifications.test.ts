import { afterEach, describe, expect, it } from 'vitest';
import { GoogleAuth } from '../auth.js';
import { loadConfig } from '../config.js';
import { silentLogger } from '../logger.js';
import { TurnNotifications } from '../notifications.js';
import { MemoryGameStore } from '../persistence/memoryStore.js';
import { SqliteGameStore } from '../persistence/sqliteStore.js';
import type { AccountRecord, GameStore, SessionRecord } from '../persistence/types.js';

const baseAccount: AccountRecord = {
  accountId: 'account:ada',
  email: '',
  emailVerified: false,
  emailTurnAlerts: false,
  name: 'Ada',
  createdAt: 1,
  lastSeen: 1,
};

const baseSession: SessionRecord = {
  token: 'seat-token-for-ada',
  gameId: 'game-1',
  playerId: 'player-ada',
  accountId: baseAccount.accountId,
  createdAt: 1,
  lastSeen: 1,
};

function makeConfig() {
  return {
    ...loadConfig({ NODE_ENV: 'test' }),
    vapidPublicKey: 'test-public-key',
    vapidPrivateKey: 'test-private-key',
    vapidSubject: 'mailto:test@example.invalid',
    smtpUrl: 'smtp://test.invalid',
    emailFrom: 'TableTop <alerts@example.invalid>',
  };
}

function makeService(
  store: GameStore,
  sent: { push: Array<{ subscription: unknown; payload: string }>; email: Array<{ to: string; text: string }> },
) {
  const config = makeConfig();
  const auth = new GoogleAuth({ config, store, logger: silentLogger });
  auth.load();
  return {
    auth,
    service: new TurnNotifications({ config, store, auth, logger: silentLogger }, {
      sendPush: async (subscription, payload) => { sent.push.push({ subscription, payload }); },
      sendEmail: async (message) => { sent.email.push({ to: message.to, text: message.text }); },
    }),
  };
}

const event = {
  gameId: 'game-1',
  gameKey: 'power-grid',
  gameName: 'Power Grid',
  code: 'ABCDEF',
  playerId: 'player-ada',
};

describe('turn notifications', () => {
  const stores: GameStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('persists notification settings and browser subscriptions through SQLite', () => {
    const store = new SqliteGameStore(':memory:');
    stores.push(store);
    const account: AccountRecord = {
      ...baseAccount,
      emailVerified: true,
      notificationEmail: 'ada@example.com',
      notificationEmailVerified: true,
      emailTurnAlerts: true,
    };
    store.saveAccount(account);
    store.savePushSubscription({
      subscriptionId: 'subscription-ada',
      endpoint: 'https://push.example.test/sub/ada',
      p256dh: 'public-encryption-key',
      auth: 'auth-secret',
      accountId: account.accountId,
      createdAt: 3,
      lastSeen: 4,
    });

    expect(store.loadAccounts()).toContainEqual(account);
    expect(store.loadPushSubscriptions()).toHaveLength(1);
    store.deletePushSubscription('subscription-ada');
    expect(store.loadPushSubscriptions()).toEqual([]);
  });

  it('sends push only to the subscribed account when its turn begins', async () => {
    const store = new MemoryGameStore();
    stores.push(store);
    store.saveAccount(baseAccount);
    store.saveSession(baseSession);
    const sent = { push: [] as Array<{ subscription: unknown; payload: string }>, email: [] as Array<{ to: string; text: string }> };
    const { service } = makeService(store, sent);
    service.savePushSubscription(baseAccount.accountId, null, {
      endpoint: 'https://push.example.test/sub/ada',
      keys: { p256dh: 'A'.repeat(32), auth: 'B'.repeat(16) },
    });

    await service.turnBegan(event);

    expect(sent.push).toHaveLength(1);
    expect(sent.push[0]?.payload).toContain("It's your turn");
    expect(sent.push[0]?.payload).toContain('ABCDEF');
    expect(sent.email).toEqual([]);
  });

  it('verifies a newly collected email before sending turn alerts', async () => {
    const store = new MemoryGameStore();
    stores.push(store);
    store.saveAccount(baseAccount);
    store.saveSession(baseSession);
    const sent = { push: [] as Array<{ subscription: unknown; payload: string }>, email: [] as Array<{ to: string; text: string }> };
    const { auth, service } = makeService(store, sent);

    const pending = await service.updateEmailAlerts(baseAccount.accountId, 'ada@example.com', true);
    expect(pending).toMatchObject({ verified: false, pendingEmail: 'ada@example.com' });
    await service.turnBegan(event);
    expect(sent.email).toHaveLength(1); // the verification code only

    const code = sent.email[0]!.text.match(/code is ([0-9A-F]{12})/u)?.[1];
    expect(code).toBeTruthy();
    service.verifyEmail(baseAccount.accountId, code);
    expect(auth.getAccount(baseAccount.accountId)).toMatchObject({
      notificationEmail: 'ada@example.com',
      notificationEmailVerified: true,
      emailTurnAlerts: true,
    });

    await service.turnBegan(event);
    expect(sent.email).toHaveLength(2);
    expect(sent.email[1]).toMatchObject({ to: 'ada@example.com' });
    expect(sent.email[1]?.text).toContain('ABCDEF');
  });

  it('refuses unsafe push endpoints and does not authorize linked seats by old seat token', () => {
    const store = new MemoryGameStore();
    stores.push(store);
    store.saveAccount(baseAccount);
    store.saveSession(baseSession);
    const sent = { push: [] as Array<{ subscription: unknown; payload: string }>, email: [] as Array<{ to: string; text: string }> };
    const { service } = makeService(store, sent);

    expect(() => service.savePushSubscription(null, baseSession.token, {
      endpoint: 'https://push.example.test/sub/ada',
      keys: { p256dh: 'A'.repeat(32), auth: 'B'.repeat(16) },
    })).toThrow('Join a game before enabling browser alerts.');
    expect(() => service.savePushSubscription(baseAccount.accountId, null, {
      endpoint: 'https://127.0.0.1/internal',
      keys: { p256dh: 'A'.repeat(32), auth: 'B'.repeat(16) },
    })).toThrow('Invalid browser subscription endpoint.');
  });

  it('keeps one browser endpoint attached to each anonymous game seat', () => {
    const store = new MemoryGameStore();
    stores.push(store);
    const first = { ...baseSession, accountId: undefined };
    const second = { ...baseSession, token: 'second-seat-token', gameId: 'game-2', playerId: 'player-ada-2', accountId: undefined };
    store.saveSession(first);
    store.saveSession(second);
    const sent = { push: [] as Array<{ subscription: unknown; payload: string }>, email: [] as Array<{ to: string; text: string }> };
    const { service } = makeService(store, sent);
    const subscription = {
      endpoint: 'https://push.example.test/sub/same-browser',
      keys: { p256dh: 'A'.repeat(32), auth: 'B'.repeat(16) },
    };

    service.savePushSubscription(null, first.token, subscription);
    service.savePushSubscription(null, second.token, subscription);

    expect(store.loadPushSubscriptions()).toHaveLength(2);
    expect(service.settings(null, first.token).pushSubscribed).toBe(true);
    expect(service.settings(null, second.token).pushSubscribed).toBe(true);
    service.removePushSubscription(null, first.token, subscription.endpoint);
    expect(store.loadPushSubscriptions()).toHaveLength(1);
    expect(service.settings(null, second.token).pushSubscribed).toBe(true);
  });
});
