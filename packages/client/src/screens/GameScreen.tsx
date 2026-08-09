import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameMap, LegalActions, MapCity } from '@pg/shared';
import { END_GAME_THRESHOLD, STEP2_THRESHOLD, getMap, legalActions } from '@pg/shared';

import { BoardSlot } from '../game/BoardSlot';
import { PlayerHud } from '../game/Hud';
import { MomentOverlay } from '../game/MomentOverlay';
import { PhaseRail } from '../game/PhaseRail';
import { RulesLog } from '../game/RulesLog';
import { RulesSheet } from '../game/RulesSheet';
import { TurnOrderRail } from '../game/TurnOrderRail';
import { PHASE_META } from '../game/format';
import { MatchProvider, noLegalActions, type MatchValue } from '../game/model';
import '../game/game.scss';
import { net, useGameStore } from '../net';
import { springSoft } from '../styles/motion';
import {
  Badge,
  Button,
  ConnectionPill,
  IconBolt,
  IconLogout,
  LoadingSpinner,
  Tooltip,
} from '../ui';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { AmbientBackdrop, Wordmark } from '../ui/Artwork';

/* ==================================================================== *
 * MOUNT POINTS
 * --------------------------------------------------------------------
 * The board renderer plugs into <BoardMount>. The HUD and phase-panel
 * mounts are filled in this file; they stay exported because the grid
 * areas they carry are part of the layout contract.
 *
 * Contract for the board renderer:
 *   · The region is already sized by CSS grid — fill 100% of it, do not
 *     set your own width/height or margins.
 *   · Do not introduce a new scroll container in <BoardMount>.
 *   · Read state from `useGameStore((s) => s.gameState)` and send with
 *     `net.action(...)`. Never talk to the socket directly.
 * ==================================================================== */

interface MountProps {
  children?: ReactNode;
}

/** MOUNT POINT — the board renderer. Region: centre of the match grid. */
export function BoardMount({ children }: MountProps): JSX.Element {
  return (
    <div className="pg-mount pg-mount--board" data-mount="board">
      {children}
    </div>
  );
}

/** MOUNT POINT — the per-phase interaction panel. Region: right rail. */
export function PhasePanelMount({ children }: MountProps): JSX.Element {
  return (
    <div className="pg-mount pg-mount--phase" data-mount="phase-panel">
      {children}
    </div>
  );
}

/** MOUNT POINT — the persistent heads-up display. Region: top bar. */
export function HudMount({ children }: MountProps): JSX.Element {
  return (
    <div className="pg-mount pg-mount--hud" data-mount="hud">
      {children}
    </div>
  );
}

/* ==================================================================== *
 * The match screen
 * ==================================================================== */

const PHASE_KEYS = ['order', 'auction', 'resources', 'building', 'bureaucracy'] as const;

/**
 * Match screen.
 *
 * Desktop-first and deliberately dense (quality bar V10): at 1920x1080 the HUD,
 * the turn-order rail, the board, both markets, the phase panel and the rules log
 * are all on screen at once, with no scrolling and no menu to open.
 *
 *   ┌───────────────────────── HUD ─────────────────────────┐
 *   │ rail │            board             │ plant market    │
 *   │ rail │                              │ resource market │
 *   │ rail │─────────── rules log ────────│ phase panel     │
 *   └───────────────────────────────────────────────────────┘
 */
export function GameScreen(): JSX.Element {
  const gameState = useGameStore((s) => s.gameState);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  const match = useMemo<MatchValue | null>(() => {
    if (!gameState) return null;
    const map: GameMap = getMap(gameState.settings.mapId);
    const cityIndex = new Map<string, MapCity>(map.cities.map((c) => [c.id, c]));
    const me = myPlayerId ? (gameState.players[myPlayerId] ?? null) : null;

    let legal: LegalActions;
    try {
      legal = me ? legalActions(gameState, me.id) : noLegalActions(gameState, myPlayerId ?? '');
    } catch {
      // A seat the engine has not heard of (spectator, stale token) must still
      // render the match rather than crash the screen.
      legal = noLegalActions(gameState, myPlayerId ?? '');
    }

    return {
      state: gameState,
      meId: me?.id ?? null,
      me,
      legal,
      map,
      cityIndex,
      isMyTurn: me !== null && legal.isActive,
    };
  }, [gameState, myPlayerId]);

  if (!gameState || !match) {
    return (
      <div className="pg-screen pg-game">
        <AmbientBackdrop />
        <LoadingSpinner size="lg" label="Building the board" />
      </div>
    );
  }

  const count = gameState.settings.playerCount;
  const step2At = STEP2_THRESHOLD[count] ?? 7;
  const endAt = END_GAME_THRESHOLD[count] ?? 17;
  const leader = Object.values(gameState.players)
    .filter((p) => !p.isTrust)
    .reduce((best, p) => Math.max(best, p.cities.length), 0);

  return (
    <MatchProvider value={match}>
      <div className="pg-screen pg-game">
        <AmbientBackdrop grid={false} />

        {/* -------- chrome -------- */}
        <header className="pg-game__chrome">
          <div className="pg-game__chrome-left">
            <Wordmark compact />
            <span className="pg-rule pg-rule--v" />
            <Badge tone="accent" size="lg">
              Round {gameState.round}
            </Badge>
            <Badge tone="info" size="lg" icon={<IconBolt />}>
              Step {gameState.step}
            </Badge>
            <Tooltip
              placement="bottom"
              title="How close is the end?"
              rule="§10 Step 2, §11 End of game"
              content={`With ${count} players, Step 2 begins at ${step2At} connected cities and the game ends after Phase 4 once anyone reaches ${endAt}. The largest network right now is ${leader}.`}
            >
              <div className="pg-gclock" tabIndex={0}>
                <span className="pg-gclock__track" aria-hidden="true">
                  <motion.span
                    className="pg-gclock__fill"
                    animate={{ width: `${Math.min(100, (leader / endAt) * 100)}%` }}
                    transition={springSoft}
                  />
                  <span
                    className="pg-gclock__mark"
                    style={{ left: `${(step2At / endAt) * 100}%` }}
                    data-reached={gameState.step >= 2}
                  />
                </span>
                <span className="pg-gclock__legend">
                  <b className="pg-numeral">{leader}</b>
                  <em>
                    Step 2 at {step2At} · ends at {endAt}
                  </em>
                </span>
              </div>
            </Tooltip>
          </div>

          <div className="pg-game__phaserail" role="list" aria-label="Round phases">
            {PHASE_KEYS.map((key) => {
              const meta = PHASE_META[key];
              const active = key === gameState.phase;
              return (
                <div
                  key={key}
                  role="listitem"
                  className="pg-phasepip"
                  data-active={active}
                  title={`${meta.name} — ${meta.summary} (${meta.rule})`}
                >
                  {active ? (
                    <motion.span layoutId="phase-pip" className="pg-phasepip__glow" transition={springSoft} />
                  ) : null}
                  <span className="pg-phasepip__index pg-numeral">{meta.index}</span>
                  <span className="pg-phasepip__name">{meta.name}</span>
                </div>
              );
            })}
          </div>

          <div className="pg-game__chrome-right">
            <RulesSheet />
            <ConnectionPill />
            <Button
              variant="ghost"
              size="sm"
              icon={<IconLogout />}
              onClick={() => setLeaveDialogOpen(true)}
            >
              Leave
            </Button>
          </div>
        </header>

        {/* -------- the match grid -------- */}
        <div className="pg-game__grid pg-gamex__grid">
          <HudMount>
            <PlayerHud />
          </HudMount>

          <aside className="pg-game__rail" aria-label="Turn order">
            <TurnOrderRail />
          </aside>

          <BoardMount>
            <BoardSlot />
          </BoardMount>

          <section className="pg-game__log" aria-label="Rules log">
            <RulesLog />
          </section>

          <PhasePanelMount>
            <PhaseRail />
          </PhasePanelMount>
        </div>

        <MomentOverlay />

        <ConfirmDialog
          open={leaveDialogOpen}
          onCancel={() => setLeaveDialogOpen(false)}
          onConfirm={() => {
            setLeaveDialogOpen(false);
            net.leaveGame();
          }}
          title="Leave this game?"
          description="You will be disconnected from the table. Your seat remains in an active game, but you will stop receiving updates here."
          confirmLabel="Leave game"
          confirmVariant="danger"
        />
      </div>
    </MatchProvider>
  );
}
