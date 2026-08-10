import type { ConnectionState } from '../types';
import { Tooltip } from './Tooltip';

const LABEL: Record<ConnectionState, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  connected: 'Online',
  reconnecting: 'Reconnecting',
  offline: 'Disconnected',
};

const EXPLANATION: Record<ConnectionState, string> = {
  idle: 'Not connected to the game server.',
  connecting: 'Opening a connection to the game server…',
  connected: 'Live connection to the game server.',
  reconnecting:
    'The connection dropped. Retrying with backoff — your seat is held and state is restored automatically.',
  offline:
    'Could not reach the server. Retrying in the background; nothing has been lost, and your seat is still reserved.',
};

export interface ConnectionPillProps {
  status: ConnectionState;
  /** Round-trip time in ms, when known. */
  latencyMs?: number | null;
  className?: string;
}

/**
 * Always-visible connection indicator.
 *
 * Quality bar U9: reconnection is invisible in the good case (a quiet green
 * dot) and clearly explained in the bad case (amber/red with a tooltip that
 * states what is happening to the player's seat).
 *
 * Purely presentational — the app binds it to its own transport, so the design
 * system carries no dependency on a store.
 */
export function ConnectionPill({
  status,
  latencyMs = null,
  className,
}: ConnectionPillProps): JSX.Element {
  const showLatency = status === 'connected' && latencyMs !== null;

  return (
    <Tooltip
      title={LABEL[status]}
      content={EXPLANATION[status]}
      placement="bottom"
      rule={showLatency ? `Round trip ${latencyMs} ms` : undefined}
    >
      <div
        className={['tt-conn', className ?? ''].filter(Boolean).join(' ')}
        data-status={status}
        tabIndex={0}
        role="status"
      >
        <span className="tt-conn__dot" />
        {LABEL[status]}
        {showLatency ? <span style={{ opacity: 0.6 }}>{latencyMs}ms</span> : null}
      </div>
    </Tooltip>
  );
}
