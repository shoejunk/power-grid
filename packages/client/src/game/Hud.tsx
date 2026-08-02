import { motion } from 'framer-motion';
import type { Player } from '@pg/shared';
import { END_GAME_THRESHOLD, MAX_PLANTS_PER_PLAYER, STEP2_THRESHOLD } from '@pg/shared';

import { springSnappy, springSoft } from '../styles/motion';
import { Avatar, Badge, Money, Tooltip } from '../ui';
import { STATUS_META, plural } from './format';
import { orderedPlayers, useMatch } from './model';
import { PlantCard } from './parts/PlantCard';

/**
 * The persistent heads-up display: one card per seat, always on screen.
 *
 * Carries everything §1 calls a player's inventory — money, plants with the fuel
 * stored on them, connected cities, houses left — plus the seat's position in
 * this round's order (§4). The acting seat is unmistakable: a moving copper rail
 * (`layoutId`) slides to it, the card lifts, and its border takes the seat
 * colour (quality bar U1).
 */
export function PlayerHud(): JSX.Element {
  const { state, meId } = useMatch();
  const players = orderedPlayers(state).filter((p) => !p.isTrust);

  return (
    <div className="pg-ghud" role="list" aria-label="Players">
      {players.map((player, index) => (
        <HudCard
          key={player.id}
          player={player}
          position={index + 1}
          isMe={player.id === meId}
          isActing={state.activePlayerId === player.id}
        />
      ))}
    </div>
  );
}

function HudCard({
  player,
  position,
  isMe,
  isActing,
}: {
  player: Player;
  position: number;
  isMe: boolean;
  isActing: boolean;
}): JSX.Element {
  const { state } = useMatch();
  const count = state.settings.playerCount;
  const step2At = STEP2_THRESHOLD[count] ?? 7;
  const endAt = END_GAME_THRESHOLD[count] ?? 17;
  // Only one seat is ever "acting": the one the engine is actually waiting on.
  // A stale `acting` marker on anyone else reads as Eligible.
  const effective = !isActing && player.phaseStatus === 'acting' ? 'eligible' : player.phaseStatus;
  const status = STATUS_META[effective];
  const cities = player.cities.length;

  return (
    <motion.div
      className="pg-ghudcard"
      role="listitem"
      data-player-color={player.color}
      data-acting={isActing}
      data-me={isMe}
      layout
      animate={{ y: isActing ? -2 : 0 }}
      transition={springSoft}
    >
      {isActing ? (
        <motion.span className="pg-ghudcard__rail" layoutId="pg-acting-rail" transition={springSnappy} />
      ) : null}

      <div className="pg-ghudcard__head">
        <Tooltip
          placement="bottom"
          title={`Position ${position} of ${state.playerOrder.length}`}
          rule="§4 Player order"
          content="Player order is recomputed every round: most connected cities first, with the highest-numbered owned plant breaking ties. Phases 3 and 4 run in reverse."
        >
          <span className="pg-ghudcard__pos pg-numeral" tabIndex={0}>
            {position}
          </span>
        </Tooltip>
        <Avatar name={player.name} color={player.color} size="sm" connected={player.connected} glow={isActing} />
        <span className="pg-ghudcard__name">{player.name}</span>
        {isMe ? (
          <Badge tone="accent" solid>
            You
          </Badge>
        ) : null}
        <Tooltip placement="bottom" title={status.label} rule="§4 Player order" content={status.note}>
          <span className="pg-ghudcard__status" data-status={isActing ? 'acting' : effective} tabIndex={0}>
            {isActing ? 'Acting' : status.label}
          </span>
        </Tooltip>
      </div>

      <div className="pg-ghudcard__body">
        <div className="pg-ghudcard__stats">
          <Money value={player.money} size="md" label={`${player.name} balance`} />
          <Tooltip
            placement="bottom"
            title={`${cities} connected ${plural(cities, 'city', 'cities')}`}
            rule="§10 Step 2, §11 End of game"
            content={`Step 2 begins once any player reaches ${step2At} cities with ${count} players; the game ends after Phase 4 once any player reaches ${endAt}. ${player.housesRemaining} houses remain in supply.`}
          >
            <span className="pg-ghudcard__cities" tabIndex={0}>
              <span className="pg-numeral">{cities}</span>
              <span className="pg-ghudcard__citieslabel">cities</span>
              <span className="pg-ghudcard__meter" aria-hidden="true">
                <motion.span
                  className="pg-ghudcard__meterfill"
                  animate={{ width: `${Math.min(100, (cities / endAt) * 100)}%` }}
                  transition={springSoft}
                />
                <span className="pg-ghudcard__mark" style={{ left: `${(step2At / endAt) * 100}%` }} />
              </span>
            </span>
          </Tooltip>
        </div>

        <div className="pg-ghudcard__plants">
          {player.plants.length === 0 ? (
            <span className="pg-ghudcard__noplants pg-caption">No plants</span>
          ) : (
            player.plants
              .slice()
              .sort((a, b) => a.plantId - b.plantId)
              .map((owned) => <PlantCard key={owned.plantId} plantId={owned.plantId} size="xs" owned={owned} />)
          )}
          {player.plants.length > 0 && player.plants.length < MAX_PLANTS_PER_PLAYER ? (
            <span className="pg-ghudcard__slot" aria-hidden="true">
              {MAX_PLANTS_PER_PLAYER - player.plants.length}
            </span>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
