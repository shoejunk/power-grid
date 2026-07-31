import { motion } from 'framer-motion';
import type { ComponentType, ReactNode } from 'react';
import type { PlayerColor } from '@pg/shared';

import { springSnappy } from '../styles/motion';
import {
  IconCheck,
  SigilCircle,
  SigilDiamond,
  SigilHex,
  SigilSquare,
  SigilStar,
  SigilTriangle,
} from './icons';
import type { IconProps } from './icons';

/**
 * The six seat colours, mirrored from `PLAYER_COLORS` in @pg/shared.
 *
 * Declared locally (and type-checked against the shared union below) so the
 * shell has no runtime dependency on the shared package — the design system
 * needs the ordering and the human-readable names anyway.
 */
export const PLAYER_COLOR_ORDER: readonly PlayerColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'black',
] as const;

export const PLAYER_COLOR_LABEL: Record<PlayerColor, string> = {
  red: 'Crimson',
  blue: 'Cobalt',
  green: 'Verdant',
  yellow: 'Amber',
  purple: 'Violet',
  black: 'Graphite',
};

/**
 * A distinct shape per seat colour.
 *
 * Colour alone is not an accessible encoding: a deuteranope can confuse the
 * red and green seats. Every avatar therefore also carries a unique sigil, so
 * ownership is legible from shape even with no colour perception at all.
 */
export const PLAYER_SIGIL: Record<PlayerColor, ComponentType<IconProps>> = {
  red: SigilTriangle,
  blue: SigilCircle,
  green: SigilSquare,
  yellow: SigilDiamond,
  purple: SigilStar,
  black: SigilHex,
};

/* ------------------------------------------------------------------ *
 * Avatar
 * ------------------------------------------------------------------ */

export interface AvatarProps {
  name: string;
  color: PlayerColor;
  size?: 'sm' | 'md' | 'lg';
  round?: boolean;
  /** Bloom the seat colour outward — used for the player whose turn it is. */
  glow?: boolean;
  /** Show the colour-blind-safe sigil badge. */
  sigil?: boolean;
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
  size = 'md',
  round = false,
  glow = false,
  sigil = true,
  connected,
  className,
}: AvatarProps): JSX.Element {
  const Sigil = PLAYER_SIGIL[color];

  return (
    <span
      className={[
        'pg-avatar',
        size !== 'md' ? `pg-avatar--${size}` : '',
        round ? 'pg-avatar--round' : '',
        glow ? 'pg-avatar--glow' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-player-color={color}
      title={`${name} — ${PLAYER_COLOR_LABEL[color]}`}
    >
      <span aria-hidden="true">{initials(name)}</span>
      {sigil ? (
        <span className="pg-avatar__sigil" aria-hidden="true">
          <Sigil />
        </span>
      ) : null}
      {connected !== undefined ? (
        <span
          className="pg-avatar__status"
          data-connected={connected}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      ) : null}
      <span className="pg-sr-only">
        {name}, {PLAYER_COLOR_LABEL[color]} seat
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
  color: PlayerColor;
  /** Secondary line: seat number, money, status, whatever the screen needs. */
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
 * Used in the lobby, the turn order rail and (later) the in-game HUD, so the
 * same person always looks the same everywhere.
 */
export function PlayerChip({
  name,
  color,
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
        'pg-playerchip',
        bordered ? 'pg-playerchip--bordered' : '',
        active ? 'pg-playerchip--active' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-player-color={color}
      layout
      transition={springSnappy}
    >
      <Avatar name={name} color={color} connected={connected} glow={active} />
      <div className="pg-playerchip__body">
        <div className="pg-playerchip__name">
          <span>{name}</span>
          {tags}
        </div>
        {meta !== undefined ? <div className="pg-playerchip__meta">{meta}</div> : null}
      </div>
      {trailing}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * ColorPicker
 * ------------------------------------------------------------------ */

export interface ColorPickerProps {
  value: PlayerColor;
  onChange: (color: PlayerColor) => void;
  /** Colours already claimed by other seats — rendered disabled. */
  taken?: readonly PlayerColor[];
  disabled?: boolean;
  className?: string;
}

/** Seat-colour swatches. Each swatch is a toggle button with a real label. */
export function ColorPicker({
  value,
  onChange,
  taken = [],
  disabled = false,
  className,
}: ColorPickerProps): JSX.Element {
  return (
    <div
      className={['pg-swatches', className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label="Seat colour"
    >
      {PLAYER_COLOR_ORDER.map((color) => {
        const isTaken = color !== value && taken.includes(color);
        return (
          <motion.button
            key={color}
            type="button"
            className="pg-swatch"
            data-player-color={color}
            aria-pressed={color === value}
            aria-label={`${PLAYER_COLOR_LABEL[color]}${isTaken ? ' (taken)' : ''}`}
            title={`${PLAYER_COLOR_LABEL[color]}${isTaken ? ' — taken' : ''}`}
            disabled={disabled || isTaken}
            onClick={() => onChange(color)}
            whileTap={disabled || isTaken ? undefined : { scale: 0.88 }}
            transition={springSnappy}
          >
            {color === value ? <IconCheck /> : null}
          </motion.button>
        );
      })}
    </div>
  );
}
