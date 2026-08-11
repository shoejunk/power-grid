import {
  Badge,
  Button,
  IconChevronLeft,
  IconPlay,
  IconUsers,
  IconWarning,
  LoadingSpinner,
  Panel,
  springSnappy,
  staggerContainer,
  staggerItem,
  TextInput,
} from '@tt/ui';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';

import { useGameUi } from '@/games/registry';
import { ConnectionPill, net, useGameStore } from '@/net';
import { navigate } from '@/router';

import { useDescriptor } from './catalogue';
import { PortalBackdrop, PortalMark } from './Chrome';
import { NotFound } from './NotFound';

/**
 * A game's page: what it is, and the form that seats a table at it.
 *
 * The shell owns the frame, the player's name and the submit button — the
 * things true of every game. Everything below "Setup" is the game's own
 * settings component, rendered into a slot. This file does not know what a
 * map is, and adding a game with completely different options changes nothing
 * here.
 */
export function GameDetail({ gameKey }: { gameKey: string }): JSX.Element {
  const { descriptor, loading: catalogueLoading, error } = useDescriptor(gameKey);
  const { module, loading: moduleLoading } = useGameUi(gameKey);

  const storedName = useGameStore((s) => s.playerName);
  const pending = useGameStore((s) => s.pending);
  const lastError = useGameStore((s) => s.lastError);
  const status = useGameStore((s) => s.connectionStatus);

  const [name, setName] = useState(storedName);
  const [touched, setTouched] = useState(false);
  /*
   * The draft settings, seeded from the game's own defaults the moment its
   * module lands. Held as an opaque bag: the shell merges patches into it and
   * hands the whole thing to `createGame`, and only the game — and then the
   * server's plugin — ever looks inside.
   */
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (module && settings === null) {
      setSettings(module.defaultSettings() as Record<string, unknown>);
    }
  }, [module, settings]);

  const patchSettings = useCallback((patch: unknown) => {
    setSettings((current) => ({ ...current, ...(patch as Record<string, unknown>) }));
  }, []);

  const draft: unknown = settings ?? {};

  if (catalogueLoading || moduleLoading) {
    return (
      <div className="tt-screen">
        <PortalBackdrop />
        <LoadingSpinner size="lg" label="Loading game" />
      </div>
    );
  }

  if (error === null && descriptor === null) return <NotFound path={`/g/${gameKey}`} />;

  /* The catalogue is the authority on what this server hosts, but a network
     blip should not turn a real game into a 404 — fall back to what the
     module itself publishes. */
  const identity = descriptor ?? module?.descriptor ?? null;
  if (identity === null) return <NotFound path={`/g/${gameKey}`} />;

  const nameError = touched && name.trim().length < 2 ? 'Enter at least 2 characters.' : null;
  const comingSoon = module?.comingSoon === true;
  const canSubmit =
    !comingSoon && name.trim().length >= 2 && status === 'connected' && !pending;

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit) return;
    net.createGame(gameKey, name.trim(), draft);
  };

  const Settings = module?.Settings;
  const Detail = module?.Detail;
  const ComingSoonPanel = module?.Match;

  return (
    <div className="tt-screen tt-setup">
      <PortalBackdrop />

      <header className="tt-topbar">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconChevronLeft />}
          onClick={() => navigate({ name: 'portal' })}
        >
          All games
        </Button>
        <PortalMark compact />
        <ConnectionPill />
      </header>

      <motion.main
        className="tt-setup__grid"
        variants={staggerContainer(0.06, 0.04)}
        initial="hidden"
        animate="visible"
      >
        {/* ---------------- identity ---------------- */}
        <motion.div variants={staggerItem} className="tt-setup__col">
          <div className="tt-setup__heading">
            <span className="tt-overline">{identity.tagline}</span>
            <h1 className="tt-h2">{identity.name}</h1>
            <p className="tt-body">{identity.blurb}</p>
          </div>

          <div className="tt-setup__facts">
            <div className="tt-stat">
              <span className="tt-stat__value tt-numeral">
                {identity.minPlayers}&ndash;{identity.maxPlayers}
              </span>
              <span className="tt-stat__label">Players</span>
            </div>
            <div className="tt-rule tt-rule--v" />
            <div className="tt-stat">
              <span className="tt-stat__value">{identity.playTime}</span>
              <span className="tt-stat__label">Play time</span>
            </div>
            <div className="tt-rule tt-rule--v" />
            <div className="tt-stat">
              <span className="tt-stat__value">{identity.supportsBots ? 'Yes' : 'No'}</span>
              <span className="tt-stat__label">Bots</span>
            </div>
          </div>

          {Detail ? <Detail /> : null}
        </motion.div>

        {/* ---------------- setup ---------------- */}
        <motion.div variants={staggerItem} className="tt-setup__col">
          {comingSoon && ComingSoonPanel ? (
            <ComingSoonPanel />
          ) : (
            <>
              <Panel title="Your name" subtitle="How other players will see you">
                <TextInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="e.g. Friedemann"
                  maxLength={18}
                  showCount
                  error={nameError}
                  icon={<IconUsers />}
                  aria-label="Your display name"
                />
              </Panel>

              {Settings ? (
                <Settings
                  settings={draft}
                  seatCount={1}
                  onChange={patchSettings}
                  disabled={false}
                />
              ) : (
                <Panel title="Setup" subtitle="This game has no options">
                  <p className="tt-caption">
                    Everything is decided at the table. Create the lobby and invite players.
                  </p>
                </Panel>
              )}

              {lastError !== null ? (
                <motion.div
                  className="tt-inline-error"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={springSnappy}
                  role="alert"
                >
                  <IconWarning />
                  <span>
                    <strong>{lastError.code}</strong> &mdash; {lastError.message}
                  </span>
                </motion.div>
              ) : null}

              <div className="tt-setup__submit">
                <Button variant="ghost" onClick={() => navigate({ name: 'portal' })}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<IconPlay />}
                  loading={pending}
                  disabled={!canSubmit}
                  onClick={submit}
                  title={
                    status === 'connected'
                      ? undefined
                      : 'Waiting for a connection to the game server'
                  }
                >
                  Create lobby
                </Button>
              </div>
            </>
          )}

          {comingSoon ? (
            <div className="tt-setup__submit">
              <Badge tone="warning">Not yet playable</Badge>
            </div>
          ) : null}
        </motion.div>
      </motion.main>
    </div>
  );
}
