import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { springSoft } from '../../styles/motion';
import { Avatar, Badge, Money, Panel } from '../../ui';
import { PHASE_META } from '../format';
import { useMatch } from '../model';

/* ------------------------------------------------------------------ *
 * Rule notes (quality bar U8 — "phase panels state their own rules")
 * ------------------------------------------------------------------ */

export interface RuleLine {
  text: string;
  rule: string;
}

export function RuleNotes({ lines }: { lines: readonly RuleLine[] }): JSX.Element {
  return (
    <ul className="pg-grules">
      {lines.map((line) => (
        <li key={line.rule + line.text} className="pg-grules__item">
          <span className="pg-grules__text">{line.text}</span>
          <span className="pg-grules__ref">{line.rule}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Panel shell
 * ------------------------------------------------------------------ */

export interface PhaseShellProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Fixed action bar pinned to the bottom of the panel. */
  footer?: ReactNode;
  rules: readonly RuleLine[];
  tone?: 'default' | 'live' | 'final';
  children: ReactNode;
}

/**
 * Every phase panel is the same object: a scrolling body, a pinned action bar,
 * and the rules that govern the phase stated inline underneath.
 */
export function PhaseShell({
  title,
  subtitle,
  actions,
  footer,
  rules,
  tone = 'default',
  children,
}: PhaseShellProps): JSX.Element {
  return (
    <Panel
      padding="tight"
      className={`pg-gphase pg-gphase--${tone}`}
      title={title}
      subtitle={subtitle}
      actions={actions}
    >
      <motion.div
        className="pg-gphase__body"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
      >
        {children}
        <RuleNotes lines={rules} />
      </motion.div>
      {footer !== undefined ? <div className="pg-gphase__foot">{footer}</div> : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Small building blocks
 * ------------------------------------------------------------------ */

/** A labelled figure. Used for every previewed cost (quality bar U3). */
export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: 'gain' | 'loss' | 'muted';
  hint?: string;
}): JSX.Element {
  return (
    <div className="pg-gstat" data-tone={tone ?? 'default'} title={hint}>
      <span className="pg-gstat__label tt-overline">{label}</span>
      <span className="pg-gstat__value">{value}</span>
    </div>
  );
}

export function CostRow({
  label,
  amount,
  tone = 'loss',
}: {
  label: string;
  amount: number;
  tone?: 'gain' | 'loss' | 'default' | 'muted';
}): JSX.Element {
  return (
    <div className="pg-gcost">
      <span className="pg-gcost__label">{label}</span>
      <Money value={amount} tone={tone} size="sm" />
    </div>
  );
}

/** Attention block: a rule the player is about to run into. */
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="pg-gcallout" data-tone={tone}>
      <strong className="pg-gcallout__title">{title}</strong>
      <span className="pg-gcallout__body">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Waiting state
 * ------------------------------------------------------------------ */

/**
 * What the table is waiting for. Never a blank panel: the player always knows
 * whose turn it is and what they are being asked to do (quality bar U1).
 */
export function Waiting({ note }: { note?: string }): JSX.Element {
  const { state } = useMatch();
  const active = state.activePlayerId ? state.players[state.activePlayerId] : null;
  const meta = PHASE_META[state.phase];

  return (
    <div className="pg-gwait">
      {active ? (
        <>
          <Avatar name={active.name} color={active.color} size="lg" glow />
          <strong className="pg-gwait__name">{active.name}</strong>
          <Badge tone="accent" dot>
            {meta.name}
          </Badge>
          <p className="pg-gwait__note">{note ?? meta.summary}</p>
        </>
      ) : (
        <>
          <Badge tone="info" dot>
            Resolving
          </Badge>
          <p className="pg-gwait__note">
            {note ?? 'The engine is applying automatic transitions. Watch the rules log.'}
          </p>
        </>
      )}
    </div>
  );
}
