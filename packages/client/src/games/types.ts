import type { GameDescriptor } from '@tt/core';
import type { SeatColorOption } from '@tt/ui';
import type { ComponentType, ReactNode } from 'react';

/**
 * What a game contributes to the client.
 *
 * The shell renders the portal, the create form, the lobby and the match
 * frame; a game fills the holes. The test for whether something belongs in
 * this interface rather than in the shell is simple: if the shell would have
 * to know what a map, a phase or a survivor is in order to render it, it goes
 * here.
 *
 * Adding a game is one entry in `registry.ts` and one module implementing
 * this. No shell file changes.
 */

/** Props the shell hands to a game's settings editor. */
export interface GameSettingsSlotProps {
  /**
   * The settings object as the game published it. Opaque to the shell, which
   * only ever passes it back through.
   */
  settings: unknown;
  /** Seats currently taken, so a game can refuse to shrink below them. */
  seatCount: number;
  /** Emits a partial settings patch; the shell routes it to the right place. */
  onChange: (patch: unknown) => void;
  /** True when this browser may not edit — not the host, or already started. */
  disabled: boolean;
}

export interface GameUiModule {
  /** Identity. Also the source of the theme the shell applies. */
  descriptor: GameDescriptor;

  /**
   * Set while the game's UI is still being built.
   *
   * The server will happily host a table for any registered plugin, so
   * without this the portal would cheerfully seat six people at a game that
   * cannot draw itself. The detail page shows `Match` on its own instead of a
   * create form, and the portal card says so up front.
   */
  comingSoon?: true;

  /** Settings a brand-new table starts with, mirroring the plugin's. */
  defaultSettings(): unknown;

  /**
   * Seat colours, with the values needed to paint them.
   *
   * The descriptor lists the colour *ids*; only the game knows what
   * `'ember'` actually looks like, so the swatches come from here.
   */
  seatColors: readonly SeatColorOption[];

  /**
   * A distinct glyph per seat colour. Colour alone is not an accessible
   * encoding, so anything that identifies a player by colour also carries
   * this. Omitted by games that seat few enough players not to need it.
   */
  seatSigil?: (color: string) => ReactNode;

  /**
   * How many seats this configuration allows, when the game lets the host
   * size the table below the descriptor ceiling. Mirrors the plugin method of
   * the same name — the server is still the authority, this only keeps the
   * lobby from advertising seats that cannot be filled.
   */
  seatCapacity?: (settings: unknown) => number | undefined;

  /** Editor for this game's own options. Rendered in the create form and the lobby. */
  Settings?: ComponentType<GameSettingsSlotProps>;

  /** Extra panels on the game's detail page — rules, maps, what a round looks like. */
  Detail?: ComponentType;

  /** A one-line summary of the current settings, shown in the lobby. */
  SettingsSummary?: ComponentType<{ settings: unknown }>;

  /**
   * The match screen. Reads the opaque `state` off the store and narrows it —
   * this is the only place in the client allowed to know its shape.
   */
  Match: ComponentType;
}
