import { PLAYER_COLORS, powerGrid, type PlayerColor } from '@game/power-grid';
import {
  SigilCircle,
  SigilDiamond,
  SigilHex,
  SigilSquare,
  SigilStar,
  SigilTriangle,
  type SeatColorOption,
} from '@tt/ui';
import type { ComponentType, ReactNode } from 'react';

import type { GameUiModule } from '../types';

import { GameScreen } from './screens/GameScreen';
import {
  defaultSettings,
  PowerGridSettings,
  PowerGridSettingsSummary,
} from './settings/PowerGridSettings';
import { PowerGridDetail } from './settings/PowerGridDetail';
import './styles/power-grid.scss';

/**
 * Power Grid's client module.
 *
 * Everything the shell needs to render this game and nothing it needs to
 * *understand* it. The whole file is loaded on demand, which is why the
 * stylesheet is imported here rather than by the app: a player who never opens
 * Power Grid never downloads its 700 lines of CSS, its map art or its engine.
 */

/* ------------------------------------------------------------------ *
 * Seats
 * ------------------------------------------------------------------ */

const SEAT_LABEL: Record<PlayerColor, string> = {
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
const SEAT_SIGIL: Record<PlayerColor, ComponentType> = {
  red: SigilTriangle,
  blue: SigilCircle,
  green: SigilSquare,
  yellow: SigilDiamond,
  purple: SigilStar,
  black: SigilHex,
};

/**
 * Swatch values.
 *
 * The hexes are the ones solved for colour-blind separation in
 * `styles/power-grid.scss` — see the note there before changing any of them.
 * They are repeated in TypeScript because the design system paints a swatch
 * from a prop, not from a stylesheet it cannot see.
 */
const SEAT_TINT: Record<PlayerColor, { base: string; light: string; dark: string; glow: string; ink: string }> = {
  red: { base: '#d3232d', light: '#f5808a', dark: '#7a1017', glow: 'rgba(211, 35, 45, 0.5)', ink: '#ffffff' },
  blue: { base: '#1f4cd0', light: '#7f9bf0', dark: '#10276e', glow: 'rgba(31, 76, 208, 0.5)', ink: '#ffffff' },
  green: { base: '#3bc872', light: '#7ee3a0', dark: '#10613a', glow: 'rgba(59, 200, 114, 0.5)', ink: '#0b0f14' },
  yellow: { base: '#ffca46', light: '#ffe395', dark: '#8a6a12', glow: 'rgba(255, 202, 70, 0.5)', ink: '#0b0f14' },
  purple: { base: '#bf61c9', light: '#e0a3e8', dark: '#5a2262', glow: 'rgba(191, 97, 201, 0.5)', ink: '#0b0f14' },
  black: { base: '#929ca7', light: '#c3ccd6', dark: '#3a4048', glow: 'rgba(146, 156, 167, 0.5)', ink: '#0b0f14' },
};

const seatColors: readonly SeatColorOption[] = PLAYER_COLORS.map((id) => ({
  id,
  label: SEAT_LABEL[id],
  tint: SEAT_TINT[id],
}));

export function seatSigil(color: string): ReactNode {
  const Sigil = SEAT_SIGIL[color as PlayerColor];
  return Sigil ? <Sigil /> : null;
}

/* ------------------------------------------------------------------ *
 * Module
 * ------------------------------------------------------------------ */

const powerGridUi: GameUiModule = {
  descriptor: powerGrid.descriptor,
  defaultSettings,
  seatColors,
  seatSigil,
  /* Mirrors the plugin method the server uses to size the table, so the lobby
     never advertises a seat that `startGame` would then refuse. */
  seatCapacity: (settings) => powerGrid.seatCapacity?.(settings as never),
  Settings: PowerGridSettings,
  SettingsSummary: PowerGridSettingsSummary,
  Detail: PowerGridDetail,
  Match: GameScreen,
};

export default powerGridUi;
