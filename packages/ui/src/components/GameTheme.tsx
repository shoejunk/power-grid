import type { GameDescriptor } from '@tt/core';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Per-game theming.
 *
 * One design system has to render several titles without any of them looking
 * like a reskin of another. The lever is small on purpose: a descriptor
 * publishes three colours, and this wrapper rebinds the custom properties the
 * whole system already paints from. Every button, panel, badge and focus ring
 * downstream picks up the game's identity without a single conditional.
 *
 * The derived accents are computed with `color-mix` rather than asked of the
 * game, because a game author supplying four hand-tuned variants of one accent
 * is four chances for them to drift apart. The platform defaults stay
 * untouched: this only ever writes onto a wrapper element.
 */

export interface GameThemeProps {
  /**
   * The game whose identity applies inside. `null` renders the platform's own
   * palette, which is what the portal home page wants — it belongs to no
   * single game.
   */
  descriptor: GameDescriptor | null;
  children: ReactNode;
  /** Extra classes on the wrapper. */
  className?: string;
  /** Paint the game's backdrop colour behind `children`. */
  fill?: boolean;
}

/** The custom properties a descriptor's theme binds. */
export function themeVars(theme: GameDescriptor['theme']): CSSProperties {
  const { accent, backdrop, ink } = theme;
  return {
    '--tt-accent': accent,
    '--tt-accent-bright': `color-mix(in srgb, ${accent} 72%, #ffffff)`,
    '--tt-accent-dim': `color-mix(in srgb, ${accent} 58%, #000000)`,
    '--tt-accent-glow': `color-mix(in srgb, ${accent} 45%, transparent)`,
    '--tt-game-accent': accent,
    '--tt-game-backdrop': backdrop,
    '--tt-game-ink': ink,
  } as CSSProperties;
}

export function GameTheme({
  descriptor,
  children,
  className,
  fill = false,
}: GameThemeProps): JSX.Element {
  const style: CSSProperties | undefined = descriptor
    ? {
        ...themeVars(descriptor.theme),
        ...(fill ? { background: descriptor.theme.backdrop, color: descriptor.theme.ink } : {}),
      }
    : undefined;

  return (
    <div
      className={['tt-theme', className ?? ''].filter(Boolean).join(' ')}
      data-game={descriptor?.key ?? 'portal'}
      style={style}
    >
      {children}
    </div>
  );
}
