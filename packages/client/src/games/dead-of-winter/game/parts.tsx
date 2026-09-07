/**
 * The small repeated pieces: a die, a survivor standee, a stat readout, a card.
 *
 * They live together because they are the game's visual vocabulary — a survivor
 * looks the same in the colony, in the rail and inside a choice dialog, and the
 * only way to guarantee that is for there to be one component.
 */

import {
  SEAT_COLOR_HEX,
  type CrisisCardDefinition,
  type CrossroadsCardDefinition,
  type GameState,
  type MainObjectiveDefinition,
  type MainObjectiveSide,
  type SecretObjectiveDefinition,
  type SeatColorId,
  type SurvivorCardDefinition,
  type SurvivorInstance,
} from '@game/dead-of-winter';
import { Badge, Tooltip } from '@tt/ui';
import type { ReactNode } from 'react';

import { itemDef, itemName, survivorArtPath, survivorDef, SYMBOL_LABEL } from '../content';
import { CardFace, cardArtClasses } from './card-art';
import { DieFace, DowIcon } from './iconography';

/* ------------------------------------------------------------------ *
 * Dice
 * ------------------------------------------------------------------ */

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
      <DieFace value={value} />
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
      <img
        className="dow-survivor__portrait"
        src={survivorArtPath(survivor.cardId)}
        alt=""
        aria-hidden="true"
      />
      <span className="dow-survivor__pip" style={tint ? { background: tint } : undefined} />
      <span className="dow-survivor__name">
        {survivor.isLeader ? <DowIcon name="leader" size={12} /> : null}
        {def?.name ?? 'Survivor'}
      </span>
      <span className="dow-survivor__stats">
        <span title="Attack threshold"><DowIcon name="attack" size={12} />{def?.attackThreshold ?? '?'}</span>
        <span title="Search threshold"><DowIcon name="search" size={12} />{def?.searchThreshold ?? '?'}</span>
        {def?.influence ? <span title="Influence"><DowIcon name="influence" size={12} />{def.influence}</span> : null}
      </span>
      {wounds > 0 ? (
        <span
          className="dow-survivor__wounds"
          title={`${survivor.wounds} wounds, ${survivor.frostbite} frostbite`}
          role="img"
          aria-label={`${survivor.wounds} wounds, ${survivor.frostbite} frostbite`}
        >
          {Array.from({ length: Math.min(wounds, 3) }, (_, i) => (
            <DowIcon key={i} name="wound" size={11} decorative />
          ))}
          {survivor.frostbite > 0 ? <span className="dow-survivor__frost"><DowIcon name="frostbite" size={12} decorative /></span> : null}
        </span>
      ) : null}
      {survivor.equipped.length > 0 ? (
        <span
          className="dow-survivor__kit"
          title="Equipped"
          role="img"
          aria-label={`Equipped: ${survivor.equipped.map((iid) => itemName(state, iid)).join(', ')}`}
        >
          {survivor.equipped
            .map((iid) => itemDef(state, iid)?.symbols[0])
            .map((symbol, i) => (
              <span key={i}>{symbol ? <DowIcon name={symbol} size={11} decorative /> : <DowIcon name="card" size={11} decorative />}</span>
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
    cardArtClasses(def ? 'item' : 'facedown'),
    selected ? 'dow-card--selected' : '',
    def ? '' : 'dow-card--facedown',
    onClick && !disabled ? 'dow-card--live' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    def ? (
      <CardFace
        kind="item"
        name={def.name}
        text={def.text}
        symbols={def.symbols}
        symbolsLabel={`Symbols: ${def.symbols.map((symbol) => SYMBOL_LABEL[symbol]).join(', ')}`}
        tag={def.kind === 'equip' ? 'Equip' : 'One shot'}
        seedKey={def.id}
        artSymbol={def.symbols[0]}
      />
    ) : (
      <CardFace kind="facedown" name="Face down" />
    )
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

interface PrintedCardInteractionProps {
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

interface PrintedCardShellProps extends PrintedCardInteractionProps {
  kind: 'survivor' | 'crisis' | 'crossroads' | 'objective';
  children: ReactNode;
}

/** Shared interaction shell for resolved public card definitions. */
function PrintedCardShell({
  kind,
  selected = false,
  onClick,
  disabled,
  children,
}: PrintedCardShellProps): JSX.Element {
  const classes = [
    'dow-card',
    cardArtClasses(kind),
    selected ? 'dow-card--selected' : '',
    onClick && !disabled ? 'dow-card--live' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      {children}
    </button>
  ) : (
    <span className={classes}>{children}</span>
  );
}

export interface SurvivorCardProps extends PrintedCardInteractionProps {
  card: SurvivorCardDefinition;
}

/** Printed survivor face for places that already hold a resolved survivor definition. */
export function SurvivorCard({ card, ...interaction }: SurvivorCardProps): JSX.Element {
  const statline = (
    <span className="dow-cardart__statline">
      <span><DowIcon name="attack" size={11} decorative />{card.attackThreshold}+</span>
      <span><DowIcon name="search" size={11} decorative />{card.searchThreshold}+</span>
      <span><DowIcon name="influence" size={11} decorative />{card.influence}</span>
    </span>
  );

  return (
    <PrintedCardShell kind="survivor" {...interaction}>
      <CardFace
        kind="survivor"
        family="survivor"
        name={card.name}
        text={card.ability?.text ?? 'No special ability printed.'}
        symbols={['survivor', 'attack', 'search', 'influence']}
        symbolsLabel="Survivor, attack, search and influence marks"
        tag="Survivor"
        seedKey={card.id}
        meta={<span className="dow-cardart__occupation">{card.occupation}</span>}
      />
      <span className="dow-cardart__stats" aria-label={`Attack ${card.attackThreshold} plus, search ${card.searchThreshold} plus, influence ${card.influence}`}>
        {statline}
      </span>
    </PrintedCardShell>
  );
}

export interface CrisisCardProps extends PrintedCardInteractionProps {
  card: CrisisCardDefinition;
}

/** Printed crisis face; only the resolved public crisis definition is accepted. */
export function CrisisCard({ card, ...interaction }: CrisisCardProps): JSX.Element {
  const accepted = card.acceptedSymbols.length;
  return (
    <PrintedCardShell kind="crisis" {...interaction}>
      <CardFace
        kind="crisis"
        family="crisis"
        name={card.name}
        text={card.text}
        symbols={card.acceptedSymbols}
        symbolsLabel={accepted ? `Accepted symbols: ${card.acceptedSymbols.join(', ')}` : 'No symbols accepted'}
        tag="Crisis"
        seedKey={card.id}
        meta={accepted ? `${accepted} accepted` : 'No symbols accepted'}
      />
    </PrintedCardShell>
  );
}

export interface CrossroadsCardProps extends PrintedCardInteractionProps {
  card: CrossroadsCardDefinition;
}

/** Printed crossroads face; story text is public once this definition is supplied. */
export function CrossroadsCard({ card, ...interaction }: CrossroadsCardProps): JSX.Element {
  const chooser = card.chooser === 'firstPlayer' ? 'First player chooses' : 'Active player chooses';
  return (
    <PrintedCardShell kind="crossroads" {...interaction}>
      <CardFace
        kind="crossroads"
        family="crossroads"
        name={card.name}
        text={card.story}
        symbols={['card', 'survivor']}
        symbolsLabel="Crossroads story and survivor marks"
        tag="Crossroads"
        seedKey={card.id}
        meta={chooser}
      />
    </PrintedCardShell>
  );
}

export type ObjectiveCardProps = PrintedCardInteractionProps & (
  | {
      variant: 'main';
      card: MainObjectiveDefinition;
      side: MainObjectiveSide;
      sideLabel?: string;
    }
  | {
      variant: 'secret';
      card: SecretObjectiveDefinition;
    }
);

/** Printed objective face for a resolved main side or an already-visible secret objective. */
export function ObjectiveCard(props: ObjectiveCardProps): JSX.Element {
  const face = props.variant === 'main' ? (
    <CardFace
      kind="objective"
      family="objective"
      name={props.card.name}
      text={props.side.text}
      symbols={['card', 'influence', 'survivor']}
      symbolsLabel="Objective, influence and survivor marks"
      tag="Main objective"
      seedKey={`${props.card.id}:${props.sideLabel ?? 'standard'}`}
      meta={props.sideLabel ?? 'Standard side'}
    />
  ) : (
    <CardFace
      kind="objective"
      family="objective"
      name={props.card.name}
      text={props.card.text}
      symbols={['card', 'influence']}
      symbolsLabel="Secret objective and influence marks"
      tag={props.card.kind === 'betrayal' ? 'Betrayal objective' : 'Secret objective'}
      seedKey={props.card.id}
      meta={props.card.kind === 'exiled' ? 'Exiled' : props.card.kind === 'betrayal' ? 'Betrayal' : 'Private'}
    />
  );

  return (
    <PrintedCardShell
      kind="objective"
      selected={props.selected}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {face}
    </PrintedCardShell>
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
            <DowIcon name="zombie" size={11} decorative />
          </span>
        ))}
        {Array.from({ length: barricades }, (_, i) => (
          <span key={`b${i}`} className="dow-entrance__barricade">
            <DowIcon name="barricade" size={11} decorative />
          </span>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <span key={`f${i}`} className="dow-entrance__free">
            <DowIcon name="free" size={11} decorative />
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
