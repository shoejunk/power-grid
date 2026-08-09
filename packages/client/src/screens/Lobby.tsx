import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LobbyPlayer, PlayerColor } from '@pg/shared';

import { MAP_PRESENTATION, MapThumbnail } from '../data/maps';
import { END_GAME_CITIES, RULES, STEP2_CITIES, ZONE_AREAS } from '../data/rules';
import { net, selectIsHost, selectMyLobbyPlayer, useGameStore } from '../net';
import { springSnappy, springSoft, staggerContainer, staggerItem } from '../styles/motion';
import {
  Badge,
  Button,
  ColorPicker,
  ConnectionPill,
  Hint,
  IconButton,
  IconBolt,
  IconCheck,
  IconCopy,
  IconCrown,
  IconLogout,
  IconPlay,
  IconPlus,
  IconRobot,
  IconTrash,
  IconUsers,
  LoadingSpinner,
  Panel,
  PlayerChip,
  TextInput,
  Tooltip,
} from '../ui';
import { AmbientBackdrop, Wordmark } from '../ui/Artwork';

/**
 * Pre-game lobby.
 *
 * Three columns at 1920: the roster (the thing everyone is watching), the
 * shareable code + host controls, and a settings summary that spells out the
 * consequences of the chosen configuration. Everything a host might need is on
 * one screen — no menus, no scrolling (quality bar V10).
 */
export function Lobby(): JSX.Element {
  const lobby = useGameStore((s) => s.lobby);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const isHost = useGameStore(selectIsHost);
  const me = useGameStore(selectMyLobbyPlayer);
  const pushToast = useGameStore((s) => s.pushToast);

  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(async () => {
    if (!lobby) return;
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      pushToast({ tone: 'success', title: 'Code copied', message: lobby.code });
    } catch {
      // Clipboard can be blocked by permissions policy — the code is on screen
      // in 40px type either way, so this is a nicety, not a failure path.
      pushToast({
        tone: 'warning',
        title: 'Could not copy',
        message: `Share the code manually: ${lobby.code}`,
      });
    }
  }, [lobby, pushToast]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const takenColors = useMemo<PlayerColor[]>(
    () => (lobby?.players ?? []).map((p) => p.color),
    [lobby],
  );

  if (!lobby) {
    return (
      <div className="pg-screen pg-lobby">
        <AmbientBackdrop />
        <LoadingSpinner size="lg" label="Joining lobby" />
      </div>
    );
  }

  const settings = lobby.settings;
  const map = MAP_PRESENTATION[settings.mapId];
  const seated = lobby.players.length;
  const seatsLeft = Math.max(0, settings.playerCount - seated);
  const allReady = lobby.players.every((p) => p.ready || p.isBot);
  const canStart = isHost && seatsLeft === 0 && allReady;

  const startBlockedReason = !isHost
    ? 'Only the host can start the game.'
    : seatsLeft > 0
      ? `Waiting for ${seatsLeft} more ${seatsLeft === 1 ? 'player' : 'players'}. Add a bot to fill a seat.`
      : !allReady
        ? 'Every seated player must be ready first.'
        : undefined;

  return (
    <div className="pg-screen pg-lobby">
      <AmbientBackdrop />

      <header className="pg-topbar">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconLogout />}
          onClick={() => net.leaveGame()}
        >
          Leave
        </Button>
        <Wordmark compact />
        <ConnectionPill />
      </header>

      <motion.main
        className="pg-lobby__grid"
        variants={staggerContainer(0.06, 0.04)}
        initial="hidden"
        animate="visible"
      >
        {/* ------------------ roster ------------------ */}
        <motion.section variants={staggerItem} className="pg-lobby__roster">
          <Panel
            padding="none"
            title="Players"
            subtitle={`${seated} of ${settings.playerCount} seats filled`}
            actions={
              <Badge tone={seatsLeft === 0 ? 'success' : 'warning'} dot>
                {seatsLeft === 0 ? 'Table full' : `${seatsLeft} open`}
              </Badge>
            }
            className="pg-lobby__rosterpanel"
          >
            <ul className="pg-lobby__list">
              <AnimatePresence initial={false}>
                {lobby.players.map((player, index) => (
                  <motion.li
                    key={player.id}
                    layout
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={springSoft}
                  >
                    <SeatRow
                      player={player}
                      index={index}
                      isMe={player.id === myPlayerId}
                      isHost={isHost}
                      takenColors={takenColors}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>

              {/* Empty seats are rendered explicitly so the table always looks
                  like a table, and the host sees exactly what is missing. */}
              {Array.from({ length: seatsLeft }, (_, i) => (
                <motion.li
                  key={`empty-${i}`}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={springSoft}
                >
                  <div className="pg-seat pg-seat--empty">
                    <span className="pg-seat__slot pg-numeral">
                      {String(seated + i + 1).padStart(2, '0')}
                    </span>
                    <span className="pg-seat__waiting">Waiting for a player…</span>
                    {isHost ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<IconRobot />}
                        onClick={() => net.addBot()}
                      >
                        Add bot
                      </Button>
                    ) : null}
                  </div>
                </motion.li>
              ))}
            </ul>
          </Panel>

          <LobbyChat />

          <div className="pg-lobby__readybar">
            <Tooltip {...RULES.ready!} placement="top">
              <div className="pg-lobby__readyhint">
                <IconCheck />
                <span className="pg-caption">
                  {allReady
                    ? 'Everyone is ready.'
                    : `${lobby.players.filter((p) => !p.ready && !p.isBot).length} player(s) not ready.`}
                </span>
              </div>
            </Tooltip>

            <Button
              variant={me?.ready === true ? 'secondary' : 'live'}
              size="lg"
              icon={<IconCheck />}
              onClick={() => net.setReady(!(me?.ready ?? false))}
            >
              {me?.ready === true ? 'Not ready' : "I'm ready"}
            </Button>
          </div>
        </motion.section>

        {/* ------------------ share + start ------------------ */}
        <motion.section variants={staggerItem} className="pg-lobby__share">
          <Panel
            title="Invite"
            subtitle="Anyone with this code can take a seat"
            actions={<Hint {...RULES.gameCode!} placement="left" />}
          >
            <div className="pg-gamecode">
              <span className="pg-gamecode__value" aria-label={`Game code ${lobby.code.split('').join(' ')}`}>
                {lobby.code}
              </span>
              <IconButton
                label={copied ? 'Copied' : 'Copy game code'}
                icon={copied ? <IconCheck /> : <IconCopy />}
                size="lg"
                onClick={() => void copyCode()}
              />
            </div>
            <p className="pg-caption pg-lobby__sharenote">
              Your seat is bound to this code. Close the tab, come back, and you resume
              exactly where you left off.
            </p>
          </Panel>

          <Panel title="Start" subtitle="Host controls">
            <div className="pg-lobby__hostrow">
              <Button
                variant="secondary"
                icon={<IconRobot />}
                disabled={!isHost || seatsLeft === 0}
                onClick={() => net.addBot()}
                title={
                  !isHost
                    ? 'Only the host can add bots'
                    : seatsLeft === 0
                      ? 'Every seat is filled'
                      : undefined
                }
              >
                Add bot
              </Button>
              <Button
                variant="ghost"
                icon={<IconUsers />}
                disabled={!isHost}
                onClick={() =>
                  net.updateSettings({ playerCount: Math.min(6, settings.playerCount + 1) })
                }
                title={isHost ? 'Open one more seat' : 'Only the host can change settings'}
              >
                Add seat
              </Button>
            </div>

            <Tooltip
              placement="top"
              title={canStart ? 'Begin' : 'Not yet'}
              content={startBlockedReason ?? 'All seats filled and everyone is ready.'}
              rule="§2 Setup requirements"
            >
              <div className="pg-lobby__startwrap">
                <Button
                  variant="primary"
                  size="lg"
                  block
                  icon={<IconPlay />}
                  disabled={!canStart}
                  onClick={() => net.startGame()}
                >
                  Start game
                </Button>
              </div>
            </Tooltip>

            {startBlockedReason !== undefined ? (
              <p className="pg-caption pg-lobby__blocked">{startBlockedReason}</p>
            ) : null}
          </Panel>

          {/* Sets expectations before the board appears, and keeps the middle
              column from ending in dead space. */}
          <Panel
            title="What happens next"
            subtitle="Setup runs in this order"
            className="pg-lobby__next"
            ticks
          >
            <ol className="pg-phaselist">
              <li className="pg-phaselist__item">
                <span className="pg-phaselist__index pg-numeral">01</span>
                <span className="pg-phaselist__body">
                  <span className="pg-phaselist__name">Playing zone</span>
                  <span className="pg-phaselist__summary">
                    {ZONE_AREAS[settings.playerCount] ?? 3} contiguous areas are chosen randomly.
                    Nothing outside them can be used all game — not even as a route.
                  </span>
                </span>
              </li>
              {settings.experiencedStart ? (
                <li className="pg-phaselist__item">
                  <span className="pg-phaselist__index pg-numeral">02</span>
                  <span className="pg-phaselist__body">
                    <span className="pg-phaselist__name">Starting cities</span>
                    <span className="pg-phaselist__summary">
                      Each player marks an available city; anyone may claim an unoccupied marker first.
                    </span>
                  </span>
                </li>
              ) : null}
              {settings.againstTheTrust ? (
                <li className="pg-phaselist__item">
                  <span className="pg-phaselist__index pg-numeral">
                    {settings.experiencedStart ? '03' : '02'}
                  </span>
                  <span className="pg-phaselist__body">
                    <span className="pg-phaselist__name">Trust placement</span>
                    <span className="pg-phaselist__summary">
                      Six Trust houses are placed on adjacent cities, alternating between the
                      two players.
                    </span>
                  </span>
                </li>
              ) : null}
              <li className="pg-phaselist__item">
                <span className="pg-phaselist__index pg-numeral">
                  {String(
                    2 + (settings.experiencedStart ? 1 : 0) + (settings.againstTheTrust ? 1 : 0),
                  ).padStart(2, '0')}
                </span>
                <span className="pg-phaselist__body">
                  <span className="pg-phaselist__name">Round 1 &mdash; auction</span>
                  <span className="pg-phaselist__summary">
                    Everyone must buy a plant in the first round. Turn order is random this once.
                  </span>
                </span>
              </li>
            </ol>
          </Panel>
        </motion.section>

        {/* ------------------ settings summary ------------------ */}
        <motion.section variants={staggerItem} className="pg-lobby__settings">
          <Panel title="Setup" subtitle="Game options and automatic setup" ticks>
            <div className="pg-lobby__map">
              <div
                className="pg-lobby__mapart"
                style={{ aspectRatio: String(map.aspectRatio) }}
              >
                <MapThumbnail mapId={map.id} active />
              </div>
              <div>
                <div className="pg-mapcard__name">{map.name}</div>
                <div className="pg-mapcard__blurb">{map.blurb}</div>
              </div>
            </div>

            <dl className="pg-summary">
              <SummaryRow label="Players" value={`${settings.playerCount}`} />
              <SummaryRow
                label="Playing zone"
                value={`${ZONE_AREAS[settings.playerCount] ?? 3} random contiguous areas`}
              />
              <SummaryRow
                label="Step 2 at"
                value={`${STEP2_CITIES[settings.playerCount] ?? 7} cities`}
              />
              <SummaryRow
                label="Game ends at"
                value={`${END_GAME_CITIES[settings.playerCount] ?? 17} cities`}
              />
              <SummaryRow
                label="Experienced start"
                value={settings.experiencedStart ? 'On' : 'Off'}
                tone={settings.experiencedStart ? 'info' : 'neutral'}
              />
              <SummaryRow
                label="Against the Trust"
                value={settings.againstTheTrust ? 'On' : 'Off'}
                tone={settings.againstTheTrust ? 'info' : 'neutral'}
              />
            </dl>

            <div className="pg-lobby__specials">
              {map.specialRules.map((rule) => (
                <div key={rule.title} className="pg-setup__rule">
                  <IconBolt />
                  <div>
                    <strong>{rule.title}</strong>
                    <p>{rule.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </motion.section>
      </motion.main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

/**
 * Table chat.
 *
 * Occupies the space under the roster so the left column reads as a full
 * column rather than a list floating above a void, and gives the lobby a
 * reason to exist beyond waiting. Backed by the `chat` channel already in the
 * wire protocol.
 */
function LobbyChat(): JSX.Element {
  const lines = useGameStore((s) => s.chat);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view without yanking the page around.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length]);

  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    net.chat(text);
    setDraft('');
  };

  return (
    <Panel
      padding="tight"
      title="Table talk"
      subtitle={lines.length === 0 ? 'Say hello' : `${lines.length} messages`}
      className="pg-lobby__chat"
    >
      <div className="pg-lobby__chatlog" ref={scrollRef} role="log" aria-live="polite">
        {lines.length === 0 ? (
          <p className="pg-caption pg-lobby__chatempty">
            Messages you send here are visible to everyone at the table.
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="pg-chatline" data-me={line.from === myPlayerId}>
              <span className="pg-chatline__name">{line.name}</span>
              <span className="pg-chatline__text">{line.text}</span>
            </div>
          ))
        )}
      </div>

      <form
        className="pg-lobby__chatform"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <TextInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the table…"
          maxLength={200}
          aria-label="Chat message"
        />
        <Button type="submit" variant="secondary" disabled={draft.trim().length === 0}>
          Send
        </Button>
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Seat row
 * ------------------------------------------------------------------ */

interface SeatRowProps {
  player: LobbyPlayer;
  index: number;
  isMe: boolean;
  isHost: boolean;
  takenColors: readonly PlayerColor[];
}

function SeatRow({ player, index, isMe, isHost, takenColors }: SeatRowProps): JSX.Element {
  return (
    <div className="pg-seat" data-me={isMe} data-player-color={player.color}>
      <span className="pg-seat__slot pg-numeral">{String(index + 1).padStart(2, '0')}</span>

      <PlayerChip
        name={player.name}
        color={player.color}
        connected={player.isBot ? true : player.connected}
        active={isMe}
        meta={
          player.isBot
            ? 'Automated opponent'
            : player.connected
              ? 'Connected'
              : 'Reconnecting…'
        }
        tags={
          <>
            {player.isHost ? (
              <Badge tone="accent" icon={<IconCrown />}>
                Host
              </Badge>
            ) : null}
            {player.isBot ? (
              <Badge tone="neutral" icon={<IconRobot />}>
                Bot
              </Badge>
            ) : null}
            {isMe ? <Badge tone="info">You</Badge> : null}
          </>
        }
        className="pg-seat__chip"
      />

      <div className="pg-seat__right">
        {isMe ? (
          <Tooltip {...RULES.colour!} placement="left">
            <div>
              <ColorPicker
                value={player.color}
                taken={takenColors}
                onChange={(color) => net.setColor(color)}
              />
            </div>
          </Tooltip>
        ) : null}

        <motion.div
          animate={player.ready || player.isBot ? { scale: [1, 1.12, 1] } : { scale: 1 }}
          transition={springSnappy}
        >
          <Badge tone={player.ready || player.isBot ? 'success' : 'neutral'} dot size="lg">
            {player.ready || player.isBot ? 'Ready' : 'Waiting'}
          </Badge>
        </motion.div>

        {isHost && !isMe ? (
          <IconButton
            label={`Remove ${player.name}`}
            icon={player.isBot ? <IconTrash /> : <IconLogout />}
            size="sm"
            danger
            bare
            onClick={() => net.removePlayer(player.id)}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Summary row
 * ------------------------------------------------------------------ */

function SummaryRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'info';
}): JSX.Element {
  return (
    <div className="pg-summary__row">
      <dt className="pg-summary__label">{label}</dt>
      <dd className={`pg-summary__value${tone === 'info' ? ' is-on' : ''}`}>
        {tone === 'info' ? <IconPlus /> : null}
        {value}
      </dd>
    </div>
  );
}
