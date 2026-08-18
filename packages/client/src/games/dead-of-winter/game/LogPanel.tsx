/**
 * The rules log.
 *
 * This is the only record of everything that happened while you were reading
 * something else — an exposure roll, a zombie batch, a morale change — so it
 * carries every entry the server was willing to show this viewer, newest first,
 * with the category as a colour. Entries carrying a secret never arrive here at
 * all: `redactStateFor` drops them before the frame is sent (§3).
 */

import type { GameState, LogCategory } from '@game/dead-of-winter';
import { Panel } from '@tt/ui';
import { useEffect, useRef } from 'react';

const CATEGORY_TONE: Partial<Record<LogCategory, string>> = {
  death: 'bad',
  combat: 'warn',
  zombie: 'warn',
  morale: 'warn',
  crisis: 'warn',
  endgame: 'bad',
  objective: 'good',
  vote: 'note',
  exile: 'bad',
  crossroads: 'note',
  phase: 'note',
  setup: 'note',
};

export function LogPanel({ state }: { state: GameState }): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const count = state.log.length;

  // The newest entry is at the bottom, so the panel follows it.
  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [count]);

  return (
    <Panel padding="tight" className="dow-log" title="What happened">
      <div className="dow-log__list" ref={listRef}>
        {state.log.map((entry) => (
          <div
            key={entry.id}
            className={`dow-log__line dow-log__line--${CATEGORY_TONE[entry.category] ?? 'plain'}`}
          >
            <span className="dow-log__round">R{entry.round}</span>
            <span className="dow-log__text">{entry.message}</span>
          </div>
        ))}
        {count === 0 ? <p className="tt-caption">Nothing yet.</p> : null}
      </div>
    </Panel>
  );
}
