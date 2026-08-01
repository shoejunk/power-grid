import { motion } from 'framer-motion';
import { useState } from 'react';

import { MAP_PRESENTATION, MapThumbnail } from '../data/maps';
import {
  END_GAME_CITIES,
  HOUSES_PER_PLAYER,
  MAX_PLANTS_PER_PLAYER,
  PHASES,
  STARTING_MONEY,
} from '../data/rules';
import { loadSessionToken, net, useGameStore } from '../net';
import { springSoft, staggerContainer, staggerItem } from '../styles/motion';
import {
  Badge,
  Button,
  ConnectionPill,
  IconBolt,
  IconBook,
  IconLink,
  IconPlay,
  IconPlus,
  IconUsers,
  Modal,
  Money,
  Panel,
} from '../ui';
import { AmbientBackdrop, Wordmark } from '../ui/Artwork';

/**
 * The landing screen.
 *
 * Desktop-native by design (quality bar U4/V10): a single 1920-wide frame with
 * a hero lockup, the three actions, and a live "what this game is" panel — no
 * oversized touch buttons, no wasted half-screen.
 */
export function MainMenu(): JSX.Element {
  const setRoute = useGameStore((s) => s.setRoute);
  const [howToOpen, setHowToOpen] = useState(false);

  /**
   * A stored session token means the server may still be holding a seat for
   * this browser. We surface "Resume" rather than silently dropping the player
   * back in — they might deliberately want a fresh game.
   */
  const hasSession = loadSessionToken() !== null;

  return (
    <div className="pg-screen pg-menu">
      <AmbientBackdrop pylons grid />

      <div className="pg-menu__inner">
        <motion.div
          className="pg-menu__hero"
          variants={staggerContainer(0.08, 0.1)}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem} className="pg-menu__eyebrow">
            <span className="pg-overline">Friedemann Friese</span>
            <span className="pg-menu__eyebrow-dot" />
            <span className="pg-overline">2&ndash;6 Players</span>
            <span className="pg-menu__eyebrow-dot" />
            <span className="pg-overline">Germany &amp; USA</span>
          </motion.div>

          <Wordmark />

          <motion.p variants={staggerItem} className="pg-menu__tagline">
            Outbid your rivals for power plants, corner the fuel markets, and stretch your
            network across the country. The winner is not the biggest grid &mdash; it is the
            one that can <em>light</em> the most cities.
          </motion.p>

          <motion.div variants={staggerItem} className="pg-menu__actions">
            {hasSession ? (
              <Button
                variant="live"
                size="lg"
                icon={<IconPlay />}
                onClick={() => net.retry()}
                title="Reconnect to the game this browser was last seated in"
              >
                Resume game
              </Button>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              icon={<IconPlus />}
              onClick={() => setRoute('create')}
            >
              Create game
            </Button>

            <Button
              variant="secondary"
              size="lg"
              icon={<IconLink />}
              onClick={() => setRoute('join')}
            >
              Join with code
            </Button>

            <Button
              variant="ghost"
              size="lg"
              icon={<IconBook />}
              onClick={() => setHowToOpen(true)}
            >
              How to play
            </Button>
          </motion.div>

          <motion.div variants={staggerItem} className="pg-menu__stats">
            <div className="pg-stat">
              <span className="pg-stat__value pg-numeral">5</span>
              <span className="pg-stat__label">Phases per round</span>
            </div>
            <div className="pg-rule pg-rule--v" />
            <div className="pg-stat">
              <span className="pg-stat__value">
                <Money value={STARTING_MONEY} size="lg" />
              </span>
              <span className="pg-stat__label">Starting bank</span>
            </div>
            <div className="pg-rule pg-rule--v" />
            <div className="pg-stat">
              <span className="pg-stat__value pg-numeral">{HOUSES_PER_PLAYER}</span>
              <span className="pg-stat__label">Houses each</span>
            </div>
            <div className="pg-rule pg-rule--v" />
            <div className="pg-stat">
              <span className="pg-stat__value pg-numeral">{MAX_PLANTS_PER_PLAYER}</span>
              <span className="pg-stat__label">Plant limit</span>
            </div>
          </motion.div>
        </motion.div>

        <motion.aside
          className="pg-menu__aside"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...springSoft, delay: 0.24 }}
        >
          <Panel
            tone="glass"
            title="The round"
            subtitle="Five phases, in strict order"
            ticks
            className="pg-menu__phases"
          >
            <ol className="pg-phaselist">
              {PHASES.map((phase) => (
                <li key={phase.key} className="pg-phaselist__item">
                  <span className="pg-phaselist__index pg-numeral">
                    {String(phase.index).padStart(2, '0')}
                  </span>
                  <span className="pg-phaselist__body">
                    <span className="pg-phaselist__name">{phase.name}</span>
                    <span className="pg-phaselist__summary">{phase.summary}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel tone="glass" title="Maps" subtitle="Both boards ship complete">
            <div className="pg-menu__maps">
              {Object.values(MAP_PRESENTATION).map((map) => (
                <div key={map.id} className="pg-menu__map">
                  {/* Fixed letterbox rather than the map's own aspect ratio:
                      a portrait Germany next to a landscape USA would make the
                      two rows different heights and break the list rhythm. */}
                  <div className="pg-menu__mapart">
                    <MapThumbnail mapId={map.id} />
                  </div>
                  <div>
                    <div className="pg-menu__map-name">{map.name}</div>
                    <div className="pg-menu__map-meta">
                      {map.cityCount} cities &middot; {map.areaCount} areas
                    </div>
                    <div className="pg-menu__map-rule">{map.specialRules[0]?.title}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            tone="glass"
            title="Variants"
            subtitle="Ship-ready optional rules"
            className="pg-menu__variantspanel"
          >
            <ul className="pg-menu__variants">
              <li>
                <span className="pg-menu__variant-name">Experienced start</span>
                <span className="pg-menu__variant-note">
                  Reserve starting cities before anyone builds.
                </span>
              </li>
              <li>
                <span className="pg-menu__variant-name">Against the Trust</span>
                <span className="pg-menu__variant-note">
                  Two-player mode with an automated blocking faction.
                </span>
              </li>
            </ul>
          </Panel>
        </motion.aside>
      </div>

      <footer className="pg-menu__footer">
        <span className="pg-overline">Power Grid &mdash; Web Edition</span>
        <ConnectionPill />
      </footer>

      <HowToPlay open={howToOpen} onClose={() => setHowToOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * How to play
 * ------------------------------------------------------------------ */

/**
 * A condensed rules primer, reachable from the menu and (later) from the
 * in-game help button. Everything in it is sourced from the gameplay
 * requirements, with section citations, so it never contradicts the engine.
 */
function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="760px"
      title="How to play"
      description="A five-minute primer. Every phase panel in the game restates its own rules, so you can learn as you go."
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="pg-howto">
        <section>
          <h3 className="pg-h4">The goal</h3>
          <p className="pg-body">
            The game ends the moment any player connects{' '}
            <strong>{END_GAME_CITIES[4]} cities</strong> (fewer with more players). But the
            winner is whoever can <em>supply</em> the most cities in the final scoring &mdash;
            you need plants and fuel, not just territory. Ties go to the richest player.
          </p>
          <Badge tone="info" size="lg">
            §11 End of game
          </Badge>
        </section>

        <section>
          <h3 className="pg-h4">A round, step by step</h3>
          <ol className="pg-phaselist pg-phaselist--roomy">
            {PHASES.map((phase) => (
              <li key={phase.key} className="pg-phaselist__item">
                <span className="pg-phaselist__index pg-numeral">
                  {String(phase.index).padStart(2, '0')}
                </span>
                <span className="pg-phaselist__body">
                  <span className="pg-phaselist__name">{phase.name}</span>
                  <span className="pg-phaselist__summary">{phase.summary}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3 className="pg-h4">Three things that catch new players out</h3>
          <ul className="pg-bullets">
            <li>
              <IconBolt />
              <span>
                <strong>Turn order is inverted mid-round.</strong> You auction first if you
                are leading, but you buy resources and build <em>last</em> &mdash; leading
                costs you the good fuel and the cheap city slots.
              </span>
            </li>
            <li>
              <IconUsers />
              <span>
                <strong>A plant powers a fixed number of cities.</strong> Storing double fuel
                does not double output; surplus generation is simply wasted.
              </span>
            </li>
            <li>
              <IconBolt />
              <span>
                <strong>Steps change the board.</strong> Step 2 opens a second house slot in
                every city, Step 3 a third &mdash; and Step 3 removes the future plant market
                entirely.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
