import { MAP_IDS, type GameSettings, type MapId } from '@game/power-grid';
import {
  Badge,
  Hint,
  IconBolt,
  IconMap,
  Panel,
  Slider,
  springSnappy,
  springSoft,
  TextInput,
  Toggle,
  Tooltip,
} from '@tt/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';

import type { GameSettingsSlotProps } from '@/games/types';

import { MAP_PRESENTATION, MapThumbnail } from '../data/maps';
import { END_GAME_CITIES, RULES, STEP2_CITIES, ZONE_AREAS } from '../data/rules';

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

export const MIN_SEATS = 2;
export const MAX_SEATS = 6;

export function defaultSettings(): GameSettings {
  return {
    mapId: 'germany',
    playerCount: 4,
    experiencedStart: false,
    againstTheTrust: false,
    seed: '',
  };
}

/** Narrows the shell's opaque settings, filling in anything a patch has not set. */
export function asSettings(settings: unknown): GameSettings {
  return { ...defaultSettings(), ...(settings as Partial<GameSettings> | null) };
}

/**
 * Power Grid's contribution to the create form and the lobby.
 *
 * The shell knows nothing about any of this: it renders whatever component the
 * game registers into its settings slot and forwards the patches back to the
 * server. Every option carries a `<Hint>` quoting the rulebook section it
 * comes from (quality bar U8), and mutually-exclusive combinations are
 * disabled rather than merely rejected (U2).
 */
export function PowerGridSettings({
  settings,
  seatCount,
  onChange,
  disabled,
}: GameSettingsSlotProps): JSX.Element {
  const draft = asSettings(settings);
  const map = MAP_PRESENTATION[draft.mapId];

  /* The Trust variant is defined only for two players (§13). Leaving two
     players re-normalises the setting instead of shipping an illegal combo. */
  useEffect(() => {
    if (draft.playerCount !== 2 && draft.againstTheTrust) {
      onChange({ againstTheTrust: false });
    }
  }, [draft.playerCount, draft.againstTheTrust, onChange]);

  const zoneAreas = ZONE_AREAS[draft.playerCount] ?? 3;
  const derived = useMemo(
    () => [
      {
        label: 'Playing zone',
        value: `${zoneAreas} areas`,
        note: `${zoneAreas * 7} cities in play`,
      },
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

  return (
    <>
      <Panel
        title="Map"
        subtitle="42 cities across 6 areas"
        actions={<Badge tone="info">{map.region}</Badge>}
      >
        <div className="pg-mapgrid" role="radiogroup" aria-label="Map">
          {MAP_IDS.map((id) => {
            const preset = MAP_PRESENTATION[id];
            const selected = draft.mapId === id;
            const available = AVAILABLE_MAPS.includes(id);
            return (
              <motion.button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!available || disabled}
                disabled={!available || disabled}
                title={available ? undefined : 'The USA board is not available yet.'}
                className="pg-mapcard"
                data-selected={selected}
                data-unavailable={!available}
                onClick={() => {
                  if (!available || disabled) return;
                  onChange({ mapId: id });
                }}
                whileHover={available && !disabled ? { y: -3 } : undefined}
                whileTap={available && !disabled ? { scale: 0.985 } : undefined}
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
                  {available ? null : <Badge tone="neutral">Coming soon</Badge>}
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

      <Panel
        title="Table"
        subtitle="Seats, including bots"
        actions={<Hint {...RULES.playerCount!} placement="left" />}
      >
        <Slider
          label="Players"
          value={draft.playerCount}
          min={MIN_SEATS}
          max={MAX_SEATS}
          disabled={disabled}
          showTicks
          format={(v) => String(v)}
          unit={draft.playerCount === 1 ? 'player' : 'players'}
          /* Never below the people already sitting down — the server would
             reject it, and a slider that snaps back is worse than one that
             stops. */
          onChange={(playerCount) => onChange({ playerCount: Math.max(playerCount, seatCount) })}
        />

        <div className="pg-derived">
          {derived.map((item) => (
            <div key={item.label} className="pg-derived__cell">
              <span className="tt-overline">{item.label}</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={item.value}
                  className="pg-derived__value tt-numeral"
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
          disabled={disabled}
          onChange={(experiencedStart) => onChange({ experiencedStart })}
          label="Experienced start"
          description="Players mark available starting cities before anyone builds."
          adornment={<Hint {...RULES.experiencedStart!} placement="left" />}
        />

        <div className="tt-rule" />

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
              disabled={disabled || !TRUST_AVAILABLE || draft.playerCount !== 2}
              onChange={(againstTheTrust) => onChange({ againstTheTrust })}
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
          disabled={disabled}
          onChange={(e) => onChange({ seed: e.target.value })}
          placeholder="Leave blank for a random seed"
          label="Setup seed"
          maxLength={32}
          hint="Same seed + same settings = identical shuffle, removals and starting order."
        />
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Lobby summary
 * ------------------------------------------------------------------ */

/**
 * What the chosen configuration actually means, spelled out.
 *
 * Rendered in the lobby's settings column, where players who did not create
 * the table need to know what they have been signed up for.
 */
export function PowerGridSettingsSummary({ settings }: { settings: unknown }): JSX.Element {
  const draft = asSettings(settings);
  const map = MAP_PRESENTATION[draft.mapId];

  return (
    <>
      <div className="pg-lobby__map">
        <div className="pg-lobby__mapart" style={{ aspectRatio: String(map.aspectRatio) }}>
          <MapThumbnail mapId={map.id} active />
        </div>
        <div>
          <div className="pg-mapcard__name">{map.name}</div>
          <div className="pg-mapcard__blurb">{map.blurb}</div>
        </div>
      </div>

      <dl className="tt-summary">
        <SummaryRow label="Players" value={String(draft.playerCount)} />
        <SummaryRow
          label="Playing zone"
          value={`${ZONE_AREAS[draft.playerCount] ?? 3} random contiguous areas`}
        />
        <SummaryRow label="Step 2 at" value={`${STEP2_CITIES[draft.playerCount] ?? 7} cities`} />
        <SummaryRow
          label="Game ends at"
          value={`${END_GAME_CITIES[draft.playerCount] ?? 17} cities`}
        />
        <SummaryRow
          label="Experienced start"
          value={draft.experiencedStart ? 'On' : 'Off'}
          on={draft.experiencedStart}
        />
        <SummaryRow
          label="Against the Trust"
          value={draft.againstTheTrust ? 'On' : 'Off'}
          on={draft.againstTheTrust}
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
    </>
  );
}

function SummaryRow({
  label,
  value,
  on = false,
}: {
  label: string;
  value: string;
  on?: boolean;
}): JSX.Element {
  return (
    <div className="tt-summary__row">
      <dt className="tt-summary__label">{label}</dt>
      <dd className={`tt-summary__value${on ? ' is-on' : ''}`}>{value}</dd>
    </div>
  );
}
