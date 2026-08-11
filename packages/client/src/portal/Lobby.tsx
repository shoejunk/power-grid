import type { LobbySeat } from '@tt/core';
import {
  Badge,
  Button,
  ColorPicker,
  ConfirmDialog,
  IconButton,
  IconCheck,
  IconCopy,
  IconCrown,
  IconLogout,
  IconPlay,
  IconRobot,
  IconTrash,
  IconUsers,
  LoadingSpinner,
  Panel,
  PlayerChip,
  springSnappy,
  springSoft,
  staggerContainer,
  staggerItem,
  TextInput,
  Tooltip,
  type SeatColorOption,
} from '@tt/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGameUi } from '@/games/registry';
import type { GameUiModule } from '@/games/types';
import { ConnectionPill, net, selectIsHost, selectMyLobbyPlayer, useGameStore } from '@/net';

import { PortalBackdrop, PortalMark } from './Chrome';

/**
 * Pre-game lobby — the same screen for every game on the site.
 *
 * Three columns at 1920: the roster (the thing everyone is watching), the
 * shareable code plus host controls, and the settings. Everything a host might
 * need is on one screen — no menus, no scrolling (quality bar V10).
 *
 * The only game-specific thing on it is whatever the game contributes into the
 * settings slot. Seat bounds come from `LobbyState`, seat colours from the
 * game's published palette, and presence from the lobby itself — which is the
 * platform's source of truth, not the game state's copy of it.
 */
export function Lobby(): JSX.Element {
  const lobby = useGameStore((s) => s.lobby);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const isHost = useGameStore(selectIsHost);
  const me = useGameStore(selectMyLobbyPlayer);
  const pushToast = useGameStore((s) => s.pushToast);
  const { module } = useGameUi(lobby?.gameKey ?? null);

  const [copied, setCopied] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  const copyCode = useCallback(async () => {
    if (!lobby) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${lobby.code}`);
      setCopied(true);
      pushToast({ tone: 'success', title: 'Invite link copied', message: lobby.code });
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

  const takenColors = useMemo(() => (lobby?.players ?? []).map((p) => p.color), [lobby]);

  if (!lobby) {
    return (
      <div className="tt-screen tt-lobby">
        <PortalBackdrop />
        <LoadingSpinner size="lg" label="Joining lobby" />
      </div>
    );
  }

  const seated = lobby.players.length;
  /*
   * How many seats this table actually accepts.
   *
   * `maxPlayers` is the game's ceiling; a game that lets the host size the
   * table down publishes the narrower number through `seatCapacity` — the same
   * method the server uses when it decides whether `startGame` is allowed. Ask
   * rather than assume, and the shell never advertises a seat that start would
   * then refuse.
   */
  const capacity = Math.min(
    lobby.maxPlayers,
    module?.seatCapacity?.(lobby.settings) ?? lobby.maxPlayers,
  );
  const seatsLeft = Math.max(0, capacity - seated);
  const allReady = lobby.players.every((p) => p.ready || p.isBot || p.id === lobby.hostId);
  const canStart = isHost && seated >= lobby.minPlayers && seatsLeft === 0 && allReady;

  const startBlockedReason = !isHost
    ? 'Only the host can start the game.'
    : seated < lobby.minPlayers
      ? `This game needs at least ${lobby.minPlayers} players.`
      : seatsLeft > 0
        ? `Waiting for ${seatsLeft} more ${seatsLeft === 1 ? 'player' : 'players'}.${
            module?.descriptor.supportsBots ? ' Add a bot to fill a seat.' : ''
          }`
        : !allReady
          ? 'Every seated player must be ready first.'
          : undefined;

  const seatOptions: readonly SeatColorOption[] =
    module?.seatColors ?? lobby.players.map((p) => ({ id: p.color }));

  return (
    <div className="tt-screen tt-lobby">
      <PortalBackdrop />

      <header className="tt-topbar">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconLogout />}
          onClick={() => setLeaveDialogOpen(true)}
        >
          Leave
        </Button>
        <PortalMark compact />
        <ConnectionPill />
      </header>

      <motion.main
        className="tt-lobby__grid"
        variants={staggerContainer(0.06, 0.04)}
        initial="hidden"
        animate="visible"
      >
        {/* ------------------ roster ------------------ */}
        <motion.section variants={staggerItem} className="tt-lobby__roster">
          <Panel
            padding="none"
            title="Players"
            subtitle={`${seated} of ${capacity} seats filled`}
            actions={
              <Badge tone={seatsLeft === 0 ? 'success' : 'warning'} dot>
                {seatsLeft === 0 ? 'Table full' : `${seatsLeft} open`}
              </Badge>
            }
            className="tt-lobby__rosterpanel"
          >
            <ul className="tt-lobby__list">
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
                      seatOptions={seatOptions}
                      module={module}
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
                  <div className="tt-seat tt-seat--empty">
                    <span className="tt-seat__slot tt-numeral">
                      {String(seated + i + 1).padStart(2, '0')}
                    </span>
                    <span className="tt-seat__waiting">Waiting for a player…</span>
                    {isHost && module?.descriptor.supportsBots === true ? (
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

          <div className="tt-lobby__readybar">
            <div className="tt-lobby__readyhint">
              <IconCheck />
              <span className="tt-caption">
                {allReady
                  ? 'Everyone is ready.'
                  : `${
                      lobby.players.filter(
                        (p) => !p.ready && !p.isBot && p.id !== lobby.hostId,
                      ).length
                    } player(s) not ready.`}
              </span>
            </div>

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
        <motion.section variants={staggerItem} className="tt-lobby__share">
          <Panel title="Invite" subtitle="Anyone with this code can take a seat">
            <div className="tt-gamecode">
              <span
                className="tt-gamecode__value"
                aria-label={`Game code ${lobby.code.split('').join(' ')}`}
              >
                {lobby.code}
              </span>
              <IconButton
                label={copied ? 'Copied' : 'Copy invite link'}
                icon={copied ? <IconCheck /> : <IconCopy />}
                size="lg"
                onClick={() => void copyCode()}
              />
            </div>
            <p className="tt-caption tt-lobby__sharenote">
              Your seat is bound to this code. Close the tab, come back, and you resume exactly
              where you left off.
            </p>
          </Panel>

          <Panel title="Start" subtitle="Host controls">
            <div className="tt-lobby__hostrow">
              <Button
                variant="secondary"
                icon={<IconRobot />}
                disabled={
                  !isHost || seatsLeft === 0 || module?.descriptor.supportsBots !== true
                }
                onClick={() => net.addBot()}
                title={
                  !isHost
                    ? 'Only the host can add bots'
                    : module?.descriptor.supportsBots !== true
                      ? 'This game does not support automated seats'
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
                onClick={() => void copyCode()}
                title="Copy the invite link to share"
              >
                Invite
              </Button>
            </div>

            <Tooltip
              placement="top"
              title={canStart ? 'Begin' : 'Not yet'}
              content={startBlockedReason ?? 'All seats filled and everyone is ready.'}
            >
              <div className="tt-lobby__startwrap">
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
              <p className="tt-caption tt-lobby__blocked">{startBlockedReason}</p>
            ) : null}
          </Panel>
        </motion.section>

        {/* ------------------ settings ------------------ */}
        <motion.section variants={staggerItem} className="tt-lobby__settings">
          <Panel
            title="Setup"
            subtitle={`${module?.descriptor.name ?? 'Game'} options`}
            ticks
            actions={isHost ? <Badge tone="accent">Host can edit</Badge> : null}
          >
            <LobbySettings isHost={isHost} module={module} />
          </Panel>
        </motion.section>
      </motion.main>

      <ConfirmDialog
        open={leaveDialogOpen}
        onCancel={() => setLeaveDialogOpen(false)}
        onConfirm={() => {
          setLeaveDialogOpen(false);
          net.leaveGame();
        }}
        title="Leave this table?"
        description="You will leave the lobby and give up your seat at this table."
        confirmLabel="Leave table"
        confirmVariant="danger"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Settings slot
 * ------------------------------------------------------------------ */

/**
 * The game's own options, or a read-only summary of them.
 *
 * The host gets the editor; everyone else gets the summary, because settings
 * are host-owned on the wire and a control nobody may use is worse than no
 * control at all (quality bar U2).
 */
function LobbySettings({
  isHost,
  module,
}: {
  isHost: boolean;
  module: GameUiModule | null;
}): JSX.Element {
  const lobby = useGameStore((s) => s.lobby);
  if (!lobby || !module) return <LoadingSpinner label="Loading setup" />;

  const Summary = module.SettingsSummary;
  const Settings = module.Settings;

  if (!isHost && Summary) return <Summary settings={lobby.settings} />;
  if (Settings) {
    return (
      <Settings
        settings={lobby.settings}
        seatCount={lobby.players.length}
        onChange={(patch) => net.updateSettings(patch)}
        disabled={!isHost || lobby.started}
      />
    );
  }
  return <p className="tt-caption">This game has no options to set.</p>;
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

  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    net.chat(text);
    setDraft('');
  };

  // Keep the newest line in view without yanking the page around.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length]);

  return (
    <Panel
      padding="tight"
      title="Table talk"
      subtitle={lines.length === 0 ? 'Say hello' : `${lines.length} messages`}
      className="tt-lobby__chat"
    >
      <div className="tt-lobby__chatlog" ref={scrollRef} role="log" aria-live="polite">
        {lines.length === 0 ? (
          <p className="tt-caption tt-lobby__chatempty">
            Messages you send here are visible to everyone at the table.
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="tt-chatline" data-me={line.from === myPlayerId}>
              <span className="tt-chatline__name">{line.name}</span>
              <span className="tt-chatline__text">{line.text}</span>
            </div>
          ))
        )}
      </div>

      <form
        className="tt-lobby__chatform"
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
  player: LobbySeat;
  index: number;
  isMe: boolean;
  isHost: boolean;
  takenColors: readonly string[];
  seatOptions: readonly SeatColorOption[];
  module: GameUiModule | null;
}

function SeatRow({
  player,
  index,
  isMe,
  isHost,
  takenColors,
  seatOptions,
  module,
}: SeatRowProps): JSX.Element {
  const option = seatOptions.find((o) => o.id === player.color);

  return (
    <div className="tt-seat" data-me={isMe} data-player-color={player.color}>
      <span className="tt-seat__slot tt-numeral">{String(index + 1).padStart(2, '0')}</span>

      <PlayerChip
        name={player.name}
        color={player.color}
        tint={option?.tint}
        colorLabel={option?.label}
        sigil={module?.seatSigil?.(player.color)}
        connected={player.isBot ? true : player.connected}
        active={isMe}
        meta={
          player.isBot ? 'Automated opponent' : player.connected ? 'Connected' : 'Reconnecting…'
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
        className="tt-seat__chip"
      />

      <div className="tt-seat__right">
        {isMe ? (
          <ColorPicker
            value={player.color}
            options={seatOptions}
            taken={takenColors}
            onChange={(color) => net.setColor(color)}
          />
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
