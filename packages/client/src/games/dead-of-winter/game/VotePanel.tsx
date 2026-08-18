/**
 * §15's simultaneous vote.
 *
 * Two rules shape this panel: commitments are simultaneous and secret until
 * every eligible player has answered, and a commitment can never be changed.
 * So the panel shows *who has answered* — which is public, and is what stops
 * the table stalling on someone who wandered off — and never how they answered
 * until the reveal.
 */

import type { GameState } from '@game/dead-of-winter';
import type { PlayerId } from '@tt/core';
import { Badge, Button, Panel } from '@tt/ui';

import { net } from '@/net';

import { myOpenVote } from './model';

export function VotePanel({ state, me }: { state: GameState; me: PlayerId | null }): JSX.Element | null {
  const vote = state.vote;
  if (!vote) return null;

  const canVote = myOpenVote(state, me);
  const outstanding = vote.electorate.filter((id) => vote.votes[id] === undefined);
  const myVote = me !== null ? vote.votes[me] : undefined;

  return (
    <Panel
      padding="tight"
      tone="glass"
      className="dow-vote"
      title={vote.prompt}
      actions={
        <Badge tone={canVote ? 'warning' : 'info'} dot>
          {vote.electorate.length - outstanding.length}/{vote.electorate.length} in
        </Badge>
      }
    >
      {canVote ? (
        <div className="dow-vote__buttons">
          <Button variant="primary" size="sm" onClick={() => net.action({ type: 'castVote', vote: true })}>
            Yes — exile
          </Button>
          <Button variant="secondary" size="sm" onClick={() => net.action({ type: 'castVote', vote: false })}>
            No — they stay
          </Button>
        </div>
      ) : (
        <p className="tt-caption">
          {myVote === undefined
            ? 'You have no vote in this. §14.2'
            : `You voted ${myVote ? 'yes' : 'no'}. Votes cannot be changed. §15`}
        </p>
      )}

      <p className="tt-caption">
        Waiting on:{' '}
        {outstanding.length === 0
          ? 'nobody — counting now'
          : outstanding.map((id) => state.players[id]?.name ?? id).join(', ')}
      </p>
    </Panel>
  );
}
