import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { GameSettings, MapId } from '@pg/shared';

import { MAP_IDS, MAP_PRESENTATION, MapThumbnail } from '../data/maps';
import { END_GAME_CITIES, RULES, STEP2_CITIES, ZONE_AREAS } from '../data/rules';
import { net, useGameStore } from '../net';
import { springSnappy, springSoft, staggerContainer, staggerItem } from '../styles/motion';
import {
  Badge,
  Button,
  ConnectionPill,
  Hint,
  IconBolt,
  IconChevronLeft,
  IconMap,
  IconPlay,
  IconUsers,
  IconWarning,
  Panel,
  Slider,
  TextInput,
  Toggle,
  Tooltip,
} from '../ui';
import { AmbientBackdrop, Wordmark } from '../ui/Artwork';

/* ------------------------------------------------------------------ *
 * Release gating.
 *
 * The rules engine implements and tests BOTH maps and the full Against the
 * Trust variant (§13). They are withheld from the first release only because
 * their board art and faction UI are not finished — this is a deferral, not a
 * missing feature. Re-enabling either is a one-line change here.
 * ------------------------------------------------------------------ */

const AVAILABLE_MAPS: readonly MapId[] = ['germany'];
const TRUST_AVAILABLE = false;

/** Setup form state. `seed` is optional — the server generates one if omitted. */
type SetupDraft = Omit<GameSettings, 'seed'> & { seed: string };

const DEFAULT_DRAFT: SetupDraft = {
  mapId: 'germany',
  playerCount: 4,
  experiencedStart: false,
  againstTheTrust: false,
  seed: '',
};

/**
 * Game setup.
 *
 * Two columns at desktop widths: the configuration on the left, a live preview
 * of what those settings actually mean on the right. Every option carries a
 * `<Hint>` quoting the rulebook section it comes from (quality bar U8), and
 * mutually-exclusive combinations are disabled rather than merely rejected
 * (U2) — the Trust variant is only reachable at exactly two players.
 */
export function CreateGame(): JSX.Element {
  const setRoute = useGameStore((s) => s.setRoute);
  const storedName = useGameStore((s) => s.playerName);
  const pending = useGameStore((s) => s.pending);
  const lastError = useGameStore((s) => s.lastError);
  const status = useGameStore((s) => s.connectionStatus);

  const [name, setName] = useState(storedName);
  const [draft, setDraft] = useState<SetupDraft>(DEFAULT_DRAFT);
  const [touched, setTouched] = useState(false);

  const map = MAP_PRESENTATION[draft.mapId];
  const nameError = touched && name.trim().length < 2 ? 'Enter at least 2 characters.' : null;
  const canSubmit = name.trim().length >= 2 && status === 'connected' && !pending;

  /* The Trust variant is defined only for two players (§13). Leaving two
     players re-normalises the setting instead of shipping an illegal combo. */
  useEffect(() => {
    if (draft.playerCount !== 2 && draft.againstTheTrust) {
      setDraft((d) => ({ ...d, againstTheTrust: false }));
    }
  }, [draft.playerCount, draft.againstTheTrust]);

  const zoneAreas = ZONE_AREAS[draft.playerCount] ?? 3;
  const derived = useMemo(
    () => [
      { label: 'Playing zone', value: `${zoneAreas} areas`, note: `${zoneAreas * 7} cities in play` },
      {
        label: 'Step 2 at',
        value: `${STEP2_CITIES[draft.playerCount] ?? 7} cities`,
        note: 'Second house slot opens',
      },
      {
        label: 'Game ends at',
        value: `${END_GAME_CITIES[draft.playerCount] ?? 17} cities`,
        note: 'Then final scoring',
      },
    ],
    [draft.playerCount, zoneAreas],
  );

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit) return;
    const settings: Omit<GameSettings, 'seed'> & { seed?: string } = {
      mapId: draft.mapId,
      playerCount: draft.playerCount,
      experiencedStart: draft.experiencedStart,
      againstTheTrust: draft.againstTheTrust,
    };
    if (draft.seed.trim().length > 0) settings.seed = draft.seed.trim();
    net.createGame(name.trim(), settings);
  };

  return (
    <div className="pg-screen pg-setup">
      <AmbientBackdrop />

      <header className="pg-topbar">
        <Button variant="ghost" size="sm" icon={<IconChevronLeft />} onClick={() => setRoute('menu')}>
          Back
        </Button>
        <Wordmark compact />
        <ConnectionPill />
      </header>

      <motion.main
        className="pg-setup__grid"
        variants={staggerContainer(0.06, 0.04)}
        initial="hidden"
        animate="visible"
      >
        {/* ---------------- configuration ---------------- */}
        <motion.div variants={staggerItem} className="pg-setup__col">
          <div className="pg-setup__heading">
            <h1 className="pg-h2">New game</h1>
            <p className="pg-caption">
              Pick a board and a table size. You can still change everything in the lobby.
            </p>
          </div>

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

          <Panel
            title="Map"
            subtitle="42 cities across 6 areas"
            actions={<Badge tone="info">{map.region}</Badge>}
          >
            <div className="pg-mapgrid" role="radiogroup" aria-label="Map">
              {MAP_IDS.map((id) => {
                const preset = MAP_PRESENTATION[id];
                const selected = draft.mapId === id;
                const available = AVAILABLE_MAPS.includes(id as MapId);
                return (
                  <motion.button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={!available}
                    disabled={!available}
                    title={available ? undefined : 'The USA board is not available yet.'}
                    className="pg-mapcard"
                    data-selected={selected}
                    data-unavailable={!available}
                    onClick={() => {
                      if (!available) return;
                      setDraft((d) => ({ ...d, mapId: id as MapId }));
                    }}
                    whileHover={available ? { y: -3 } : undefined}
                    whileTap={available ? { scale: 0.985 } : undefined}
                    transition={springSnappy}
                  >
                    <div
                      className="pg-mapcard__art"
                      style={{ aspectRatio: String(preset.aspectRatio) }}
                    >
                      <MapThumbnail mapId={id} active={selected} />
                    </div>
                    <div className="pg-mapcard__body">
                      <div className="pg-mapcard__name">
                        <IconMap />
                        {preset.name}
                      </div>
                      <div className="pg-mapcard__blurb">{preset.blurb}</div>
                      {available ? null : (
                        <Badge tone="neutral">Coming soon</Badge>
                      )}
                    </div>
                    {selected ? (
                      <motion.span
                        layoutId="mapcard-ring"
                        className="pg-mapcard__ring"
                        transition={springSoft}
                      />
                    ) : null}
                  </motion.button>
                );
              })}
            </div>

            <div className="pg-setup__rules">
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
        </motion.div>

        {/* ---------------- table + variants ---------------- */}
        <motion.div variants={staggerItem} className="pg-setup__col">
          <Panel
            title="Table"
            subtitle="Seats, including bots"
            actions={<Hint {...RULES.playerCount!} placement="left" />}
          >
            <Slider
              label="Players"
              value={draft.playerCount}
              min={2}
              max={6}
              showTicks
              format={(v) => String(v)}
              unit={draft.playerCount === 1 ? 'player' : 'players'}
              onChange={(playerCount) => setDraft((d) => ({ ...d, playerCount }))}
            />

            <div className="pg-derived">
              {derived.map((item) => (
                <div key={item.label} className="pg-derived__cell">
                  <span className="pg-overline">{item.label}</span>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={item.value}
                      className="pg-derived__value pg-numeral"
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                      transition={springSnappy}
                    >
                      {item.value}
                    </motion.span>
                  </AnimatePresence>
                  <span className="pg-derived__note">{item.note}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Variants" subtitle="Optional rules from the rulebook">
            <Toggle
              checked={draft.experiencedStart}
              onChange={(experiencedStart) => setDraft((d) => ({ ...d, experiencedStart }))}
              label="Experienced start"
              description="Players mark available starting cities before anyone builds."
              adornment={<Hint {...RULES.experiencedStart!} placement="left" />}
            />

            <div className="pg-rule" />

            <Tooltip
              placement="left"
              title={TRUST_AVAILABLE ? 'Two players only' : 'Not available yet'}
              content={
                TRUST_AVAILABLE
                  ? 'The Trust is defined only for the two-player game. Set the table to 2 players to enable it.'
                  : 'The Against the Trust variant is fully implemented in the rules engine but is not yet surfaced in the interface. It will be enabled in a later release.'
              }
              rule="§13 Two-player variant"
            >
              <div>
                <Toggle
                  checked={TRUST_AVAILABLE && draft.againstTheTrust}
                  disabled={!TRUST_AVAILABLE || draft.playerCount !== 2}
                  onChange={(againstTheTrust) => setDraft((d) => ({ ...d, againstTheTrust }))}
                  label="Against the Trust"
                  description="An automated third faction blocks cities and takes plants for free — and cannot win."
                  adornment={<Hint {...RULES.againstTheTrust!} placement="left" />}
                />
              </div>
            </Tooltip>
          </Panel>

          <Panel
            title="Advanced"
            subtitle="Reproducible setup"
            actions={<Hint {...RULES.seed!} placement="left" />}
          >
            <TextInput
              value={draft.seed}
              onChange={(e) => setDraft((d) => ({ ...d, seed: e.target.value }))}
              placeholder="Leave blank for a random seed"
              label="Setup seed"
              maxLength={32}
              hint="Same seed + same settings = identical shuffle, removals and starting order."
            />
          </Panel>

          {lastError !== null ? (
            <motion.div
              className="pg-inline-error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springSnappy}
              role="alert"
            >
              <IconWarning />
              <span>
                <strong>{lastError.code}</strong> — {lastError.message}
              </span>
            </motion.div>
          ) : null}

          <div className="pg-setup__submit">
            <Button variant="ghost" onClick={() => setRoute('menu')}>
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
        </motion.div>
      </motion.main>
    </div>
  );
}
