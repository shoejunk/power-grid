import type { GameDescriptor } from '@tt/core';
import {
  Button,
  IconLink,
  IconPlay,
  IconUsers,
  IconWarning,
  LoadingSpinner,
  springSnappy,
  springSoft,
  staggerContainer,
  staggerItem,
  themeVars,
} from '@tt/ui';
import { motion } from 'framer-motion';

import { ConnectionPill, net, useGameStore } from '@/net';
import { hasGameUi } from '@/games/registry';
import { navigate } from '@/router';

import { useCatalogue } from './catalogue';
import { PortalBackdrop, PortalMark } from './Chrome';
import { AuthControls } from './AuthControls';

/**
 * The front door.
 *
 * Everything on it comes from `GET /api/games` — the shell has no list of
 * titles of its own, so a game added on the server appears here without a
 * client change. Each card wears its own accent, which is the whole point of
 * the theming layer: one design system, several identities, no reskins.
 *
 * Desktop-native by design (quality bar U4/V10): a single frame at 1920 with
 * the hero, the catalogue and the join affordance all visible at once — no
 * oversized touch targets, no wasted half-screen.
 */
export function Portal(): JSX.Element {
  const { games, loading, error } = useCatalogue();
  const auth = useGameStore((state) => state.auth);
  const latestGame = auth.games[0] ?? null;

  return (
    <div className="tt-screen tt-portal">
      <PortalBackdrop />

      <header className="tt-topbar">
        <PortalMark compact />
        <span className="tt-topbar__right">
          <AuthControls />
          <ConnectionPill />
        </span>
      </header>

      <main className="tt-portal__inner">
        <motion.div
          className="tt-portal__hero"
          variants={staggerContainer(0.07, 0.05)}
          initial="hidden"
          animate="visible"
        >
          <motion.span variants={staggerItem} className="tt-overline tt-portal__eyebrow">
            Board games, properly built for the desktop
          </motion.span>

          <motion.h1 variants={staggerItem} className="tt-portal__title">
            <PortalMark />
          </motion.h1>

          <motion.p variants={staggerItem} className="tt-portal__tagline">
            Persistent tables you can walk away from. Close the tab mid-auction, come back
            tomorrow, and your seat &mdash; your money, your board, your turn &mdash; is exactly
            where you left it.
          </motion.p>

          <motion.div variants={staggerItem} className="tt-portal__actions">
            {latestGame ? (
              <Button
                variant="live"
                size="lg"
                icon={<IconPlay />}
                onClick={() => net.resumeGame(latestGame.gameId)}
                title={`Resume ${latestGame.gameKey} · ${latestGame.code}`}
              >
                Resume latest game
              </Button>
            ) : null}
            {auth.required && !auth.account ? (
              <Button variant="live" size="lg" icon={<IconUsers />} onClick={() => net.login()}>
                Sign in to play
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              icon={<IconLink />}
              onClick={() => navigate({ name: 'join', code: null })}
            >
              Join with a code
            </Button>
          </motion.div>

          {auth.account && auth.games.length > 0 ? (
            <motion.div variants={staggerItem} className="tt-account-games">
              <span className="tt-overline">Your tables</span>
              {auth.games.map((game) => (
                <button
                  key={game.gameId}
                  type="button"
                  className="tt-account-game"
                  onClick={() => net.resumeGame(game.gameId)}
                >
                  <span>
                    <strong>{game.gameKey}</strong>
                    <small>
                      {game.code} · {game.playerName}
                    </small>
                  </span>
                  <span>{game.started ? 'Resume' : 'Open lobby'}</span>
                </button>
              ))}
            </motion.div>
          ) : null}
        </motion.div>

        <section className="tt-portal__catalogue" aria-label="Games">
          <div className="tt-portal__cataloguehead">
            <h2 className="tt-h3">Choose a table</h2>
            <span className="tt-caption">
              {loading ? 'Loading the catalogue…' : `${games.length} games on this server`}
            </span>
          </div>

          {loading ? (
            <div className="tt-portal__loading">
              <LoadingSpinner size="lg" label="Loading games" />
            </div>
          ) : error !== null ? (
            <div className="tt-inline-error" role="alert">
              <IconWarning />
              <span>
                <strong>Catalogue unavailable</strong> &mdash; {error}
              </span>
            </div>
          ) : (
            <motion.ul
              className="tt-gamegrid"
              variants={staggerContainer(0.08, 0.14)}
              initial="hidden"
              animate="visible"
            >
              {games.map((game) => (
                <GameCard key={game.key} game={game} />
              ))}
            </motion.ul>
          )}
        </section>
      </main>

      <footer className="tt-portal__footer">
        <span className="tt-overline">Server-authoritative &middot; Reconnect-safe</span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

function GameCard({ game }: { game: GameDescriptor }): JSX.Element {
  /* A game whose UI has not landed is advertised honestly rather than hidden:
     the server would happily seat a table it cannot draw. */
  const playable = hasGameUi(game.key);

  return (
    <motion.li variants={staggerItem} className="tt-gamecard-wrap">
      <motion.button
        type="button"
        className="tt-gamecard"
        style={themeVars(game.theme)}
        onClick={() => navigate({ name: 'game', gameKey: game.key })}
        whileHover={{ y: -6 }}
        whileTap={{ scale: 0.99 }}
        transition={springSnappy}
        aria-label={`${game.name} — ${game.tagline}`}
      >
        {/* The accent bloom is the card's whole identity, so it is drawn from
            the descriptor rather than from a per-game stylesheet. */}
        <span className="tt-gamecard__wash" aria-hidden="true" />
        <span className="tt-gamecard__rule" aria-hidden="true" />

        <span className="tt-gamecard__head">
          <span className="tt-gamecard__name">{game.name}</span>
          <span className="tt-gamecard__tagline">{game.tagline}</span>
        </span>

        <span className="tt-gamecard__blurb">{game.blurb}</span>

        <span className="tt-gamecard__facts">
          <span className="tt-gamecard__fact">
            <IconUsers />
            <b className="tt-numeral">
              {game.minPlayers}&ndash;{game.maxPlayers}
            </b>
            <em>players</em>
          </span>
          <span className="tt-gamecard__fact">
            <b className="tt-numeral">{game.playTime}</b>
            <em>typical</em>
          </span>
          {/* One pip per seat. Drawn in the game's accent rather than in its
              real seat colours: those live in the game's own module, and
              loading two rules engines to decorate a card is not a trade
              worth making. */}
          <span className="tt-gamecard__seats" aria-hidden="true">
            {game.seatColors.map((color, index) => (
              <i key={color} style={{ opacity: 1 - index * 0.11 }} />
            ))}
          </span>
        </span>

        <motion.span className="tt-gamecard__cta" transition={springSoft}>
          {playable ? 'Set up a table' : 'In development'}
          <IconPlay />
        </motion.span>
      </motion.button>
    </motion.li>
  );
}
