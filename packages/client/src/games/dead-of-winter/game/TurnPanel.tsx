/**
 * The rail you actually play from.
 *
 * Shape of the interaction, and the reason for it: a Dead of Winter turn is
 * "spend a die on a survivor doing a thing", so the rail is read left to right —
 * pick a survivor, pick a die, and every action the two of them could take
 * appears, legal ones live and illegal ones disabled with the engine's own
 * reason on them. Nothing is hidden because it happens to be illegal right now;
 * a player learning the game needs to see that Search exists and that it needs
 * a 4, not to wonder where the button went.
 *
 * Actions needing a second thing — a destination, a source location, a target
 * survivor, an entrance — put the rail into an "aiming" state instead of
 * opening a dialog, so the board stays visible while you choose.
 *
 * The panel renders in **sections** so the match screen can place them in
 * different zones of the composition: the acting controls belong in the right
 * rail beside the board, while the hand belongs along the bottom of the screen
 * where a hand of cards is physically held and where each card can be 150px
 * wide instead of a 45px sliver. `section` only chooses which of the three
 * panels this instance draws; every prop, handler and hook is unchanged, and
 * the default (`'all'`) still renders the original stacked rail.
 */

import {
  COLONY,
  NON_COLONY_LOCATIONS,
  type GameAction,
  type GameState,
  type LocationId,
} from '@game/dead-of-winter';
import type { PlayerId } from '@tt/core';
import { Badge, Button, NumberStepper, Panel, Tooltip } from '@tt/ui';
import { useState } from 'react';

import { net } from '@/net';

import { abilitiesOf, itemDef, itemName, locationName, mainObjectiveSide, survivorName } from '../content';
import {
  entranceFree,
  entrancesOf,
  isMyTurn,
  playerOf,
  probe,
  survivorsAt,
  survivorsOf,
  type Legality,
} from './model';
import { Die, ItemCard, SurvivorChip } from './parts';

/* ------------------------------------------------------------------ *
 * Aiming
 * ------------------------------------------------------------------ */

/**
 * A half-finished action waiting for its target.
 *
 * `move` and `attract` are aimed at the board; the rest are aimed inside the
 * rail, because their targets are cards and survivors the player is already
 * looking at.
 */
export type Aim =
  | { kind: 'move' }
  | { kind: 'attract' }
  | { kind: 'attractCount'; from: LocationId }
  | { kind: 'attackEntrance' }
  | { kind: 'barricadeEntrance' }
  | { kind: 'attackSurvivor' }
  | { kind: 'equip'; iid: string }
  | { kind: 'handOff'; iid: string };

/**
 * Which of the rail's three panels this instance draws.
 *
 * `'all'` is the original behaviour — the three stacked in one column.
 */
export type TurnSection = 'all' | 'actions' | 'hand' | 'table';

export interface TurnPanelProps {
  state: GameState;
  me: PlayerId | null;
  survivorId: string | null;
  die: number | null;
  aim: Aim | null;
  picked: readonly string[];
  onSelectSurvivor: (id: string | null) => void;
  onInspectSurvivor: (id: string) => void;
  onSelectDie: (die: number | null) => void;
  onAim: (aim: Aim | null) => void;
  onPick: (iids: readonly string[]) => void;
  /** Defaults to `'all'`; see {@link TurnSection}. */
  section?: TurnSection;
}

/**
 * How the hand lays itself out for a given card count.
 *
 * A hand is a row of cards along the bottom of the screen, so its natural
 * growth direction is sideways — and sideways runs out. Rather than let it
 * scroll (V15 forbids it) or shrink every card until the text dies, the row
 * stays one line while the cards can still be read at a useful width and folds
 * to a second line after that. The grid tracks are `minmax(0, --dow-card-w)`,
 * so within a line the cards additionally shrink to whatever is available:
 * an absurd hand compacts instead of overflowing.
 */
export function handShape(count: number): { columns: number; rows: number } {
  const n = Math.max(count, 1);
  if (n <= 9) return { columns: n, rows: 1 };
  return { columns: Math.ceil(n / 2), rows: 2 };
}

/**
 * Whether this survivor could move anywhere at all.
 *
 * Movement has no single "the destination", so the button is offered when any
 * destination would be accepted. When none would be, the reason shown is the
 * engine's for the last one tried — which is the right one, because the blocks
 * that matter (already moved this turn, exiled, nowhere with a free space) all
 * report identically for every candidate.
 */
export function moveLegality(
  state: GameState,
  me: PlayerId | null,
  survivorId: string | null,
): Legality {
  if (!survivorId) return { ok: false, reason: 'Pick a survivor first.' };
  const from = state.survivors[survivorId]?.location;
  let reason = 'There is nowhere to go. §8.4';
  for (const to of moveCandidates(from)) {
    const verdict = probe(state, me, { type: 'moveSurvivor', survivorId, to });
    if (verdict.ok) return verdict;
    reason = verdict.reason;
  }
  return { ok: false, reason };
}

const moveCandidates = (from: LocationId | undefined): LocationId[] =>
  [COLONY, ...NON_COLONY_LOCATIONS].filter((id) => id !== from);

/**
 * Whether this survivor could attract anything, from anywhere.
 *
 * §7.6 pulls from "one other source location", so the answer depends on which
 * source is chosen — and probing one fixed source would report the wrong thing
 * for every survivor standing in it. This asks about each location that
 * actually has a zombie in it, and offers the action if any of them would be
 * accepted.
 */
export function attractLegality(
  state: GameState,
  me: PlayerId | null,
  survivorId: string,
  die: number,
): Legality {
  const here = state.survivors[survivorId]?.location;
  const sources = attractSources(state, here);
  if (sources.length === 0) return { ok: false, reason: 'There are no zombies anywhere else. §7.6' };

  let reason = 'That is not available right now.';
  for (const from of sources) {
    const verdict = probe(state, me, { type: 'attract', survivorId, die, from, count: 1 });
    if (verdict.ok) return verdict;
    reason = verdict.reason;
  }
  return { ok: false, reason };
}

const attractSources = (state: GameState, here: LocationId | undefined): LocationId[] =>
  [COLONY, ...NON_COLONY_LOCATIONS].filter(
    (id) =>
      id !== here &&
      (id === COLONY
        ? state.colony.entrances.some((e) => e.zombies > 0)
        : (state.locations[id]?.entrance.zombies ?? 0) > 0),
  );

/** Destinations the board should light up while a move is being aimed. */
export function legalMoveTargets(
  state: GameState,
  me: PlayerId | null,
  survivorId: string,
): LocationId[] {
  return moveCandidates(state.survivors[survivorId]?.location).filter(
    (to) => probe(state, me, { type: 'moveSurvivor', survivorId, to }).ok,
  );
}

/** A button whose disabled state and tooltip both come from the rules engine. */
function ActionButton({
  label,
  legality,
  rule,
  onClick,
  primary,
}: {
  label: string;
  legality: Legality;
  rule?: string;
  onClick: () => void;
  primary?: boolean;
}): JSX.Element {
  const button = (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="sm"
      disabled={!legality.ok}
      onClick={onClick}
    >
      {label}
    </Button>
  );
  return legality.ok ? (
    rule ? (
      <Tooltip content={label} rule={rule}>
        {button}
      </Tooltip>
    ) : (
      button
    )
  ) : (
    <Tooltip content={legality.reason} rule={rule} title="Not right now">
      {/* A disabled button emits no pointer events, so the tooltip needs a live wrapper. */}
      <span className="dow-actions__blocked">{button}</span>
    </Tooltip>
  );
}

export function TurnPanel({
  state,
  me,
  survivorId,
  die,
  aim,
  picked,
  onSelectSurvivor,
  onInspectSurvivor,
  onSelectDie,
  onAim,
  onPick,
  section = 'all',
}: TurnPanelProps): JSX.Element {
  const [foodBoost, setFoodBoost] = useState(1);
  const player = playerOf(state, me);
  const mine = survivorsOf(state, me);
  const myTurn = isMyTurn(state, me);
  const survivor = survivorId ? state.survivors[survivorId] : undefined;

  const wantsActions = section === 'all' || section === 'actions';
  const wantsHand = section === 'all' || section === 'hand';
  const wantsTable = section === 'all' || section === 'table';

  const send = (action: GameAction): void => {
    net.action(action);
    onAim(null);
    onSelectDie(null);
    onPick([]);
  };

  if (!player) {
    /* A spectator has no hand and nobody to ask, so only the acting slot
       carries the explanation — the other zones simply do not exist. */
    return wantsActions ? (
      <Panel title="Watching" padding="tight">
        <p className="tt-caption">You are not seated at this table.</p>
      </Panel>
    ) : (
      <></>
    );
  }

  const ask = (action: GameAction): Legality => probe(state, me, action);

  /* -- die actions ------------------------------------------------- */

  const dieActions = (): JSX.Element => {
    if (!survivor || die === null) {
      return (
        <p className="tt-caption">
          {mine.length === 0
            ? 'You have no survivors on the board.'
            : survivor
              ? 'Pick one of your action dice.'
              : 'Pick one of your survivors, then a die.'}
        </p>
      );
    }

    const at = survivor.location;
    const atColony = at === COLONY;
    const abilities = abilitiesOf(state, survivor.id);
    const enemies = survivorsAt(state, at).filter((s) => s.controllerId !== me);

    return (
      <div className="dow-actions">
        <ActionButton
          label="Attack a zombie"
          rule="§7.1"
          legality={ask({ type: 'attackZombie', survivorId: survivor.id, die })}
          onClick={() =>
            atColony
              ? onAim({ kind: 'attackEntrance' })
              : send({ type: 'attackZombie', survivorId: survivor.id, die })
          }
          primary
        />
        <ActionButton
          label="Search"
          rule="§7.3"
          legality={ask({ type: 'search', survivorId: survivor.id, die })}
          onClick={() => send({ type: 'search', survivorId: survivor.id, die })}
        />
        <ActionButton
          label="Barricade"
          rule="§7.4"
          legality={ask({ type: 'barricade', survivorId: survivor.id, die })}
          onClick={() =>
            atColony
              ? onAim({ kind: 'barricadeEntrance' })
              : send({ type: 'barricade', survivorId: survivor.id, die })
          }
        />
        <ActionButton
          label="Clean waste"
          rule="§7.5"
          legality={ask({ type: 'cleanWaste', die })}
          onClick={() => send({ type: 'cleanWaste', die })}
        />
        <ActionButton
          label="Attract zombies"
          rule="§7.6"
          legality={attractLegality(state, me, survivor.id, die)}
          onClick={() => onAim({ kind: 'attract' })}
        />
        <ActionButton
          label="Attack a survivor"
          rule="§7.2"
          legality={
            enemies.length === 0
              ? { ok: false, reason: 'Nobody else is here.' }
              : ask({
                  type: 'attackSurvivor',
                  survivorId: survivor.id,
                  die,
                  targetId: enemies[0]!.id,
                })
          }
          onClick={() => onAim({ kind: 'attackSurvivor' })}
        />

        {abilities.map((ability) => (
          <ActionButton
            key={`${ability.abilityId}:${ability.itemIid ?? 'self'}`}
            label={`${ability.source}: ${ability.text}`}
            rule="§7.7"
            legality={ask({
              type: 'useAbility',
              survivorId: survivor.id,
              abilityId: ability.abilityId,
              ...(ability.itemIid ? { itemIid: ability.itemIid } : {}),
              ...(ability.dieThreshold !== null ? { die } : {}),
            })}
            onClick={() =>
              send({
                type: 'useAbility',
                survivorId: survivor.id,
                abilityId: ability.abilityId,
                ...(ability.itemIid ? { itemIid: ability.itemIid } : {}),
                ...(ability.dieThreshold !== null ? { die } : {}),
              })
            }
          />
        ))}

        <div className="dow-actions__food">
          <NumberStepper
            label="Food to spend"
            value={foodBoost}
            onChange={setFoodBoost}
            min={1}
            max={Math.max(1, Math.min(5, 6 - die))}
            unit="food"
          />
          <ActionButton
            label={`Raise die to ${Math.min(6, die + foodBoost)}`}
            rule="§8.5"
            legality={ask({ type: 'spendFood', die, count: foodBoost })}
            onClick={() => send({ type: 'spendFood', die, count: foodBoost })}
          />
        </div>
      </div>
    );
  };

  /* -- aiming states ------------------------------------------------ */

  const aiming = (): JSX.Element | null => {
    if (!aim || !survivor) return null;

    switch (aim.kind) {
      case 'move':
        return <AimNote text="Choose a location on the board to move to." onCancel={() => onAim(null)} />;

      case 'attract':
        return <AimNote text="Choose the location to pull zombies from." onCancel={() => onAim(null)} />;

      case 'attractCount': {
        const from = aim.from;
        return (
          <div className="dow-aim">
            <span className="dow-aim__text">
              Pull how many zombies from {locationName(from)}? <em>§18.1: fewer than two is legal.</em>
            </span>
            <div className="dow-aim__row">
              {[0, 1, 2].map((count) => (
                <ActionButton
                  key={count}
                  label={String(count)}
                  legality={
                    die === null
                      ? { ok: false, reason: 'Pick a die first.' }
                      : ask({ type: 'attract', survivorId: survivor.id, die, from, count })
                  }
                  onClick={() =>
                    die !== null &&
                    send({ type: 'attract', survivorId: survivor.id, die, from, count })
                  }
                />
              ))}
              <Button variant="ghost" size="sm" onClick={() => onAim(null)}>
                Cancel
              </Button>
            </div>
          </div>
        );
      }

      case 'attackEntrance':
      case 'barricadeEntrance': {
        const attacking = aim.kind === 'attackEntrance';
        return (
          <div className="dow-aim">
            <span className="dow-aim__text">
              {attacking ? 'Which entrance is the zombie at?' : 'Which entrance do you barricade?'}
            </span>
            <div className="dow-aim__row">
              {entrancesOf(state, survivor.location).map((entrance) => {
                const action: GameAction = attacking
                  ? {
                      type: 'attackZombie',
                      survivorId: survivor.id,
                      die: die ?? 0,
                      entrance: entrance.index,
                    }
                  : {
                      type: 'barricade',
                      survivorId: survivor.id,
                      die: die ?? 0,
                      entrance: entrance.index,
                    };
                return (
                  <ActionButton
                    key={entrance.index}
                    label={`Entrance ${entrance.index} · ${entrance.zombies} zombies · ${entrance.barricades} barricades · ${entranceFree(entrance)} open`}
                    legality={die === null ? { ok: false, reason: 'Pick a die first.' } : ask(action)}
                    onClick={() => send(action)}
                  />
                );
              })}
              <Button variant="ghost" size="sm" onClick={() => onAim(null)}>
                Cancel
              </Button>
            </div>
          </div>
        );
      }

      case 'attackSurvivor': {
        const targets = survivorsAt(state, survivor.location).filter(
          (s) => s.controllerId !== me,
        );
        return (
          <div className="dow-aim">
            <span className="dow-aim__text">Attack which survivor? §7.2</span>
            <div className="dow-aim__row">
              {targets.map((target) => (
                <ActionButton
                  key={target.id}
                  label={`${survivorName(state, target.id)} (${state.players[target.controllerId]?.name ?? '?'})`}
                  legality={
                    die === null
                      ? { ok: false, reason: 'Pick a die first.' }
                      : ask({
                          type: 'attackSurvivor',
                          survivorId: survivor.id,
                          die,
                          targetId: target.id,
                        })
                  }
                  onClick={() =>
                    die !== null &&
                    send({
                      type: 'attackSurvivor',
                      survivorId: survivor.id,
                      die,
                      targetId: target.id,
                    })
                  }
                />
              ))}
              <Button variant="ghost" size="sm" onClick={() => onAim(null)}>
                Cancel
              </Button>
            </div>
          </div>
        );
      }

      case 'equip': {
        const iid = aim.iid;
        return (
          <div className="dow-aim">
            <span className="dow-aim__text">Give {itemName(state, iid)} to which survivor?</span>
            <div className="dow-aim__row">
              {mine.map((target) => (
                <ActionButton
                  key={target.id}
                  label={survivorName(state, target.id)}
                  legality={ask({ type: 'playItem', iid, targetSurvivorId: target.id })}
                  onClick={() => send({ type: 'playItem', iid, targetSurvivorId: target.id })}
                />
              ))}
              <Button variant="ghost" size="sm" onClick={() => onAim(null)}>
                Cancel
              </Button>
            </div>
          </div>
        );
      }

      case 'handOff': {
        const iid = aim.iid;
        const here = survivorsAt(state, survivor.location).filter((s) => s.id !== survivor.id);
        return (
          <div className="dow-aim">
            <span className="dow-aim__text">
              Hand {itemName(state, iid)} to whom? §8.7 — the recipient's controller has to accept.
            </span>
            <div className="dow-aim__row">
              {here.length === 0 ? <span className="tt-caption">Nobody else is here.</span> : null}
              {here.map((target) => (
                <ActionButton
                  key={target.id}
                  label={`${survivorName(state, target.id)} (${state.players[target.controllerId]?.name ?? '?'})`}
                  legality={ask({ type: 'handOff', iid, toSurvivorId: target.id })}
                  onClick={() => send({ type: 'handOff', iid, toSurvivorId: target.id })}
                />
              ))}
              <Button variant="ghost" size="sm" onClick={() => onAim(null)}>
                Cancel
              </Button>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  /* -- hand --------------------------------------------------------- */

  const objectiveSide = mainObjectiveSide(state);
  const toggle = (iid: string): void =>
    onPick(picked.includes(iid) ? picked.filter((x) => x !== iid) : [...picked, iid]);

  const single = picked.length === 1 ? picked[0]! : null;
  const shape = handShape(player.hand.length);

  /* Built lazily: each one probes the rules engine, and a section that is not
     being drawn should not pay for the answers. */

  const actingPanel = (): JSX.Element => (
    <Panel
      padding="tight"
      title="Your turn"
      className="dow-panel--acting"
      actions={
        myTurn ? (
          <Badge tone="success" dot>
            Acting
          </Badge>
        ) : (
          <Badge tone="neutral">Waiting</Badge>
        )
      }
    >
      <div className="dow-dice">
        <span className="dow-dice__label">Action dice</span>
        <div className="dow-dice__row">
          {player.unusedDice.map((value, i) => (
            <Die
              key={`u${i}`}
              value={value}
              selected={die === value}
              onClick={() => onSelectDie(die === value ? null : value)}
            />
          ))}
          {player.usedDice.map((value, i) => (
            <Die key={`s${i}`} value={value} spent title="Already spent this turn" />
          ))}
          {player.unusedDice.length === 0 && player.usedDice.length === 0 ? (
            <span className="tt-caption">No dice yet.</span>
          ) : null}
        </div>
      </div>

      <div className="dow-mine">
        <span className="dow-dice__label">Your survivors</span>
        <div className="dow-mine__row">
          {mine.map((s) => (
            <SurvivorChip
              key={s.id}
              state={state}
              survivor={s}
              selected={s.id === survivorId}
              onClick={() => {
                onSelectSurvivor(s.id === survivorId ? null : s.id);
                onInspectSurvivor(s.id);
              }}
            />
          ))}
          {mine.length === 0 ? <span className="tt-caption">None left.</span> : null}
        </div>
      </div>

      {aiming()}
      {dieActions()}

      <div className="dow-actions dow-actions--free">
        <ActionButton
          label="Move"
          rule="§8.4"
          legality={moveLegality(state, me, survivor?.id ?? null)}
          onClick={() => onAim({ kind: 'move' })}
        />
        {survivor
          ? survivor.equipped.map((iid) => (
              <ActionButton
                key={iid}
                label={`Hand off ${itemName(state, iid)}`}
                rule="§8.7"
                legality={ask({
                  type: 'handOff',
                  iid,
                  toSurvivorId:
                    survivorsAt(state, survivor.location).find((s) => s.id !== survivor.id)?.id ??
                    survivor.id,
                })}
                onClick={() => onAim({ kind: 'handOff', iid })}
              />
            ))
          : null}
        <ActionButton
          label="End turn"
          rule="§5.1"
          legality={ask({ type: 'endTurn' })}
          onClick={() => send({ type: 'endTurn' })}
        />
      </div>
    </Panel>
  );

  const handPanel = (): JSX.Element => (
    <Panel
      padding="tight"
      title="Your hand"
      subtitle="Only you can see these cards"
      className="dow-panel--private dow-panel--hand"
      actions={<Badge tone="info">{player.hand.length}</Badge>}
    >
      <div
        className="dow-hand"
        style={
          {
            '--dow-hand-cols': shape.columns,
            '--dow-hand-rows': shape.rows,
          } as React.CSSProperties
        }
      >
        {player.hand.length === 0 ? <span className="tt-caption">Empty.</span> : null}
        {player.hand.map((iid) => (
          <ItemCard
            key={iid}
            state={state}
            iid={iid}
            selected={picked.includes(iid)}
            onClick={() => toggle(iid)}
          />
        ))}
      </div>

      <div className="dow-actions dow-actions--free">
        {/* §8.1: an equip card needs a survivor to go on; a one-shot resolves
            and goes straight to the waste pile, so it never asks. */}
        <ActionButton
          label={
            single !== null && itemDef(state, single)?.kind === 'equip' ? 'Equip card' : 'Play card'
          }
          rule="§8.1"
          legality={
            single === null
              ? { ok: false, reason: 'Select exactly one card.' }
              : itemDef(state, single)?.kind === 'equip'
                ? mine.length === 0
                  ? { ok: false, reason: 'You have no survivor to equip. §8.1' }
                  : ask({ type: 'playItem', iid: single, targetSurvivorId: mine[0]!.id })
                : ask({ type: 'playItem', iid: single })
          }
          onClick={() => {
            if (!single) return;
            if (itemDef(state, single)?.kind === 'equip') onAim({ kind: 'equip', iid: single });
            else send({ type: 'playItem', iid: single });
          }}
        />
        <ActionButton
          label={`Add ${picked.length || ''} to the crisis`.replace('  ', ' ')}
          rule="§8.2"
          legality={
            picked.length === 0
              ? { ok: false, reason: 'Select the cards to contribute.' }
              : ask({ type: 'contributeCrisis', iids: [...picked] })
          }
          onClick={() => send({ type: 'contributeCrisis', iids: [...picked] })}
        />
        <ActionButton
          label="Add to the objective"
          rule="§8.3"
          legality={
            !objectiveSide?.contribution
              ? { ok: false, reason: 'This objective takes no contributions. §8.3' }
              : picked.length === 0
                ? { ok: false, reason: 'Select the cards to contribute.' }
                : ask({ type: 'contributeObjective', iids: [...picked] })
          }
          onClick={() => send({ type: 'contributeObjective', iids: [...picked] })}
        />
      </div>
    </Panel>
  );

  const tablePanel = (): JSX.Element => (
    <Panel padding="tight" title="Ask the table" className="dow-panel--public">
      <div className="dow-actions dow-actions--free">
        {state.seating
          .filter((id) => id !== me)
          .map((id) => {
            const other = state.players[id];
            if (!other) return null;
            return (
              <span key={id} className="dow-table__row">
                <span className="dow-table__name">{other.name}</span>
                <ActionButton
                  label="Ask for a card"
                  rule="§8.6"
                  legality={ask({ type: 'requestCards', fromPlayerId: id })}
                  onClick={() => send({ type: 'requestCards', fromPlayerId: id })}
                />
                <ActionButton
                  label="Call a vote to exile"
                  rule="§8.8"
                  legality={ask({ type: 'nominateExile', targetPlayerId: id })}
                  onClick={() => send({ type: 'nominateExile', targetPlayerId: id })}
                />
              </span>
            );
          })}
      </div>
    </Panel>
  );

  const sections = (
    <>
      {wantsActions ? actingPanel() : null}
      {wantsHand ? handPanel() : null}
      {wantsTable ? tablePanel() : null}
    </>
  );

  /* The original single-column rail is still what `'all'` renders, wrapper and
     all, so nothing that styles `.dow-rail` has to know about sections. */
  return section === 'all' ? <div className="dow-rail">{sections}</div> : sections;
}

function AimNote({ text, onCancel }: { text: string; onCancel: () => void }): JSX.Element {
  return (
    <div className="dow-aim">
      <span className="dow-aim__text">{text}</span>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
