import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { PHASES } from '../data/rules';
import { net, useGameStore } from '../net';
import { springSoft } from '../styles/motion';
import {
  Badge,
  Button,
  ConnectionPill,
  IconBolt,
  IconLogout,
  LoadingSpinner,
  Panel,
} from '../ui';
import { AmbientBackdrop, Wordmark } from '../ui/Artwork';

/* ==================================================================== *
 * MOUNT POINTS FOR LATER AGENTS
 * --------------------------------------------------------------------
 * This file owns the match-screen *frame* only: the grid, the rails and
 * the chrome. The three components below are the seams where the board
 * renderer and the phase UI plug in.
 *
 * Each one accepts `children`. Pass content and it renders it flush
 * inside the reserved region; pass nothing and it renders a labelled
 * placeholder so the layout is still measurable and screenshot-able.
 *
 * Contract for whoever implements them:
 *   · The region is already sized by CSS grid — fill 100% of it, do not
 *     set your own width/height or margins.
 *   · Do not introduce a new scroll container in <BoardMount>; the board
 *     is expected to pan/zoom inside a fixed viewport.
 *   · Read state from `useGameStore((s) => s.gameState)` and send with
 *     `net.action(...)`. Never talk to the socket directly.
 * ==================================================================== */

interface MountProps {
  children?: ReactNode;
}

/**
 * MOUNT POINT — the PixiJS board renderer.
 * Owner: board-renderer agent. Region: centre of the match grid.
 */
export function BoardMount({ children }: MountProps): JSX.Element {
  return (
    <div className="pg-mount pg-mount--board" data-mount="board">
      {children ?? <MountPlaceholder title="Board renderer" hint="<BoardMount />" />}
    </div>
  );
}

/**
 * MOUNT POINT — the per-phase interaction panel (auction, resource market,
 * building, bureaucracy).
 * Owner: phase-panel agent. Region: right rail of the match grid.
 */
export function PhasePanelMount({ children }: MountProps): JSX.Element {
  return (
    <div className="pg-mount pg-mount--phase" data-mount="phase-panel">
      {children ?? <MountPlaceholder title="Phase panel" hint="<PhasePanelMount />" />}
    </div>
  );
}

/**
 * MOUNT POINT — the persistent heads-up display: money, plants, houses,
 * turn order, round/step readout.
 * Owner: phase-panel agent. Region: top bar of the match grid.
 */
export function HudMount({ children }: MountProps): JSX.Element {
  return (
    <div className="pg-mount pg-mount--hud" data-mount="hud">
      {children ?? <MountPlaceholder title="Player HUD" hint="<HudMount />" inline />}
    </div>
  );
}

function MountPlaceholder({
  title,
  hint,
  inline = false,
}: {
  title: string;
  hint: string;
  inline?: boolean;
}): JSX.Element {
  return (
    <div className={`pg-mount__placeholder${inline ? ' is-inline' : ''}`}>
      <span className="pg-mount__ticks" aria-hidden="true" />
      <div className="pg-mount__label">
        <span className="pg-overline">Reserved region</span>
        <span className="pg-mount__title">{title}</span>
        <code className="pg-mount__code">{hint}</code>
      </div>
    </div>
  );
}

/* ==================================================================== *
 * The match frame
 * ==================================================================== */

/**
 * Match screen layout skeleton.
 *
 * The grid is deliberately desktop-first and information-dense (quality bar
 * V10): at 1920x1080 the HUD, the turn-order rail, the board, the phase panel
 * and the rules log are all on screen simultaneously, with no scrolling and no
 * menu to open.
 *
 *   ┌───────────────────────── HUD ─────────────────────────┐
 *   │ rail │            board             │  phase panel    │
 *   │ rail │─────────── rules log ────────│                 │
 *   └───────────────────────────────────────────────────────┘
 */
export function GameScreen(): JSX.Element {
  const gameState = useGameStore((s) => s.gameState);

  if (!gameState) {
    return (
      <div className="pg-screen pg-game">
        <AmbientBackdrop />
        <LoadingSpinner size="lg" label="Building the board" />
      </div>
    );
  }

  const currentPhase = PHASES.find((p) => p.key === gameState.phase);

  return (
    <div className="pg-screen pg-game">
      <AmbientBackdrop grid={false} />

      {/* -------- chrome: top bar -------- */}
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
        </div>

        <div className="pg-game__phaserail" role="list" aria-label="Round phases">
          {PHASES.map((phase) => {
            const active = phase.key === gameState.phase;
            return (
              <div
                key={phase.key}
                role="listitem"
                className="pg-phasepip"
                data-active={active}
                title={phase.summary}
              >
                {active ? (
                  <motion.span
                    layoutId="phase-pip"
                    className="pg-phasepip__glow"
                    transition={springSoft}
                  />
                ) : null}
                <span className="pg-phasepip__index pg-numeral">{phase.index}</span>
                <span className="pg-phasepip__name">{phase.name}</span>
              </div>
            );
          })}
        </div>

        <div className="pg-game__chrome-right">
          <ConnectionPill />
          <Button variant="ghost" size="sm" icon={<IconLogout />} onClick={() => net.leaveGame()}>
            Leave
          </Button>
        </div>
      </header>

      {/* -------- the match grid -------- */}
      <div className="pg-game__grid">
        <HudMount />

        <aside className="pg-game__rail" aria-label="Turn order">
          <Panel
            padding="tight"
            title="Turn order"
            subtitle={currentPhase ? currentPhase.name : gameState.phase}
            className="pg-game__railpanel"
          >
            <div className="pg-mount__placeholder is-inline" data-mount="turn-order">
              <div className="pg-mount__label">
                <span className="pg-overline">Reserved region</span>
                <span className="pg-mount__title">Player rail</span>
                <code className="pg-mount__code">&lt;HudMount /&gt; sibling</code>
              </div>
            </div>
          </Panel>
        </aside>

        <BoardMount />

        <section className="pg-game__log" aria-label="Rules log">
          <Panel padding="tight" title="Rules log" subtitle="Every automatic transition, explained">
            <div className="pg-game__logbody">
              {gameState.log.slice(-6).map((entry) => (
                <div key={entry.id} className="pg-logline">
                  <span className="pg-logline__cat">{entry.category}</span>
                  <span className="pg-logline__text">{entry.message}</span>
                </div>
              ))}
              {gameState.log.length === 0 ? (
                <span className="pg-caption">The log will fill as the game resolves.</span>
              ) : null}
            </div>
          </Panel>
        </section>

        <PhasePanelMount />
      </div>
    </div>
  );
}
