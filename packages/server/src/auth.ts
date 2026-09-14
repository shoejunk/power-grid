/**
 * Password accounts with optional legacy Google OpenID Connect authentication.
 *
 * The browser only receives an opaque HttpOnly cookie. Google identifiers and
 * login sessions stay on the server, which lets a player recover every seat
 * from a different machine without putting a bearer token in localStorage.
 */

import { scrypt, timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ServerConfig } from './config.js';
import type { Logger } from './logger.js';
import type {
  AccountRecord,
  AuthSessionRecord,
  GameStore,
} from './persistence/types.js';

const AUTH_COOKIE = 'tt.auth';
const STATE_COOKIE = 'tt.googleState';
const STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface PublicAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface AuthStatus {
  configured: boolean;
  required: boolean;
  authenticated: boolean;
  account: PublicAccount | null;
}

interface OAuthAttempt {
  state: string;
  verifier: string;
  createdAt: number;
  redirectUri: string;
}

interface JsonObject {
  [key: string]: unknown;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** PKCE S256 challenge, exported so the OAuth boundary can be unit-tested. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Reads the small, deliberately opaque cookies used by the auth flow. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function cookie(name: string, value: string, opts: { maxAge: number; secure: boolean }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(opts.secure ? ['Secure'] : []),
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
  ].join('; ');
}

function clearCookie(name: string, secure: boolean): string {
  return cookie(name, '', { maxAge: 0, secure });
}

export class GoogleAuth {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly sessions = new Map<string, AuthSessionRecord>();
  private readonly attempts = new Map<string, OAuthAttempt>();

  constructor(
    private readonly deps: {
      config: ServerConfig;
      store: GameStore;
      logger: Logger;
    },
  ) {}

  get configured(): boolean { return true; }

  private get googleConfigured(): boolean {
    return Boolean(
      this.deps.config.googleClientId?.trim() && this.deps.config.googleClientSecret?.trim(),
    );
  }

  get required(): boolean {
    return this.googleConfigured && this.deps.config.googleAuthRequired;
  }

  /** Restores account profiles and server-side login sessions at boot. */
  load(): void {
    const now = Date.now();
    for (const account of this.deps.store.loadAccounts()) this.accounts.set(account.accountId, account);
    for (const session of this.deps.store.loadAuthSessions()) {
      if (session.expiresAt <= now) {
        this.deps.store.deleteAuthSession(session.token);
      } else {
        this.sessions.set(session.token, session);
      }
    }
    if (this.googleConfigured) {
      this.deps.logger.info('Google authentication enabled', { required: this.required });
    } else if (this.deps.config.googleClientId || this.deps.config.googleClientSecret) {
      this.deps.logger.warn('Google authentication is disabled because credentials are incomplete');
    }
  }

  status(req: Request): AuthStatus {
    const account = this.accountForRequest(req);
    return {
      configured: this.configured,
      required: this.required,
      authenticated: account !== null,
      account: account ? this.publicAccount(account) : null,
    };
  }

  accountIdForRequest(req: Request): string | null {
    return this.accountIdForCookie(req.headers.cookie);
  }

  /** Resolves the account on a WebSocket upgrade request. */
  accountIdForCookie(cookieHeader: string | undefined): string | null {
    return this.accountForCookie(cookieHeader)?.accountId ?? null;
  }

  /** Starts the authorization-code + PKCE flow. */
  start(req: Request, res: Response): void {
    if (!this.googleConfigured) {
      res.status(503).json({ ok: false, code: 'authNotConfigured' });
      return;
    }

    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    const attempt: OAuthAttempt = {
      state,
      verifier,
      createdAt: Date.now(),
      redirectUri: this.redirectUri(req),
    };
    this.pruneAttempts(attempt.createdAt);
    this.attempts.set(state, attempt);

    const query = new URLSearchParams({
      client_id: this.deps.config.googleClientId!,
      redirect_uri: attempt.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      access_type: 'online',
    });

    res.setHeader('Set-Cookie', cookie(STATE_COOKIE, state, {
      maxAge: STATE_TTL_MS / 1000,
      secure: this.cookieSecure(req),
    }));
    res.redirect(`${GOOGLE_AUTHORIZE_URL}?${query.toString()}`);
  }

  /** Completes the authorization-code exchange and establishes the account cookie. */
  async callback(req: Request, res: Response): Promise<void> {
    if (!this.googleConfigured) {
      res.status(503).json({ ok: false, code: 'authNotConfigured' });
      return;
    }

    const state = stringValue(req.query.state);
    const code = stringValue(req.query.code);
    const attempt = state ? this.attempts.get(state) : undefined;
    this.attempts.delete(state ?? '');

    if (
      !state ||
      !code ||
      !attempt ||
      readCookie(req.headers.cookie, STATE_COOKIE) !== state ||
      Date.now() - attempt.createdAt > STATE_TTL_MS
    ) {
      res.status(400).json({ ok: false, code: 'invalidAuthState' });
      return;
    }

    res.setHeader('Set-Cookie', clearCookie(STATE_COOKIE, this.cookieSecure(req)));

    try {
      const profile = await this.exchangeCode(code, attempt);
      const now = Date.now();
      const previous = this.accounts.get(profile.accountId);
      const account: AccountRecord = {
        accountId: profile.accountId,
        email: profile.email,
        name: profile.name,
        ...(profile.picture ? { picture: profile.picture } : {}),
        createdAt: previous?.createdAt ?? now,
        lastSeen: now,
      };
      this.accounts.set(account.accountId, account);
      this.deps.store.saveAccount(account);

      const session: AuthSessionRecord = {
        token: randomBytes(32).toString('base64url'),
        accountId: account.accountId,
        createdAt: now,
        lastSeen: now,
        expiresAt: now + this.deps.config.authSessionTtlMs,
      };
      this.sessions.set(session.token, session);
      this.deps.store.saveAuthSession(session);
      res.append('Set-Cookie', cookie(AUTH_COOKIE, session.token, {
        maxAge: this.deps.config.authSessionTtlMs / 1000,
        secure: this.cookieSecure(req),
      }));
      res.redirect('/');
    } catch (error) {
      this.deps.logger.warn('Google authentication failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({ ok: false, code: 'authExchangeFailed' });
    }
  }

  private readonly loginAttempts = new Map<string, { count: number; until: number }>();
  private pendingPasswords = 0;

  async passwordLogin(req: Request, res: Response, register: boolean): Promise<void> {
    const now = Date.now();
    for (const [key, value] of this.loginAttempts) {
      if (value.until <= now) this.loginAttempts.delete(key);
    }
    const ip = req.ip ?? 'unknown';
    const attempt = this.loginAttempts.get(ip) ?? { count: 0, until: now + 15 * 60_000 };
    attempt.count++;
    this.loginAttempts.set(ip, attempt);
    if (attempt.count > 30 || this.pendingPasswords >= 4) {
      res.status(429).json({ message: 'Too many attempts. Please try again later.' });
      return;
    }
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!/^[a-z0-9_]{3,32}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 128) {
      res.status(400).json({ message: 'Use a username of 3–32 letters, numbers or underscores and a password of 12–128 characters.' });
      return;
    }
    this.pendingPasswords++;
    try {
      let account = [...this.accounts.values()].find((value) => value.username === username);
      const salt = account?.passwordHash?.split(':')[0] ?? randomBytes(16).toString('hex');
      const derived = await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
      });
      if (register) {
        // Recheck after asynchronous hashing to prevent concurrent duplicate registrations.
        if ([...this.accounts.values()].some((value) => value.username === username)) {
          res.status(409).json({ message: 'That username is unavailable.' });
          return;
        }
        account = { accountId: `local:${randomBytes(24).toString('hex')}`, username, passwordHash: `${salt}:${derived.toString('hex')}`, email: '', name: username, createdAt: now, lastSeen: now };
        this.deps.store.saveAccount(account);
        this.accounts.set(account.accountId, account);
      } else {
        const expected = Buffer.from(account?.passwordHash?.split(':')[1] ?? '', 'hex');
        if (!account || expected.length !== derived.length || !timingSafeEqual(expected, derived)) {
          res.status(401).json({ message: 'Incorrect username or password.' });
          return;
        }
      }
      const session: AuthSessionRecord = { token: randomBytes(32).toString('base64url'), accountId: account.accountId, createdAt: now, lastSeen: now, expiresAt: now + this.deps.config.authSessionTtlMs };
      this.deps.store.saveAuthSession(session);
      this.sessions.set(session.token, session);
      res.setHeader('Set-Cookie', cookie(AUTH_COOKIE, session.token, { maxAge: this.deps.config.authSessionTtlMs / 1000, secure: this.cookieSecure(req) }));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: 'Unable to save your account. Please try again.' });
    } finally {
      this.pendingPasswords--;
    }
  }

  logout(req: Request, res: Response): void {
    const token = readCookie(req.headers.cookie, AUTH_COOKIE);
    if (token) {
      this.sessions.delete(token);
      this.deps.store.deleteAuthSession(token);
    }
    res.setHeader('Set-Cookie', clearCookie(AUTH_COOKIE, this.cookieSecure(req)));
    res.json({ ok: true });
  }

  private accountForRequest(req: Request): AccountRecord | null {
    if (!this.configured) return null;
    return this.accountForCookie(req.headers.cookie);
  }

  private accountForCookie(cookieHeader: string | undefined): AccountRecord | null {
    if (!this.configured) return null;
    const token = readCookie(cookieHeader, AUTH_COOKIE);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    const now = Date.now();
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      this.deps.store.deleteAuthSession(token);
      return null;
    }
    const account = this.accounts.get(session.accountId);
    if (!account) return null;
    session.lastSeen = now;
    account.lastSeen = now;
    this.deps.store.saveAuthSession(session);
    this.deps.store.saveAccount(account);
    return account;
  }

  private publicAccount(account: AccountRecord): PublicAccount {
    return {
      id: account.accountId,
      email: account.email,
      name: account.name,
      ...(account.picture ? { picture: account.picture } : {}),
    };
  }

  private async exchangeCode(
    code: string,
    attempt: OAuthAttempt,
  ): Promise<{ accountId: string; email: string; name: string; picture?: string }> {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.deps.config.googleClientId!,
        client_secret: this.deps.config.googleClientSecret!,
        redirect_uri: attempt.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: attempt.verifier,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Google token endpoint returned ${tokenResponse.status}`);
    const tokenBody: unknown = await tokenResponse.json();
    if (!isObject(tokenBody)) throw new Error('Google token response was not an object');
    const accessToken = stringValue(tokenBody.access_token);
    if (!accessToken) throw new Error('Google token response omitted access_token');

    const userResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) throw new Error(`Google userinfo endpoint returned ${userResponse.status}`);
    const userBody: unknown = await userResponse.json();
    if (!isObject(userBody)) throw new Error('Google userinfo response was not an object');
    const accountId = stringValue(userBody.sub);
    const email = stringValue(userBody.email);
    if (!accountId || !email) throw new Error('Google userinfo omitted the stable account identity');
    if (userBody.email_verified === false) throw new Error('Google email is not verified');
    const name = (stringValue(userBody.name) ?? email.split('@')[0] ?? 'Google player').slice(0, 80);
    const picture = stringValue(userBody.picture);
    return {
      accountId,
      email: email.slice(0, 320),
      name,
      ...(picture && /^https:\/\//i.test(picture) ? { picture } : {}),
    };
  }

  private redirectUri(req: Request): string {
    const configured = this.deps.config.publicOrigin?.trim().replace(/\/$/, '');
    if (configured) return `${configured}/auth/google/callback`;
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol;
    return `${protocol}://${req.get('host')}/auth/google/callback`;
  }

  private cookieSecure(req: Request): boolean {
    const configured = this.deps.config.publicOrigin?.trim();
    if (configured) return configured.startsWith('https://');
    return (req.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? req.protocol) === 'https';
  }

  private pruneAttempts(now: number): void {
    for (const [state, attempt] of this.attempts) {
      if (now - attempt.createdAt > STATE_TTL_MS) this.attempts.delete(state);
    }
  }
}

export { AUTH_COOKIE };
