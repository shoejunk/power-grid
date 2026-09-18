import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadLegacySessionToken, useGameStore } from '@/net';
import './notifications.scss';

interface NotificationSettingsData {
  pushEnabled: boolean;
  pushSubscribed: boolean;
  emailEnabled: boolean;
  email: string;
  emailVerified: boolean;
  emailTurnAlerts: boolean;
  pendingEmail: string;
}

interface NotificationConfig {
  pushEnabled: boolean;
  vapidPublicKey: string | null;
}

const browserNotificationsBlockedMessage = 'Notifications are blocked for this site. Select the site information icon beside the address bar → Permissions for this site → Notifications → Allow, then try again.';

const decodeVapidKey = (value: string): ArrayBuffer => {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
};

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? 'Unable to update turn alerts.');
  return body;
}

export function NotificationSettings(): JSX.Element | null {
  const auth = useGameStore((state) => state.auth);
  const hasSeat = useGameStore((state) => state.myPlayerId !== null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<NotificationSettingsData | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canManage = auth.authenticated || hasSeat;
  const browserNotificationsBlocked = 'Notification' in window && Notification.permission === 'denied';

  const refresh = async (): Promise<void> => {
    const data = await postJson<NotificationSettingsData>('/api/notifications/settings', {
      sessionToken: auth.authenticated ? null : loadLegacySessionToken(),
    });
    setSettings(data);
    setEmail(data.email);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await postJson<NotificationSettingsData>('/api/notifications/settings', {
          sessionToken: auth.authenticated ? null : loadLegacySessionToken(),
        });
        if (!cancelled) { setSettings(data); setEmail(data.email); setMessage(''); }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load turn alerts.');
      }
    })();
    return () => { cancelled = true; };
  }, [auth.authenticated, open]);

  if (auth.loading || !canManage) return null;

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage('');
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const enablePush = async (): Promise<void> => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('This browser does not support push notifications.');
    }
    if (Notification.permission === 'denied') throw new Error(browserNotificationsBlockedMessage);
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied'
        ? browserNotificationsBlockedMessage
        : 'Choose Allow in the browser prompt to receive turn alerts.');
    }

    const configResponse = await fetch('/api/notifications/config', { credentials: 'same-origin' });
    const config = await configResponse.json() as NotificationConfig;
    if (!configResponse.ok || !config.pushEnabled || !config.vapidPublicKey) {
      throw new Error('Browser push is not configured on this server.');
    }
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(config.vapidPublicKey),
      });
    }
    await postJson('/api/notifications/push/subscribe', {
      sessionToken: auth.authenticated ? null : loadLegacySessionToken(),
      subscription: subscription.toJSON(),
    });
    await refresh();
    setMessage('Browser turn alerts are on for this device.');
  };

  const disablePush = async (): Promise<void> => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await postJson('/api/notifications/push/unsubscribe', {
        sessionToken: auth.authenticated ? null : loadLegacySessionToken(),
        endpoint: subscription.endpoint,
      });
      await subscription.unsubscribe();
    }
    await refresh();
    setMessage('Browser turn alerts are off for this device.');
  };

  const updateEmail = async (enabled: boolean): Promise<void> => {
    const result = await postJson<{ verified: boolean; pendingEmail?: string }>('/api/notifications/email', {
      email,
      enabled,
    });
    await refresh();
    if (!enabled) setMessage('Email turn alerts are off.');
    else if (result.verified) setMessage('Email turn alerts are on.');
    else setMessage(`Enter the verification code sent to ${result.pendingEmail ?? email}.`);
  };

  const verifyEmail = async (): Promise<void> => {
    await postJson('/api/notifications/email/verify', { code });
    setCode('');
    await refresh();
    setMessage('Email verified. Turn alerts are on.');
  };

  return <>
    <button className="tt-alerts-trigger" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      Turn alerts
    </button>
    {open && createPortal(
      <div className="tt-alerts-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section
          className="tt-alerts-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tt-alerts-title"
          onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
        >
          <button className="tt-alerts-close" type="button" aria-label="Close turn alerts" onClick={() => setOpen(false)}>×</button>
          <h2 id="tt-alerts-title">Turn alerts</h2>
          <p className="tt-alerts-intro">Choose how to hear when your turn begins. Alerts are sent only after you opt in.</p>
          {settings ? <>
            <div className="tt-alerts-section">
              <strong>Browser push</strong>
              <p>{settings.pushEnabled ? 'Get an alert on this device, including when the game is closed.' : 'Browser push is not configured on this server yet.'}</p>
              {settings.pushEnabled && !settings.pushSubscribed && browserNotificationsBlocked && message !== browserNotificationsBlockedMessage && <p>{browserNotificationsBlockedMessage}</p>}
              <button type="button" disabled={busy || (!settings.pushEnabled && !settings.pushSubscribed)} onClick={() => void run(settings.pushSubscribed ? disablePush : enablePush)}>
                {settings.pushSubscribed ? 'Turn off browser alerts' : 'Enable browser alerts on this device'}
              </button>
            </div>
            {auth.authenticated && <div className="tt-alerts-section">
              <strong>Email</strong>
              {settings.emailEnabled ? <>
                <label className="tt-alerts-label" htmlFor="tt-alerts-email">Email address</label>
                <input id="tt-alerts-email" type="email" autoComplete="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} />
                {settings.pendingEmail && <>
                  <p>A verification code was sent to {settings.pendingEmail}.</p>
                  <label className="tt-alerts-label" htmlFor="tt-alerts-code">Verification code</label>
                  <input id="tt-alerts-code" inputMode="text" autoComplete="one-time-code" maxLength={12} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} />
                  <button type="button" disabled={busy || code.length !== 12} onClick={() => void run(verifyEmail)}>Verify email</button>
                </>}
                <div className="tt-alerts-actions">
                  <button type="button" disabled={busy || !email.trim()} onClick={() => void run(() => updateEmail(true))}>
                    {settings.emailTurnAlerts ? 'Save email alerts' : 'Enable email alerts'}
                  </button>
                  {settings.emailTurnAlerts && <button className="is-secondary" type="button" disabled={busy} onClick={() => void run(() => updateEmail(false))}>Turn off email alerts</button>}
                </div>
                {settings.emailTurnAlerts && !settings.emailVerified && <p>Email alerts are waiting for address verification.</p>}
              </> : <>
                <p>Email delivery is not configured on this server yet.</p>
                {(settings.emailTurnAlerts || settings.pendingEmail) && <button className="is-secondary" type="button" disabled={busy} onClick={() => void run(() => updateEmail(false))}>
                  {settings.emailTurnAlerts ? 'Turn off email alerts' : 'Cancel email verification'}
                </button>}
              </>}
            </div>}
          </> : <p role="status">Loading alert settings…</p>}
          {message && <p className="tt-alerts-message" role="status">{message}</p>}
        </section>
      </div>,
      document.body,
    )}
  </>;
}
