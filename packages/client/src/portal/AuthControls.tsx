import { Button, IconLogout, IconUsers } from '@tt/ui';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { net, useGameStore } from '@/net';
import { Achievements } from './Achievements';

export function AuthControls(): JSX.Element | null {
  const auth = useGameStore(state => state.auth);
  const localGames = useGameStore(state => state.anonymousGames);
  const [open, setOpen] = useState(false);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('tt:login', show);
    return () => window.removeEventListener('tt:login', show);
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  if (auth.loading || !auth.configured) return null;
  return <div className="tt-account-control">
    <Achievements />
    {auth.account ? <>
      <span>{auth.account.name}</span>
      {localGames.length > 0 && <Button size="sm" loading={busy} onClick={() => void run(async () => {
        const count = await net.linkLocalGames();
        setMessage(`${count} local game(s) linked. Any remaining saves could not be linked.`);
      })}>Link local games ({localGames.length})</Button>}
      <Button variant="ghost" size="sm" icon={<IconLogout />} loading={busy} onClick={() => void run(() => net.logout())}>Sign out</Button>
    </> : <>
      <Button variant="secondary" size="sm" icon={<IconUsers />} onClick={() => setOpen(!open)}>Sign in / Create account</Button>
      {open && createPortal(<div className="tt-auth-overlay" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); setPassword(''); } }}><form role="dialog" aria-modal="true" aria-label={register ? 'Create account' : 'Sign in'} className="tt-auth-form" onSubmit={event => {
        event.preventDefault();
        void run(async () => { await net.authenticate(username, password, register); setPassword(''); setOpen(false); });
      }}>
        <strong>{register ? 'Create account' : 'Sign in'}</strong>
        <p>Save your games to your account and resume on any machine. After signing in, use “Link local games” to connect saves from this browser.</p>
        <label>Username<input autoFocus required autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>Password<input required type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} pattern={register ? String.raw`(?=.*[0-9])(?=.*[^\p{L}\p{N}\s]).{8,128}` : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <small>{register && 'Use at least 8 characters, one number, and one special character (maximum 128 characters). '}Keep your password safe; password recovery is not available yet.</small>
        {message && <p role="alert">{message}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
        <button type="button" disabled={busy} onClick={() => { setRegister(!register); setMessage(''); }}>{register ? 'Already have an account? Sign in' : 'New here? Create account'}</button>
        <button type="button" onClick={() => { setOpen(false); setPassword(''); }}>Cancel</button>
      </form></div>, document.body)}
    </>}
    {message && !open && <p role="status">{message}</p>}
  </div>;
}
