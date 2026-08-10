import { descriptor, SEAT_COLOR_HEX } from '@game/dead-of-winter';
import { Badge, Panel } from '@tt/ui';
import { motion } from 'framer-motion';

import type { GameUiModule } from '../types';

/**
 * Dead of Winter — mount point.
 *
 * The rules package exists and the server will host a table for it; the
 * interface does not exist yet. Until it does, this module exists so that
 * `registry.ts` has something to point at and the portal can advertise the
 * game honestly rather than pretending it is not coming.
 *
 * See ./README.md for what replacing this involves.
 */

/** Seat swatches, so the platform lobby can already paint this game's seats. */
const seatColors = descriptor.seatColors.map((id) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  tint: {
    base: SEAT_COLOR_HEX[id as keyof typeof SEAT_COLOR_HEX],
    ink: '#0b0f14',
  },
}));

function ComingSoon(): JSX.Element {
  return (
    <div className="tt-screen">
      <div className="dow-soon">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        >
          <Panel
            tone="glass"
            padding="roomy"
            ticks
            title={descriptor.name}
            subtitle={descriptor.tagline}
            actions={<Badge tone="warning">In development</Badge>}
            className="dow-soon__panel"
          >
            <p className="tt-lead">{descriptor.blurb}</p>
            <dl className="tt-summary">
              <div className="tt-summary__row">
                <dt className="tt-summary__label">Players</dt>
                <dd className="tt-summary__value">
                  {descriptor.minPlayers}&ndash;{descriptor.maxPlayers}
                </dd>
              </div>
              <div className="tt-summary__row">
                <dt className="tt-summary__label">Play time</dt>
                <dd className="tt-summary__value">{descriptor.playTime}</dd>
              </div>
              <div className="tt-summary__row">
                <dt className="tt-summary__label">Status</dt>
                <dd className="tt-summary__value">Rules engine in progress</dd>
              </div>
            </dl>
            <p className="tt-caption dow-soon__note">
              The colony is being built. Come back for the first winter.
            </p>
          </Panel>
        </motion.div>
      </div>
    </div>
  );
}

const deadOfWinterUi: GameUiModule = {
  descriptor,
  comingSoon: true,
  defaultSettings: () => ({}),
  seatColors,
  Match: ComingSoon,
};

export default deadOfWinterUi;
