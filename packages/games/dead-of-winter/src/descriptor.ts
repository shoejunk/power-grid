/**
 * How Dead of Winter presents itself to the platform.
 *
 * Split out from `plugin.ts` so the portal, the lobby and the art pipeline can
 * import the game's identity without pulling in the rules engine or the
 * content pack.
 */

import type { GameDescriptor } from '@tt/core';

/**
 * Seat colours.
 *
 * Five, because the standard hidden-objective game seats 3–5 (design doc §1).
 * They are chosen to survive the game's desaturated winter palette and to stay
 * separable under deuteranopia and protanopia: the hues are spread across the
 * wheel and the lightness values are deliberately unequal, so the colours
 * remain distinguishable in greyscale as well.
 */
export const SEAT_COLORS = ['ember', 'frost', 'moss', 'rust', 'violet'] as const;

export type SeatColorId = (typeof SEAT_COLORS)[number];

/** Hex values behind each seat colour, shared by the board and the UI. */
export const SEAT_COLOR_HEX: Record<SeatColorId, string> = {
  ember: '#e8622c',
  frost: '#5fb3d9',
  moss: '#7ba05b',
  rust: '#b5453b',
  violet: '#9a7bc8',
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

export const descriptor: GameDescriptor = {
  key: 'dead-of-winter',
  name: 'Dead of Winter',
  tagline: 'Survive the colony. Trust no one completely.',
  blurb:
    'A meta-cooperative survival game. The colony needs food, morale and a completed objective ' +
    'to make it through the winter — but every survivor at the table is also chasing a secret ' +
    'agenda, and one of you may be actively working against the rest. Search for supplies, ' +
    'fight off the horde, and decide who gets exiled into the snow.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  playTime: '60–120 min',
  seatColors: SEAT_COLORS,
  supportsBots: false,
  theme: {
    accent: '#c8452f',
    backdrop: '#0d1114',
    ink: '#e7edf2',
  },
};
