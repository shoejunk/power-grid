/**
 * Dead of Winter's contribution to the create form and the lobby.
 *
 * §19's six variants are not six mutually exclusive things — hardcore,
 * betrayer and elimination layer onto a base mode, while cooperative and
 * Prisoner's Dilemma replace how winning works — so the editor is a base mode
 * plus modifiers, exactly as `GameSettings` models it. Combinations the rules
 * forbid are disabled with the reason rather than silently rejected on submit.
 *
 * The defaults come from the plugin itself, not from a copy: a table created
 * here must start from the same object the server would have used.
 */

import {
  ACTIVE_PACK,
  deadOfWinter,
  GAME_MODES,
  type GameMode,
  type GameSettings,
} from '@game/dead-of-winter';
import { Badge, Hint, NumberStepper, Panel, Select, TextInput, Toggle } from '@tt/ui';

import type { GameSettingsSlotProps } from '@/games/types';

export const defaultSettings = (): GameSettings => deadOfWinter.defaultSettings();

/** Narrows the shell's opaque settings, filling in anything a patch has not set. */
export function asSettings(settings: unknown): GameSettings {
  return { ...defaultSettings(), ...(settings as Partial<GameSettings> | null) };
}

const MODE_LABEL: Record<GameMode, string> = {
  standard: 'Standard — hidden objectives',
  cooperative: 'Cooperative — no secrets',
  prisonersDilemma: 'Prisoner’s Dilemma — exactly two',
};

const MODE_NOTE: Record<GameMode, string> = {
  standard: '3–5 players. Everyone has a secret agenda, and one of them may be betrayal. §1',
  cooperative: '2–5 players. No secret objectives, no betrayer, no exile. §19.1',
  prisonersDilemma: 'Two players, two secret objectives each. §19.6',
};

const SEAT_BOUNDS: Record<GameMode, { min: number; max: number }> = {
  standard: { min: 3, max: 5 },
  cooperative: { min: 2, max: 5 },
  prisonersDilemma: { min: 2, max: 2 },
};

export function DeadOfWinterSettings({
  settings,
  seatCount,
  onChange,
  disabled,
}: GameSettingsSlotProps): JSX.Element {
  const draft = asSettings(settings);
  const bounds = SEAT_BOUNDS[draft.mode];
  const objectives = [...ACTIVE_PACK.mainObjectives.values()];

  const setMode = (mode: GameMode): void => {
    const next = SEAT_BOUNDS[mode];
    onChange({
      mode,
      // Re-normalise rather than ship an illegal combination the server
      // would only reject at start.
      playerCount: Math.min(Math.max(draft.playerCount, next.min), next.max),
      ...(mode === 'cooperative' ? { betrayerVariant: false } : {}),
      ...(mode === 'prisonersDilemma' ? { playerCount: 2 } : {}),
    });
  };

  return (
    <>
      <Panel
        title="Variant"
        subtitle="The base game, or one of §19's replacements"
        actions={<Badge tone="info">{ACTIVE_PACK.pack.name}</Badge>}
      >
        <Select<GameMode>
          value={draft.mode}
          onChange={setMode}
          disabled={disabled}
          label="Mode"
          options={GAME_MODES.map((mode) => ({ value: mode, label: MODE_LABEL[mode] }))}
        />
        <p className="tt-caption">{MODE_NOTE[draft.mode]}</p>

        <div className="dow-settings__seats">
          <NumberStepper
            label="Players"
            value={draft.playerCount}
            onChange={(playerCount) => onChange({ playerCount })}
            min={Math.max(bounds.min, seatCount)}
            max={bounds.max}
            unit="players"
            disabled={disabled || draft.mode === 'prisonersDilemma'}
          />
          <span className="tt-caption">
            {bounds.min}–{bounds.max} for this mode.
          </span>
        </div>
      </Panel>

      <Panel title="Difficulty and variants" subtitle="§19">
        <Toggle
          checked={draft.hardcore || draft.mode === 'cooperative'}
          onChange={(hardcore) => onChange({ hardcore })}
          disabled={disabled || draft.mode === 'cooperative'}
          label="Hardcore objective"
          description={
            draft.mode === 'cooperative'
              ? 'The cooperative game always uses the hardcore side. §19.1'
              : 'Use the hardcore side of the main objective. §19.4'
          }
          adornment={<Hint content="The hardcore side raises what the colony has to clear." rule="§19.4" />}
        />
        <Toggle
          checked={draft.betrayerVariant}
          onChange={(betrayerVariant) => onChange({ betrayerVariant })}
          disabled={disabled || draft.mode === 'cooperative'}
          label="Betrayer variant"
          description={
            draft.mode === 'cooperative'
              ? 'A cooperative game deals no secret objectives, so there is no betrayer. §19.1'
              : 'Set aside one non-betrayal objective per player instead of two — a betrayer is far more likely. §19.3'
          }
          adornment={
            <Hint
              content="One non-betrayal objective is set aside per player instead of two, so a betrayer is far more likely to be in the deal."
              rule="§19.3"
            />
          }
        />
        <Toggle
          checked={draft.playerElimination}
          onChange={(playerElimination) => onChange({ playerElimination })}
          disabled={disabled}
          label="Player elimination"
          description="Lose your last survivor and you are out of the game, with no replacement. §19.5"
          adornment={
            <Hint
              content="Without it, a player who loses their last survivor is given a replacement and keeps playing."
              rule="§19.5"
            />
          }
        />
        <Toggle
          checked={draft.includeBetrayalObjective}
          onChange={(includeBetrayalObjective) => onChange({ includeBetrayalObjective })}
          disabled={disabled || draft.mode === 'cooperative'}
          label="Include the betrayal objective"
          description="Off is the §4.4 errata's easier game: no betrayer is possible at all."
          adornment={
            <Hint
              content="The errata allows omitting the betrayal objective for an easier game in which nobody can be working against the colony."
              rule="§4.4"
            />
          }
        />
        <Toggle
          checked={draft.matureContentFilter}
          onChange={(matureContentFilter) => onChange({ matureContentFilter })}
          disabled={disabled}
          label="Filter mature content"
          description="Removes crossroads cards flagged for mature themes during setup. §4.7"
          adornment={
            <Hint content="Every card carries the flag as data; nothing is inferred from art." rule="§4.7" />
          }
        />
      </Panel>

      {draft.mode === 'prisonersDilemma' ? (
        <Panel
          title="Prisoner’s Dilemma suggestions"
          subtitle="§19.6 presents these as the designer's suggestions, not as rules"
        >
          <Toggle
            checked={draft.prisonersDilemma.roundZeroEndsLikeMoraleZero}
            onChange={(value) =>
              onChange({
                prisonersDilemma: {
                  ...draft.prisonersDilemma,
                  roundZeroEndsLikeMoraleZero: value,
                },
              })
            }
            disabled={disabled}
            label="Running out of rounds ends the game like morale zero"
          />
          <Toggle
            checked={draft.prisonersDilemma.keepNonCooperativeCards}
            onChange={(value) =>
              onChange({
                prisonersDilemma: { ...draft.prisonersDilemma, keepNonCooperativeCards: value },
              })
            }
            disabled={disabled}
            label="Keep non-cooperative cards in the decks"
          />
          <Toggle
            checked={draft.prisonersDilemma.removeExileDependentContent}
            onChange={(value) =>
              onChange({
                prisonersDilemma: {
                  ...draft.prisonersDilemma,
                  removeExileDependentContent: value,
                },
              })
            }
            disabled={disabled}
            label="Remove content that depends on exiled survivors"
          />
        </Panel>
      ) : null}

      <Panel title="Scenario" subtitle="§4.3 — or leave it to the shuffle">
        <Select<string>
          value={draft.mainObjectiveId ?? ''}
          onChange={(id) => onChange({ mainObjectiveId: id === '' ? null : id })}
          disabled={disabled}
          label="Main objective"
          options={[
            { value: '', label: 'Random' },
            ...objectives.map((objective) => ({ value: objective.id, label: objective.name })),
          ]}
        />
        <TextInput
          value={draft.seed}
          onChange={(e) => onChange({ seed: e.target.value })}
          disabled={disabled}
          placeholder="Leave blank for a fresh shuffle"
          maxLength={64}
          label="Seed"
          aria-label="Random seed"
        />
        <p className="tt-caption">
          The same seed and the same choices replay the same game, dice included. §22
        </p>
      </Panel>
    </>
  );
}

export function DeadOfWinterSettingsSummary({ settings }: { settings: unknown }): JSX.Element {
  const draft = asSettings(settings);
  const flags = [
    draft.hardcore || draft.mode === 'cooperative' ? 'hardcore' : null,
    draft.betrayerVariant ? 'betrayer variant' : null,
    draft.playerElimination ? 'elimination' : null,
    draft.includeBetrayalObjective ? null : 'no betrayal card',
    draft.matureContentFilter ? 'filtered' : null,
  ].filter(Boolean);

  return (
    <span>
      {MODE_LABEL[draft.mode]} · {draft.playerCount} players
      {flags.length > 0 ? ` · ${flags.join(', ')}` : ''}
    </span>
  );
}
