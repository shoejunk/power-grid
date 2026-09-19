import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@tt/ui';
import { useGameStore } from '@/net';

interface Profile { id: string; name: string; achievements: { achievementId: string; name: string; description: string; earnedAt: number }[] }

export function Achievements(): JSX.Element {
  const ownId = useGameStore(s => s.auth.account?.id);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(ownId ?? '');
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatus('Loading…');
    void fetch(`/api/achievements?${new URLSearchParams({ accountId: selected, q: query })}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data: { players: typeof players; profile: Profile | null }) => { setPlayers(data.players); setProfile(data.profile); setStatus(''); })
      .catch(() => { if (!controller.signal.aborted) setStatus('Could not load achievements. Please reopen to retry.'); });
    return () => controller.abort();
  }, [open, selected, query]);
  return <>
    <Button variant="ghost" size="sm" onClick={() => { setSelected(ownId ?? ''); setOpen(true); }}>Achievements</Button>
    {open && createPortal(<div className="tt-auth-overlay" onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
      <section className="tt-auth-form" role="dialog" aria-modal="true" aria-label="Player achievements" style={{ width: 'min(640px, 92vw)', maxHeight: '85vh', overflowY: 'auto' }}>
        <h2>Player achievements</h2>
        <p>Earn awards in completed games with at least two human players. Bots, including Jev, do not count. Awards are saved to your account.</p>
        {ownId && <Button size="sm" onClick={() => { setSelected(ownId); setQuery(''); }}>My achievements</Button>}
        <label>Find a player<input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Player name" maxLength={80} /></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{players.map(player => <Button key={player.id} size="sm" variant={selected === player.id ? 'primary' : 'ghost'} onClick={() => setSelected(player.id)}>{player.name}</Button>)}</div>
        <p role="status">{status}</p>
        {!status && players.length === 0 && <p>No players found.</p>}
        {!status && !profile && players.length > 0 && <p>Select a player to view their achievements.</p>}
        {!status && profile && <>
          <h3>{profile.name}</h3>
          {profile.achievements.length ? <ul>{profile.achievements.map(award => <li key={award.achievementId} style={{ marginBottom: 16 }}>
            <strong>{award.name}</strong><p>{award.description}</p><small>Earned {new Date(award.earnedAt).toLocaleDateString()}</small>
          </li>)}</ul> : <p>No achievements earned yet.</p>}
        </>}
        <details><summary>Available Power Grid awards</summary><ul>
          <li><strong>On the Grid:</strong> Finish a game.</li>
          <li><strong>Power Player:</strong> Win a game.</li>
          <li><strong>Built to Last:</strong> Win without ever scrapping a plant.</li>
        </ul><p>At least two humans must start and remain human through completion. Anonymous players count, but must link their game to an account to keep awards. Historical games need a complete audit roster.</p></details>
        <Button onClick={() => setOpen(false)}>Close</Button>
      </section>
    </div>, document.body)}
  </>;
}
