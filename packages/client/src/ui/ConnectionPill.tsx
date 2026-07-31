import { useGameStore } from '../net/store';
import type { ConnectionStatus } from '../net/types';
import { Tooltip } from './Tooltip';

const LABEL: Record<ConnectionStatus, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  connected: 'Online',
  reconnecting: 'Reconnecting',
  offline: 'Disconnected',
};

const EXPLANATION: Record<ConnectionStatus, string> = {
  idle: 'Not connected to the game server.',
  connecting: 'Opening a connection to the game server…',
  connected: 'Live connection to the game server.',
  reconnecting:
    'The connection dropped. Retrying with backoff — your seat is held and state is restored automatically.',
  offline:
    'Could not reach the server. Retrying in the background; nothing has been lost, and your seat is still reserved.',
};

/**
 * Always-visible connection indicator.
 *
 * Quality bar U9: reconnection is invisible in the good case (a quiet green
 * dot) and clearly explained in the bad case (amber/red with a tooltip that
 * states what is happening to the player's seat).
 */
export function ConnectionPill({ className }: { className?: string }): JSX.Element {
  const status = useGameStore((s) => s.connectionStatus);
  const latency = useGameStore((s) => s.latencyMs);

  const showLatency = status === 'connected' && latency !== null;

  return (
    <Tooltip
      title={LABEL[status]}
      content={EXPLANATION[status]}
      placement="bottom"
      rule={showLatency ? `Round trip ${latency} ms` : undefined}
    >
      <div
        className={['pg-conn', className ?? ''].filter(Boolean).join(' ')}
        data-status={status}
        tabIndex={0}
        role="status"
      >
        <span className="pg-conn__dot" />
        {LABEL[status]}
        {showLatency ? <span style={{ opacity: 0.6 }}>{latency}ms</span> : null}
      </div>
    </Tooltip>
  );
}
