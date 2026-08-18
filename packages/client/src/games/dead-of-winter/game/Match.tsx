/**
 * Dead of Winter's match screen.
 *
 * Desktop-first and deliberately flat: vitals and the two cards the table is
 * playing against across the top, the board in the middle, the rail you act
 * from on the right, the log and the seats underneath. No tabs, no drawers —
 * §21 asks for the whole game state to be legible at once, and a colony that
 * has to be paged through is a colony you lose track of.
 *
 * All interaction state lives here, because both the board and the rail need
 * it: the board highlights destinations while the rail is aiming a move, and
 * the rail acts on the survivor the board selected.
 */

import type { LocationId } from '@game/dead-of-winter';
import { ConfirmDialog, Badge, Button, IconLogout, LoadingSpinner, Panel } from '@tt/ui';
import { useEffect, useMemo, useState } from 'react';

import { ConnectionPill, net, useGameStore } from '@/net';

import { packMatches } from '../content';
import { useDeadOfWinterState } from '../state';
import { Board } from './Board';
import { ChoiceDialog } from './ChoiceDialog';
import { GameOverPanel } from './GameOverPanel';
import { LogPanel } from './LogPanel';
import { Seats } from './Seats';
import { TopBar } from './TopBar';
import { TurnPanel, legalMoveTargets, type Aim } from './TurnPanel';
import { VotePanel } from './VotePanel';
import { allLocations, isMyTurn, myChoice, survivorsOf, tableChoice, zombiesAt } from './model';
import './dead-of-winter.scss';

export function DeadOfWinterMatch(): JSX.Element {
  const state = useDeadOfWinterState();
  const me = useGameStore((s) => s.myPlayerId);

  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [die, setDie] = useState<number | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [choiceOpen, setChoiceOpen] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const choice = state ? myChoice(state, me) : null;
  const waiting = state ? tableChoice(state) : null;

  /* A new decision always arrives open, however the last one was dismissed. */
  useEffect(() => setChoiceOpen(true), [choice?.id]);

  /* A survivor who died, or a die that was spent, must not stay selected. */
  useEffect(() => {
    if (state && survivorId && !state.survivors[survivorId]) {
      setSurvivorId(null);
      setAim(null);
    }
  }, [state, survivorId]);

  const actable = useMemo(() => {
    if (!state) return new Set<string>();
    return new Set(survivorsOf(state, me).map((s) => s.id));
  }, [state, me]);

  if (!state) {
    return (
      <div className="tt-screen dow-match dow-match--empty">
        <LoadingSpinner size="lg" label="Reaching the colony" />
      </div>
    );
  }

  /* -- what the board is currently being asked for ------------------ */

  let targets: LocationId[] | null = null;
  let targetLabel = '';
  if (aim?.kind === 'move' && survivorId) {
    targets = legalMoveTargets(state, me, survivorId);
    targetLabel = 'Move here';
  } else if (aim?.kind === 'attract' && survivorId) {
    // §7.6: one *other* source location, and only somewhere with zombies to take.
    const here = state.survivors[survivorId]?.location;
    targets = allLocations.filter((id) => id !== here && zombiesAt(state, id) > 0);
    targetLabel = 'Pull from here';
  }

  const pickLocation = (id: LocationId): void => {
    if (!survivorId) return;
    if (aim?.kind === 'move') {
      net.action({ type: 'moveSurvivor', survivorId, to: id });
      setAim(null);
    } else if (aim?.kind === 'attract') {
      setAim({ kind: 'attractCount', from: id });
    }
  };

  const myTurn = isMyTurn(state, me);

  return (
    <div className="tt-screen dow-match">
      <header className="dow-match__bar">
        <span className="dow-match__title">
          Dead of Winter
          <span className="dow-match__code">{state.code}</span>
        </span>
        <span className="dow-match__status">
          {choice ? (
            <Button variant="primary" size="sm" onClick={() => setChoiceOpen(true)}>
              You have a decision
            </Button>
          ) : waiting ? (
            <Badge tone="info" dot>
              Waiting on {state.players[waiting.playerId ?? '']?.name ?? 'the table'}
            </Badge>
          ) : myTurn ? (
            <Badge tone="success" dot>
              Your turn
            </Badge>
          ) : (
            <Badge tone="neutral">
              {state.turn ? `${state.players[state.turn.playerId]?.name ?? '—'} is playing` : '—'}
            </Badge>
          )}
          <ConnectionPill />
          <Button variant="ghost" size="sm" icon={<IconLogout />} onClick={() => setLeaving(true)}>
            Leave
          </Button>
        </span>
      </header>

      {packMatches(state) ? null : (
        <Panel padding="tight" tone="glass" className="dow-match__warn">
          <p className="tt-caption">
            This table was created against content pack {state.contentPackId}@{state.contentVersion},
            which this build does not carry. Card names and text may be wrong. §22
          </p>
        </Panel>
      )}

      <TopBar state={state} me={me} />

      <main className="dow-match__main">
        <section className="dow-match__board">
          <Board
            state={state}
            selectedSurvivorId={survivorId}
            onSelectSurvivor={setSurvivorId}
            targets={targets}
            targetLabel={targetLabel}
            onPickLocation={pickLocation}
            actableSurvivorIds={actable}
          />
        </section>

        <aside className="dow-match__rail">
          <VotePanel state={state} me={me} />
          <TurnPanel
            state={state}
            me={me}
            survivorId={survivorId}
            die={die}
            aim={aim}
            picked={picked}
            onSelectSurvivor={setSurvivorId}
            onSelectDie={setDie}
            onAim={setAim}
            onPick={setPicked}
          />
        </aside>
      </main>

      <footer className="dow-match__foot">
        <Seats state={state} me={me} />
        <LogPanel state={state} />
      </footer>

      {choice ? (
        <ChoiceDialog
          state={state}
          choice={choice}
          open={choiceOpen}
          onClose={() => setChoiceOpen(false)}
        />
      ) : null}

      {state.phase === 'gameOver' ? <GameOverPanel state={state} me={me} /> : null}

      <ConfirmDialog
        open={leaving}
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          net.leaveGame();
        }}
        title="Leave the colony?"
        description="Your seat stays in the game, but this browser stops receiving it."
        confirmLabel="Leave"
        confirmVariant="danger"
      />
    </div>
  );
}
