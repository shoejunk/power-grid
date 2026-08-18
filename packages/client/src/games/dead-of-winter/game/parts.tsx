/**
 * The small repeated pieces: a die, a survivor standee, a stat readout, a card.
 *
 * They live together because they are the game's visual vocabulary — a survivor
 * looks the same in the colony, in the rail and inside a choice dialog, and the
 * only way to guarantee that is for there to be one component.
 */

import {
  SEAT_COLOR_HEX,
  type GameState,
  type SeatColorId,
  type SurvivorInstance,
} from '@game/dead-of-winter';
import { Badge, Tooltip } from '@tt/ui';
import type { ReactNode } from 'react';

import { itemDef, itemName, survivorDef, SYMBOL_GLYPH, SYMBOL_LABEL } from '../content';

/* ------------------------------------------------------------------ *
 * Dice
 * ------------------------------------------------------------------ */

const DIE_FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export interface DieProps {
  value: number;
  spent?: boolean;
  selected?: boolean;
  onClick?: () => void;
  title?: string;
}

export function Die({ value, spent = false, selected = false, onClick, title }: DieProps): JSX.Element {
  const classes = [
    'dow-die',
    spent ? 'dow-die--spent' : '',
    selected ? 'dow-die--selected' : '',
    onClick ? 'dow-die--live' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const face = (
    <span className="dow-die__face" aria-hidden="true">
      {DIE_FACE[value] ?? value}
    </span>
  );
  const label = `${spent ? 'Spent action die' : 'Action die'}, value ${value}`;

  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={title}
    >
      {face}
    </button>
  ) : (
    <span className={classes} role="img" aria-label={label} title={title}>
      {face}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Survivors
 * ------------------------------------------------------------------ */

export interface SurvivorChipProps {
  state: GameState;
  survivor: SurvivorInstance;
  selected?: boolean;
  onClick?: () => void;
  /** Dims survivors this browser cannot act with. */
  muted?: boolean;
}

/**
 * One survivor standee.
 *
 * Ownership is carried by the seat colour *and* by the leader star and the name
 * — colour alone is never the only encoding. Wounds and frostbite are counted
 * separately because §9.1 counts them separately even though they sum for
 * death, and a player who cannot see which is which cannot plan around a
 * medicine card.
 */
export function SurvivorChip({
  state,
  survivor,
  selected = false,
  onClick,
  muted = false,
}: SurvivorChipProps): JSX.Element {
  const def = survivorDef(state, survivor.id);
  const owner = state.players[survivor.controllerId];
  const tint = owner ? SEAT_COLOR_HEX[owner.color as SeatColorId] : undefined;
  const wounds = survivor.wounds + survivor.frostbite;

  const classes = [
    'dow-survivor',
    selected ? 'dow-survivor--selected' : '',
    muted ? 'dow-survivor--muted' : '',
    onClick ? 'dow-survivor--live' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <span className="dow-survivor__pip" style={tint ? { background: tint } : undefined} />
      <span className="dow-survivor__name">
        {survivor.isLeader ? <span aria-label="Group leader">★ </span> : null}
        {def?.name ?? 'Survivor'}
      </span>
      <span className="dow-survivor__stats" aria-hidden="true">
        <span title="Attack threshold">⚔{def?.attackThreshold ?? '?'}</span>
        <span title="Search threshold">🔍{def?.searchThreshold ?? '?'}</span>
        {def?.influence ? <span title="Influence">✦{def.influence}</span> : null}
      </span>
      {wounds > 0 ? (
        <span className="dow-survivor__wounds" title={`${survivor.wounds} wounds, ${survivor.frostbite} frostbite`}>
          {'✖'.repeat(Math.min(wounds, 3))}
          {survivor.frostbite > 0 ? <span className="dow-survivor__frost">❄</span> : null}
        </span>
      ) : null}
      {survivor.equipped.length > 0 ? (
        <span className="dow-survivor__kit" title="Equipped">
          {survivor.equipped
            .map((iid) => itemDef(state, iid)?.symbols[0])
            .map((symbol, i) => (
              <span key={i}>{symbol ? SYMBOL_GLYPH[symbol] : '▫'}</span>
            ))}
        </span>
      ) : null}
    </>
  );

  const description = [
    def?.occupation,
    `attacks on ${def?.attackThreshold ?? '?'}+`,
    `searches on ${def?.searchThreshold ?? '?'}+`,
    survivor.movedThisTurn ? 'has already moved this turn' : null,
    ...survivor.equipped.map((iid) => `carrying ${itemName(state, iid)}`),
  ]
    .filter(Boolean)
    .join(' · ');

  return onClick ? (
    <Tooltip content={description} title={def?.name ?? 'Survivor'}>
      <button type="button" className={classes} onClick={onClick} aria-pressed={selected}>
        {body}
      </button>
    </Tooltip>
  ) : (
    <span className={classes} title={description}>
      {body}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

export interface ItemCardProps {
  state: GameState;
  iid: string;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

/** A card in hand, or face-down when the viewer is not entitled to know it. */
export function ItemCard({ state, iid, selected = false, onClick, disabled }: ItemCardProps): JSX.Element {
  const def = itemDef(state, iid);
  const classes = [
    'dow-card',
    selected ? 'dow-card--selected' : '',
    def ? '' : 'dow-card--facedown',
    onClick && !disabled ? 'dow-card--live' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      <span className="dow-card__name">{def?.name ?? 'Face down'}</span>
      <span className="dow-card__symbols" aria-hidden="true">
        {(def?.symbols ?? []).map((symbol) => (
          <span key={symbol} title={SYMBOL_LABEL[symbol]}>
            {SYMBOL_GLYPH[symbol]}
          </span>
        ))}
      </span>
      {def ? <span className="dow-card__text">{def.text}</span> : null}
      {def ? (
        <span className="dow-card__kind">{def.kind === 'equip' ? 'Equip' : 'One shot'}</span>
      ) : null}
    </>
  );

  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      {inner}
    </button>
  ) : (
    <span className={classes}>{inner}</span>
  );
}

/* ------------------------------------------------------------------ *
 * Readouts
 * ------------------------------------------------------------------ */

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'normal' | 'warning' | 'danger';
}

export function Stat({ label, value, hint, tone = 'normal' }: StatProps): JSX.Element {
  return (
    <div className={`dow-stat dow-stat--${tone}`} title={hint}>
      <span className="dow-stat__value tt-numeral">{value}</span>
      <span className="dow-stat__label">{label}</span>
    </div>
  );
}

/** Zombies and barricades at one entrance, drawn as tokens rather than numbers. */
export function EntranceRow({
  zombies,
  barricades,
  capacity,
  index,
}: {
  zombies: number;
  barricades: number;
  capacity: number;
  index?: number;
}): JSX.Element {
  const free = Math.max(0, capacity - zombies - barricades);
  return (
    <span
      className="dow-entrance"
      title={`${zombies} zombies, ${barricades} barricades, ${free} free of ${capacity}`}
    >
      {index !== undefined ? <span className="dow-entrance__index">{index}</span> : null}
      <span className="dow-entrance__slots" aria-hidden="true">
        {Array.from({ length: zombies }, (_, i) => (
          <span key={`z${i}`} className="dow-entrance__zombie">
            ●
          </span>
        ))}
        {Array.from({ length: barricades }, (_, i) => (
          <span key={`b${i}`} className="dow-entrance__barricade">
            ▮
          </span>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <span key={`f${i}`} className="dow-entrance__free">
            ○
          </span>
        ))}
      </span>
      <span className="tt-sr-only">{`${zombies} zombies, ${barricades} barricades`}</span>
    </span>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger' | 'success' }): JSX.Element {
  return <Badge tone={tone ?? 'neutral'}>{children}</Badge>;
}
