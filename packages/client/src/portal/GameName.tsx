import { useEffect, useState } from 'react';
import { Button, TextInput } from '@tt/ui';
import { net, selectIsHost, useGameStore } from '@/net';

/** Shared between lobby and match so the creator can rename at any time. */
export function GameName(): JSX.Element | null {
  const lobby = useGameStore(s => s.lobby);
  const isHost = useGameStore(selectIsHost);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lobby?.gameName ?? '');
  useEffect(() => { setName(lobby?.gameName ?? ''); }, [lobby?.gameName, lobby?.gameId]);
  if (!lobby) return null;
  return <div className="tt-game-name" style={{ display: 'flex', flexShrink: 0, gap: 8, alignItems: 'center', padding: '8px 16px', flexWrap: 'wrap' }}>
    {editing && isHost ? <form style={{ display: 'flex', gap: 8 }} onSubmit={event => {
      event.preventDefault(); net.setGameName(name); setEditing(false);
    }}>
      <TextInput aria-label="Game name" value={name} placeholder={lobby.code} maxLength={80} onChange={e => setName(e.target.value)} />
      <Button type="submit" size="sm">Save name</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </form> : <>
      <strong>{lobby.gameName || lobby.code}</strong>
      {isHost && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Rename game</Button>}
    </>}
  </div>;
}
