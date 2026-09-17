import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import type { ServerConfig } from './config.js';
import type { GoogleAuth } from './auth.js';
import type { Logger } from './logger.js';
import type { GameStore, PushSubscriptionRecord } from './persistence/types.js';

interface WebPushApi {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string },
  ): Promise<unknown>;
}

interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

export interface NotificationAdapters {
  sendPush?: (subscription: PushSubscriptionRecord, payload: string) => Promise<void>;
  sendEmail?: (message: MailMessage) => Promise<void>;
}

export interface TurnBeganEvent {
  gameId: string;
  gameKey: string;
  gameName: string;
  code: string;
  playerId: string;
}

const require = createRequire(import.meta.url);
const webPush = require('web-push') as WebPushApi;
const nodemailer = require('nodemailer') as {
  createTransport(url: string): MailTransport;
};

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function clearVerification(account: ReturnType<GoogleAuth['getAccount']>): void {
  if (!account) return;
  delete account.pendingNotificationEmail;
  delete account.notificationEmailVerificationHash;
  delete account.notificationEmailVerificationExpiresAt;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host) !== 0;
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

export class TurnNotifications {
  private readonly pushEnabled: boolean;
  private readonly emailEnabled: boolean;
  private readonly mailTransport: MailTransport | null;
  private readonly verificationAttempts = new Map<string, { count: number; since: number }>();
  private readonly verificationRequests = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly deps: {
      config: ServerConfig;
      store: GameStore;
      auth: GoogleAuth;
      logger: Logger;
    },
    private readonly adapters: NotificationAdapters = {},
  ) {
    const { config } = deps;
    this.pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject);
    if (this.pushEnabled && !adapters.sendPush) {
      webPush.setVapidDetails(config.vapidSubject!, config.vapidPublicKey!, config.vapidPrivateKey!);
    }
    this.emailEnabled = Boolean(config.smtpUrl && config.emailFrom);
    this.mailTransport = this.emailEnabled ? nodemailer.createTransport(config.smtpUrl!) : null;
  }

  publicConfig(): { pushEnabled: boolean; vapidPublicKey: string | null; emailEnabled: boolean } {
    return {
      pushEnabled: this.pushEnabled,
      vapidPublicKey: this.pushEnabled ? this.deps.config.vapidPublicKey : null,
      emailEnabled: this.emailEnabled,
    };
  }

  settings(accountId: string | null, sessionToken: string | null): Record<string, unknown> {
    const subscriptionOwner = this.subscriptionOwner(accountId, sessionToken);
    const subscriptions = this.deps.store.loadPushSubscriptions();
    const subscribed = subscriptions.some((subscription) =>
      (subscriptionOwner.accountId && subscription.accountId === subscriptionOwner.accountId) ||
      (subscriptionOwner.sessionTokenHash && subscription.sessionTokenHash === subscriptionOwner.sessionTokenHash),
    );

    if (!accountId) {
      return {
        pushEnabled: this.pushEnabled,
        pushSubscribed: subscribed,
        emailEnabled: false,
        email: '',
        emailVerified: false,
        emailTurnAlerts: false,
        pendingEmail: '',
      };
    }
    const account = this.deps.auth.getAccount(accountId);
    if (!account) throw new Error('Sign in again to manage turn alerts.');
    const email = account.notificationEmailVerified && account.notificationEmail
      ? account.notificationEmail
      : account.emailVerified ? account.email : '';
    const emailVerified = Boolean(email && (
      (account.notificationEmailVerified && account.notificationEmail === email) ||
      (account.emailVerified && account.email === email)
    ));
    return {
      pushEnabled: this.pushEnabled,
      pushSubscribed: subscribed,
      emailEnabled: this.emailEnabled,
      email,
      emailVerified,
      emailTurnAlerts: account.emailTurnAlerts === true,
      pendingEmail: account.pendingNotificationEmail ?? '',
    };
  }

  savePushSubscription(
    accountId: string | null,
    sessionToken: string | null,
    raw: unknown,
  ): void {
    if (!this.pushEnabled) throw new Error('Browser push is not configured on this server.');
    const owner = this.subscriptionOwner(accountId, sessionToken);
    if (!owner.accountId && !owner.sessionTokenHash) throw new Error('Join a game before enabling browser alerts.');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid browser subscription.');
    const value = raw as Record<string, unknown>;
    const keys = typeof value.keys === 'object' && value.keys !== null
      ? value.keys as Record<string, unknown>
      : {};
    const endpoint = typeof value.endpoint === 'string' ? value.endpoint : '';
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
    const auth = typeof keys.auth === 'string' ? keys.auth : '';
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { throw new Error('Invalid browser subscription endpoint.'); }
    if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443') ||
      parsed.username !== '' || parsed.password !== '' || isLocalHostname(parsed.hostname) || endpoint.length > 2048) {
      throw new Error('Invalid browser subscription endpoint.');
    }
    if (!/^[\w-]{16,512}$/u.test(p256dh) || !/^[\w-]{8,256}$/u.test(auth)) {
      throw new Error('Invalid browser subscription keys.');
    }
    const now = Date.now();
    const subscriptionId = createHash('sha256')
      .update(`${endpoint}\n${owner.accountId ? `account:${owner.accountId}` : `session:${owner.sessionTokenHash}`}`)
      .digest('hex');
    const subscriptions = this.deps.store.loadPushSubscriptions();
    const existing = subscriptions.find((subscription) => subscription.subscriptionId === subscriptionId);
    const ownedSubscriptions = subscriptions.filter((subscription) =>
      (owner.accountId && subscription.accountId === owner.accountId) ||
      (owner.sessionTokenHash && subscription.sessionTokenHash === owner.sessionTokenHash),
    );
    if (!existing && ownedSubscriptions.length >= 25) {
      throw new Error('This player already has 25 browser alert devices. Remove an old device first.');
    }
    this.deps.store.savePushSubscription({
      subscriptionId,
      endpoint,
      p256dh,
      auth,
      ...owner,
      createdAt: existing?.createdAt ?? now,
      lastSeen: now,
    });
  }

  removePushSubscription(accountId: string | null, sessionToken: string | null, endpoint: unknown): void {
    const owner = this.subscriptionOwner(accountId, sessionToken);
    if (typeof endpoint !== 'string' || endpoint.length > 2048) throw new Error('Invalid browser subscription endpoint.');
    const subscription = this.deps.store.loadPushSubscriptions().find((candidate) =>
      candidate.endpoint === endpoint &&
      ((owner.accountId && candidate.accountId === owner.accountId) ||
       (owner.sessionTokenHash && candidate.sessionTokenHash === owner.sessionTokenHash)),
    );
    if (subscription) this.deps.store.deletePushSubscription(subscription.subscriptionId);
  }

  async updateEmailAlerts(
    accountId: string,
    requestedEmail: unknown,
    enabled: unknown,
  ): Promise<{ verified: boolean; pendingEmail?: string }> {
    const account = this.deps.auth.getAccount(accountId);
    if (!account) throw new Error('Sign in again to manage email alerts.');
    if (enabled !== true) {
      account.emailTurnAlerts = false;
      clearVerification(account);
      this.deps.auth.saveAccount(account);
      return { verified: Boolean(account.notificationEmailVerified || account.emailVerified) };
    }
    if (!this.emailEnabled) throw new Error('Email alerts are not configured on this server.');
    if (typeof requestedEmail !== 'string') throw new Error('Enter an email address.');
    const email = requestedEmail.trim();
    if (email.length > 320 || !emailPattern.test(email)) throw new Error('Enter a valid email address.');

    const customVerified = account.notificationEmailVerified === true &&
      account.notificationEmail?.toLowerCase() === email.toLowerCase();
    const accountVerified = account.emailVerified === true && account.email.toLowerCase() === email.toLowerCase();
    if (customVerified || accountVerified) {
      if (accountVerified && !customVerified) {
        delete account.notificationEmail;
        account.notificationEmailVerified = false;
      }
      account.emailTurnAlerts = true;
      clearVerification(account);
      this.deps.auth.saveAccount(account);
      return { verified: true };
    }

    const now = Date.now();
    const priorRequests = this.verificationRequests.get(accountId);
    if (priorRequests && now - priorRequests.since < 60 * 60_000 && priorRequests.count >= 5) {
      throw new Error('Too many verification emails. Try again later.');
    }
    this.verificationRequests.set(accountId,
      !priorRequests || now - priorRequests.since >= 60 * 60_000
        ? { count: 1, since: now }
        : { count: priorRequests.count + 1, since: priorRequests.since },
    );
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = now + 20 * 60_000;
    await this.sendEmail({
      from: this.deps.config.emailFrom!,
      to: email,
      subject: 'Verify your turn alert email',
      text: `Your TableTop turn alert verification code is ${code}. Enter it in your account settings within 20 minutes. If you did not request this, you can ignore this message.`,
    });
    account.pendingNotificationEmail = email;
    account.notificationEmailVerificationHash = createHash('sha256').update(`${accountId}:${code}`).digest('hex');
    account.notificationEmailVerificationExpiresAt = expiresAt;
    this.deps.auth.saveAccount(account);
    return { verified: false, pendingEmail: email };
  }

  verifyEmail(accountId: string, rawCode: unknown): void {
    const account = this.deps.auth.getAccount(accountId);
    if (!account) throw new Error('Sign in again to manage email alerts.');
    if (typeof rawCode !== 'string' || !/^[0-9A-F]{12}$/i.test(rawCode.trim())) {
      throw new Error('Enter the 12-character verification code from your email.');
    }
    const now = Date.now();
    const attempts = this.verificationAttempts.get(accountId);
    if (attempts && now - attempts.since < 15 * 60_000 && attempts.count >= 10) {
      throw new Error('Too many verification attempts. Request a new code later.');
    }
    const expected = account.notificationEmailVerificationHash;
    if (!account.pendingNotificationEmail || !expected ||
      !account.notificationEmailVerificationExpiresAt || account.notificationEmailVerificationExpiresAt <= now) {
      clearVerification(account);
      this.deps.auth.saveAccount(account);
      throw new Error('That verification code expired. Request a new one.');
    }
    const actual = createHash('sha256').update(`${accountId}:${rawCode.trim().toUpperCase()}`).digest('hex');
    const valid = timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
    if (!valid) {
      const entry = !attempts || now - attempts.since >= 15 * 60_000
        ? { count: 1, since: now }
        : { count: attempts.count + 1, since: attempts.since };
      this.verificationAttempts.set(accountId, entry);
      throw new Error('That verification code is incorrect.');
    }
    this.verificationAttempts.delete(accountId);
    account.notificationEmail = account.pendingNotificationEmail;
    account.notificationEmailVerified = true;
    account.emailTurnAlerts = true;
    clearVerification(account);
    this.deps.auth.saveAccount(account);
  }

  async turnBegan(event: TurnBeganEvent): Promise<void> {
    const sessions = this.deps.store.loadSessions().filter(
      (session) => session.gameId === event.gameId && session.playerId === event.playerId,
    );
    if (sessions.length === 0) return;
    const accountIds = new Set(sessions.flatMap((session) => session.accountId ? [session.accountId] : []));
    const sessionHashes = new Set(sessions.map((session) => tokenHash(session.token)));
    const accounts = this.deps.store.loadAccounts().filter((account) => accountIds.has(account.accountId));
    const matchingSubscriptions = this.deps.store.loadPushSubscriptions().filter((subscription) =>
      (subscription.accountId && accountIds.has(subscription.accountId)) ||
      (subscription.sessionTokenHash && sessionHashes.has(subscription.sessionTokenHash)),
    );
    const subscriptions = [...new Map(matchingSubscriptions.map((subscription) => [subscription.endpoint, subscription])).values()];
    const url = '/';
    const payload = JSON.stringify({
      title: "It's your turn",
      body: `Your turn in ${event.gameName} (table ${event.code}).`,
      url,
      tag: `turn-${event.gameId}`,
    });
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await this.sendPush(subscription, payload);
      } catch (error) {
        const statusCode = statusCodeOf(error);
        if (statusCode === 404 || statusCode === 410) {
          this.deps.store.deletePushSubscription(subscription.subscriptionId);
          return;
        }
        this.deps.logger.warn('Browser turn alert delivery failed', {
          gameId: event.gameId,
          playerId: event.playerId,
          statusCode,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    if (!this.emailEnabled) return;
    const destinations = new Set(accounts.flatMap((account) => {
      if (account.emailTurnAlerts !== true) return [];
      if (account.notificationEmailVerified && account.notificationEmail) return [account.notificationEmail];
      return account.emailVerified && account.email ? [account.email] : [];
    }));
    await Promise.all([...destinations].map(async (to) => {
      try {
        await this.sendEmail({
          from: this.deps.config.emailFrom!,
          to,
          subject: `It's your turn in ${event.gameName}`,
          text: `Your turn just began in ${event.gameName} (table ${event.code}). Open TableTop to play: ${this.deps.config.publicOrigin?.replace(/\/$/u, '') ?? ''}/`,
        });
      } catch (error) {
        this.deps.logger.warn('Email turn alert delivery failed', {
          gameId: event.gameId,
          playerId: event.playerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  }

  private subscriptionOwner(accountId: string | null, sessionToken: string | null): {
    accountId?: string;
    sessionTokenHash?: string;
  } {
    if (accountId) return { accountId };
    if (!sessionToken || sessionToken.length > 256) return {};
    const session = this.deps.store.loadSessions().find((candidate) => candidate.token === sessionToken);
    if (!session || session.accountId) return {};
    return { sessionTokenHash: tokenHash(sessionToken) };
  }

  private sendPush(subscription: PushSubscriptionRecord, payload: string): Promise<void> {
    if (this.adapters.sendPush) return this.adapters.sendPush(subscription, payload);
    return webPush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, payload, { TTL: 60 * 60, urgency: 'high' }).then(() => undefined);
  }

  private sendEmail(message: MailMessage): Promise<void> {
    if (this.adapters.sendEmail) return this.adapters.sendEmail(message);
    if (!this.mailTransport) return Promise.reject(new Error('Email delivery is not configured.'));
    return this.mailTransport.sendMail(message).then(() => undefined);
  }
}
