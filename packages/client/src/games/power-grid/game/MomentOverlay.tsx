import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { LogEntry } from '@game/power-grid';

import { springBouncy, springHeavy } from '@tt/ui';
import { useMatch } from './model';

interface Moment {
  id: number;
  kind: 'auction' | 'power' | 'step' | 'end' | 'final';
  headline: string;
  detail: string;
  /** Seat colour of the player the moment belongs to, when there is one. */
  color: string | null;
}

const HOLD_MS = 2000;

/**
 * The moments that deserve weight (quality bar M4): winning an auction, powering
 * cities, a Step transition, the end-game trigger and the final result.
 *
 * Driven entirely off the engine's structured log, so nothing here can drift out
 * of sync with what actually happened.
 */
export function MomentOverlay(): JSX.Element {
  const { state, meId } = useMatch();
  const reduce = useReducedMotion() === true;
  const seen = useRef<number | null>(null);
  const [moment, setMoment] = useState<Moment | null>(null);

  useEffect(() => {
    const last = state.log.length > 0 ? state.log[state.log.length - 1]!.id : 0;
    // First paint adopts the existing history silently — a reconnect must not
    // replay every celebration of the match so far.
    if (seen.current === null) {
      seen.current = last;
      return;
    }
    const cutoff = seen.current;
    const fresh = state.log.filter((entry) => entry.id > cutoff);
    seen.current = last;

    for (let i = fresh.length - 1; i >= 0; i--) {
      const built = build(fresh[i]!, state.players, meId);
      if (built) {
        setMoment(built);
        return;
      }
    }
  }, [state.log, state.players, meId]);

  useEffect(() => {
    if (!moment) return undefined;
    const timer = window.setTimeout(() => setMoment(null), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [moment]);

  return (
    <AnimatePresence>
      {moment ? (
        <motion.div
          key={moment.id}
          className="pg-gmoment"
          data-kind={moment.kind}
          style={
            moment.color
              ? ({ ['--pg-moment' as string]: moment.color } as CSSProperties)
              : undefined
          }
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 22 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04, y: -14 }}
          transition={moment.kind === 'power' || moment.kind === 'auction' ? springBouncy : springHeavy}
        >
          <span className="pg-gmoment__sweep" aria-hidden="true" />
          <strong className="pg-gmoment__headline">{moment.headline}</strong>
          <span className="pg-gmoment__detail">{moment.detail}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function build(
  entry: LogEntry,
  players: Record<string, { name: string; color: string } | undefined>,
  meId: string | null,
): Moment | null {
  const data = entry.data;
  if (!data) return null;
  const event = data.event;
  const nameOf = (id: unknown): string =>
    typeof id === 'string' ? (players[id]?.name ?? 'A player') : 'A player';
  const colorOf = (id: unknown): string | null =>
    typeof id === 'string' && players[id] ? `var(--pg-player-${players[id]!.color})` : null;

  switch (event) {
    case 'auctionResolved':
      return {
        id: entry.id,
        kind: 'auction',
        headline: data.winnerId === meId ? 'Plant won' : `${nameOf(data.winnerId)} takes plant ${data.plantId}`,
        detail: `Sold for ${data.price}₤ — ${data.reason === 'uncontested' ? 'uncontested at the minimum bid' : 'every other bidder passed'}.`,
        color: colorOf(data.winnerId),
      };
    case 'citiesPowered': {
      const supplied = typeof data.citiesSupplied === 'number' ? data.citiesSupplied : 0;
      return {
        id: entry.id,
        kind: 'power',
        headline: `${nameOf(data.playerId)} powers ${supplied} ${supplied === 1 ? 'city' : 'cities'}`,
        detail: `Paid ${data.payout}₤ from the payment summary.`,
        color: colorOf(data.playerId),
      };
    }
    case 'stepChange':
      return {
        id: entry.id,
        kind: 'step',
        headline: `Step ${data.to}`,
        detail:
          data.to === 3
            ? 'All six plants are biddable, three houses per city, no future market.'
            : 'Two houses per city, richer refills, the lowest plant leaves the market.',
        color: null,
      };
    case 'endGameTriggered':
      return {
        id: entry.id,
        kind: 'end',
        headline: 'Final round',
        detail: `${data.threshold} cities connected. The next Phase 5 evaluates the winner and pays nothing.`,
        color: null,
      };
    case 'gameOver':
      return {
        id: entry.id,
        kind: 'final',
        headline: `${nameOf(data.winnerId)} wins`,
        detail: 'Most suppliable cities takes the game; money broke any tie.',
        color: colorOf(data.winnerId),
      };
    default:
      return null;
  }
}
