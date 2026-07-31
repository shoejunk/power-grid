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
  none: 'pg-panel--flush',
  tight: 'pg-panel--tight',
  normal: '',
  roomy: 'pg-panel--roomy',
};

const TONE_CLASS: Record<PanelTone, string> = {
  plate: '',
  glass: 'pg-panel--glass',
  sunken: 'pg-panel--sunken',
  flat: 'pg-panel--flat',
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
    'pg-panel',
    TONE_CLASS[tone],
    PADDING_CLASS[padding],
    ticks ? 'pg-panel--ticks' : '',
    accent ? 'pg-panel--accent' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const merged = accent
    ? ({ ...style, ['--pg-panel-accent' as string]: accent } as typeof style)
    : style;

  const body = (
    <>
      {title !== undefined ? (
        <header className="pg-panel__header">
          <div>
            <div className="pg-panel__title">{title}</div>
            {subtitle !== undefined ? (
              <div className="pg-panel__subtitle">{subtitle}</div>
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
