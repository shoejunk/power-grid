import { motion } from 'framer-motion';
import { END_GAME_THRESHOLD, finalStandings, getPlant } from '@pg/shared';

import { springSoft } from '../../styles/motion';
import { Avatar, Badge, Money } from '../../ui';
import { plural } from '../format';
import { useMatch } from '../model';
import { Callout, PhaseShell, Stat, type RuleLine } from './shell';

const END_RULES: readonly RuleLine[] = [
  { text: 'The game ends immediately after Phase 4 once a player reaches the city threshold.', rule: '§11' },
  { text: 'The Phase 5 that follows is a winner evaluation, not a payout — no income is paid.', rule: '§11, §14' },
  { text: 'Each player is scored on how many cities they could supply with the plants and fuel they hold.', rule: '§11' },
  { text: 'The most suppliable cities wins, even if someone else triggered the end. Money breaks ties.', rule: '§11' },
];

/**
 * The winner-evaluation screen (§11).
 *
 * §14 lists "Paying cash during endgame winner evaluation" as an illegal action,
 * so this panel says so in the loudest way it can and shows the calculation
 * instead of a bank transfer.
 */
export function EndgamePanel(): JSX.Element {
  const { state, meId } = useMatch();
  const standings = finalStandings(state);
  const threshold = END_GAME_THRESHOLD[state.settings.playerCount] ?? 17;
  const winner = standings[0] ?? null;
  const trigger = standings.find((row) => row.networkSize >= threshold) ?? null;
  const upset = winner !== null && trigger !== null && winner.playerId !== trigger.playerId;

  return (
    <PhaseShell
      title="Final evaluation"
      subtitle="§11 · the game is over"
      tone="final"
      rules={END_RULES}
      actions={
        <Badge tone="warning" solid>
          No cash paid
        </Badge>
      }
    >
      <Callout tone="warning" title="This phase pays nothing">
        Reaching {threshold} connected cities ended the game after Phase 4. The Phase 5 that follows is a
        winner evaluation only — no income, no payment summary, no bank. <em>§11, §14</em>
      </Callout>

      {standings.length === 0 ? (
        <p className="tt-caption">The evaluation has not been recorded yet.</p>
      ) : (
        <div className="pg-gfinal" role="list">
          {standings.map((row, index) => {
            const player = state.players[row.playerId];
            if (!player) return null;
            const isWinner = state.winnerId === row.playerId;
            return (
              <motion.div
                key={row.playerId}
                className="pg-gfinal__row"
                role="listitem"
                data-player-color={player.color}
                data-winner={isWinner}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...springSoft, delay: index * 0.07 }}
              >
                <span className="pg-gfinal__rank tt-numeral">{index + 1}</span>
                <Avatar name={player.name} color={player.color} size="sm" glow={isWinner} />
                <span className="pg-gfinal__name">
                  {player.name}
                  {row.playerId === meId ? <em>you</em> : null}
                </span>
                <span className="pg-gfinal__calc">
                  <span className="pg-gfinal__big tt-numeral">{row.citiesSupplied}</span>
                  <span className="tt-caption">
                    of {row.networkSize} {plural(row.networkSize, 'city', 'cities')} suppliable
                  </span>
                  <span className="pg-gfinal__plants">
                    {row.plantIds.length === 0
                      ? 'no plant can be operated'
                      : row.plantIds
                          .map((id) => `#${id} (${getPlant(id).cities})`)
                          .join(' + ')}
                  </span>
                </span>
                <Money value={row.money} size="sm" />
                {isWinner ? (
                  <Badge tone="success" solid>
                    Winner
                  </Badge>
                ) : null}
              </motion.div>
            );
          })}
        </div>
      )}

      {upset && winner ? (
        <Callout tone="info" title="The trigger did not win">
          {state.players[trigger!.playerId]?.name ?? 'A player'} reached the {threshold}-city threshold, but{' '}
          {state.players[winner.playerId]?.name ?? 'another player'} can supply more cities — and §11 awards
          the game on supply, not on network size.
        </Callout>
      ) : null}

      <div className="pg-gsummary">
        <Stat label="Threshold" value={<span className="tt-numeral">{threshold}</span>} />
        <Stat label="Rounds played" value={<span className="tt-numeral">{state.round}</span>} />
        <Stat label="Final Step" value={<span className="tt-numeral">{state.step}</span>} />
      </div>
    </PhaseShell>
  );
}
