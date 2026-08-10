import { motion } from 'framer-motion';
import type { HTMLAttributes, ReactNode } from 'react';

import { springSoft } from '../styles/motion';

export type PanelTone = 'plate' | 'glass' | 'sunken' | 'flat';
export type PanelPadding = 'none' | 'tight' | 'normal' | 'roomy';

type NativeDivProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onAnimationStart' | 'onAnimationEnd' | 'onDragStart' | 'onDrag' | 'onDragEnd' | 'title'
>;

export interface PanelProps extends NativeDivProps {
  /** Surface treatment. `plate` is milled metal, `glass` is frosted. */
  tone?: PanelTone;
  padding?: PanelPadding;
  /** Renders the header bar. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned slot in the header (buttons, badges, counts). */
  actions?: ReactNode;
  /** Engineering registration ticks in opposing corners. */
  ticks?: boolean;
  /** Coloured rail on the left edge. Pass any CSS colour. */
  accent?: string;
  /** Animate the panel in on mount. */
  animate?: boolean;
  children?: ReactNode;
}

const PADDING_CLASS: Record<PanelPadding, string> = {
  none: 'tt-panel--flush',
  tight: 'tt-panel--tight',
  normal: '',
  roomy: 'tt-panel--roomy',
};

const TONE_CLASS: Record<PanelTone, string> = {
  plate: '',
  glass: 'tt-panel--glass',
  sunken: 'tt-panel--sunken',
  flat: 'tt-panel--flat',
};

/**
 * The universal surface. Everything that is not the background sits on one of
 * these, which is what keeps the game feeling like one machined object rather
 * than a collection of divs.
 */
export function Panel({
  tone = 'plate',
  padding = 'normal',
  title,
  subtitle,
  actions,
  ticks = false,
  accent,
  animate = false,
  className,
  children,
  style,
  ...rest
}: PanelProps): JSX.Element {
  const classes = [
    'tt-panel',
    TONE_CLASS[tone],
    PADDING_CLASS[padding],
    ticks ? 'tt-panel--ticks' : '',
    accent ? 'tt-panel--accent' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const merged = accent
    ? ({ ...style, ['--tt-panel-accent' as string]: accent } as typeof style)
    : style;

  const body = (
    <>
      {title !== undefined ? (
        <header className="tt-panel__header">
          <div>
            <div className="tt-panel__title">{title}</div>
            {subtitle !== undefined ? (
              <div className="tt-panel__subtitle">{subtitle}</div>
            ) : null}
          </div>
          {actions !== undefined ? <div>{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </>
  );

  if (!animate) {
    return (
      <div {...rest} className={classes} style={merged}>
        {body}
      </div>
    );
  }

  return (
    <motion.div
      {...rest}
      className={classes}
      style={merged}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
    >
      {body}
    </motion.div>
  );
}
