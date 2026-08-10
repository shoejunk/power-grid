import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

import { springSnappy } from '../styles/motion';
import { IconCheck } from './icons';

/**
 * Seat identity — avatar, chip and colour picker.
 *
 * These know nothing about any game's palette. A seat colour arrives as an
 * opaque id (`'red'`, `'ember'`, …) plus an optional `tint`; if no tint is
 * given the components fall back to whatever `--tt-pc*` is in scope, which a
 * game's stylesheet may bind through `[data-player-color]`. That is the whole
 * reason one lobby can seat six Power Grid industrialists or five Dead of
 * Winter survivors without a line of conditional code.
 */

/* ------------------------------------------------------------------ *
 * Tint
 * ------------------------------------------------------------------ */

/**
 * The five values a seat colour resolves to.
 *
 * `ink` is the foreground for text drawn ON the colour, so a game is
 * responsible for picking one that clears contrast against its own swatch —
 * the design system cannot know whether a seat is pale amber or deep cobalt.
 */
export interface SeatTint {
  base: string;
  light?: string;
  dark?: string;
  glow?: string;
  ink?: string;
}

/** Turns a tint into the custom properties the stylesheet reads. */
function tintStyle(tint: SeatTint | undefined): CSSProperties | undefined {
  if (!tint) return undefined;
  return {
    '--tt-pc': tint.base,
    '--tt-pc-light': tint.light ?? tint.base,
    '--tt-pc-dark': tint.dark ?? tint.base,
    '--tt-pc-glow': tint.glow ?? tint.base,
    '--tt-pc-ink': tint.ink ?? '#0b0f14',
  } as CSSProperties;
}

/* ------------------------------------------------------------------ *
 * Avatar
 * ------------------------------------------------------------------ */

export interface AvatarProps {
  name: string;
  /** Opaque seat-colour id. Used for the data attribute and the label only. */
  color: string;
  /** Explicit colour values. Omit to inherit whatever is in scope. */
  tint?: SeatTint;
  /** Human name of the colour, e.g. "Cobalt". Falls back to the id. */
  colorLabel?: string;
  /**
   * A shape drawn over the avatar.
   *
   * Colour alone is not an accessible encoding — a deuteranope can confuse two
   * seats — so a game that seats more than two players should pass a distinct
   * glyph per colour and let ownership be legible from shape as well.
   */
  sigil?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  round?: boolean;
  /** Bloom the seat colour outward — used for the player whose turn it is. */
  glow?: boolean;
  /** Show the connection dot. `undefined` hides it entirely. */
  connected?: boolean;
  className?: string;
}

/** Two-letter monogram: initials when there are two words, else first two chars. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
}

export function Avatar({
  name,
  color,
  tint,
  colorLabel,
  sigil,
  size = 'md',
  round = false,
  glow = false,
  connected,
  className,
}: AvatarProps): JSX.Element {
  const label = colorLabel ?? color;

  return (
    <span
      className={[
        'tt-avatar',
        size !== 'md' ? `tt-avatar--${size}` : '',
        round ? 'tt-avatar--round' : '',
        glow ? 'tt-avatar--glow' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-player-color={color}
      style={tintStyle(tint)}
      title={`${name} — ${label}`}
    >
      <span aria-hidden="true">{initials(name)}</span>
      {sigil !== undefined ? (
        <span className="tt-avatar__sigil" aria-hidden="true">
          {sigil}
        </span>
      ) : null}
      {connected !== undefined ? (
        <span
          className="tt-avatar__status"
          data-connected={connected}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      ) : null}
      <span className="tt-sr-only">
        {name}, {label} seat
        {connected === undefined ? '' : connected ? ', connected' : ', disconnected'}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * PlayerChip
 * ------------------------------------------------------------------ */

export interface PlayerChipProps {
  name: string;
  color: string;
  tint?: SeatTint;
  colorLabel?: string;
  sigil?: ReactNode;
  /** Secondary line: seat number, score, status, whatever the screen needs. */
  meta?: ReactNode;
  /** Trailing slot for badges or host controls. */
  trailing?: ReactNode;
  /** Inline slot after the name (badges). */
  tags?: ReactNode;
  connected?: boolean;
  /** Highlights the row in the seat colour — "this player is acting". */
  active?: boolean;
  bordered?: boolean;
  className?: string;
}

/**
 * A player identity row: avatar, name, one line of metadata, trailing slot.
 * Used in the lobby, in turn-order rails and in HUDs, so the same person
 * always looks the same everywhere.
 */
export function PlayerChip({
  name,
  color,
  tint,
  colorLabel,
  sigil,
  meta,
  trailing,
  tags,
  connected,
  active = false,
  bordered = false,
  className,
}: PlayerChipProps): JSX.Element {
  return (
    <motion.div
      className={[
        'tt-playerchip',
        bordered ? 'tt-playerchip--bordered' : '',
        active ? 'tt-playerchip--active' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-player-color={color}
      style={tintStyle(tint)}
      layout
      transition={springSnappy}
    >
      <Avatar
        name={name}
        color={color}
        tint={tint}
        colorLabel={colorLabel}
        sigil={sigil}
        connected={connected}
        glow={active}
      />
      <div className="tt-playerchip__body">
        <div className="tt-playerchip__name">
          <span>{name}</span>
          {tags}
        </div>
        {meta !== undefined ? <div className="tt-playerchip__meta">{meta}</div> : null}
      </div>
      {trailing}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * ColorPicker
 * ------------------------------------------------------------------ */

/** One selectable seat colour, as published by the game being played. */
export interface SeatColorOption {
  id: string;
  label?: string;
  tint?: SeatTint;
}

export interface ColorPickerProps {
  value: string;
  options: readonly SeatColorOption[];
  onChange: (color: string) => void;
  /** Colours already claimed by other seats — rendered disabled. */
  taken?: readonly string[];
  disabled?: boolean;
  className?: string;
}

/** Seat-colour swatches. Each swatch is a toggle button with a real label. */
export function ColorPicker({
  value,
  options,
  onChange,
  taken = [],
  disabled = false,
  className,
}: ColorPickerProps): JSX.Element {
  return (
    <div
      className={['tt-swatches', className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label="Seat colour"
    >
      {options.map((option) => {
        const isTaken = option.id !== value && taken.includes(option.id);
        const label = option.label ?? option.id;
        return (
          <motion.button
            key={option.id}
            type="button"
            className="tt-swatch"
            data-player-color={option.id}
            style={tintStyle(option.tint)}
            aria-pressed={option.id === value}
            aria-label={`${label}${isTaken ? ' (taken)' : ''}`}
            title={`${label}${isTaken ? ' — taken' : ''}`}
            disabled={disabled || isTaken}
            onClick={() => onChange(option.id)}
            whileTap={disabled || isTaken ? undefined : { scale: 0.88 }}
            transition={springSnappy}
          >
            {option.id === value ? <IconCheck /> : null}
          </motion.button>
        );
      })}
    </div>
  );
}
