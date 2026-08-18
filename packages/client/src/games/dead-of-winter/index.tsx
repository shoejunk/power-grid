import { deadOfWinter, SEAT_COLORS, SEAT_COLOR_HEX, type SeatColorId } from '@game/dead-of-winter';
import {
  SigilCircle,
  SigilDiamond,
  SigilHex,
  SigilSquare,
  SigilTriangle,
  type SeatColorOption,
} from '@tt/ui';
import type { ComponentType, ReactNode } from 'react';

import type { GameUiModule } from '../types';

import { DeadOfWinterMatch } from './game/Match';
import {
  defaultSettings,
  DeadOfWinterSettings,
  DeadOfWinterSettingsSummary,
} from './settings/DeadOfWinterSettings';

/**
 * Dead of Winter's client module.
 *
 * The interface is playable but unfinished: it draws the whole authoritative
 * state and can send every action the engine accepts, with each affordance's
 * legality answered by the rules engine itself rather than guessed at. What it
 * does not yet have is art — the board is panels, not a painted colony — and
 * the animation and moment-to-moment feedback the quality bar asks for.
 *
 * The stylesheet is imported by the match screen rather than here, so the
 * portal does not pay for it until somebody actually sits down.
 */

const SEAT_LABEL: Record<SeatColorId, string> = {
  ember: 'Ember',
  frost: 'Frost',
  moss: 'Moss',
  rust: 'Rust',
  violet: 'Violet',
};

/**
 * A distinct shape per seat colour. Colour alone is not an accessible
 * encoding, and this game paints five seats over a deliberately desaturated
 * winter palette, where it is even less of one.
 */
const SEAT_SIGIL: Record<SeatColorId, ComponentType> = {
  ember: SigilTriangle,
  frost: SigilCircle,
  moss: SigilSquare,
  rust: SigilDiamond,
  violet: SigilHex,
};

const seatColors: readonly SeatColorOption[] = SEAT_COLORS.map((id) => ({
  id,
  label: SEAT_LABEL[id],
  tint: { base: SEAT_COLOR_HEX[id], ink: '#0b0f14' },
}));

export function seatSigil(color: string): ReactNode {
  const Sigil = SEAT_SIGIL[color as SeatColorId];
  return Sigil ? <Sigil /> : null;
}

const deadOfWinterUi: GameUiModule = {
  descriptor: deadOfWinter.descriptor,
  defaultSettings,
  seatColors,
  seatSigil,
  /* Mirrors the plugin method the server uses to size the table, so the lobby
     never advertises a seat that `startGame` would then refuse. */
  seatCapacity: (settings) => deadOfWinter.seatCapacity?.(settings as never),
  Settings: DeadOfWinterSettings,
  SettingsSummary: DeadOfWinterSettingsSummary,
  Match: DeadOfWinterMatch,
};

export default deadOfWinterUi;
