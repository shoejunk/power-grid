import { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';

import { LoadingSpinner } from '../ui';
import { useMatch } from './model';

/**
 * Mount point for the board renderer, which is owned by another agent.
 *
 * `import.meta.glob` rather than a bare dynamic import: the glob resolves to an
 * empty record when `src/board/` does not exist yet, so this file compiles and
 * the match screen runs either way. Once the board lands, it is code-split and
 * loaded on demand.
 */
const boardModules = import.meta.glob<Record<string, unknown>>('../board/index.{ts,tsx}');
const boardEntry = Object.values(boardModules)[0];

const LazyBoard = boardEntry
  ? lazy(async () => {
      const mod = await boardEntry();
      const Component = mod.GameBoard as ComponentType | undefined;
      return { default: Component ?? BoardPlaceholder };
    })
  : null;

export function BoardSlot(): JSX.Element {
  if (!LazyBoard) return <BoardPlaceholder />;
  return (
    <BoardBoundary>
      <Suspense
        fallback={
          <div className="pg-gboard pg-gboard--loading">
            <LoadingSpinner size="lg" label="Drawing the grid" />
          </div>
        }
      >
        <LazyBoard />
      </Suspense>
    </BoardBoundary>
  );
}

/**
 * The board is a separate module with its own owner. If it fails to load or
 * throws while rendering, the match screen must keep working — the HUD, markets,
 * phase panel and log are all still playable without it (quality bar U9).
 */
class BoardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error('[power-grid] board renderer failed', error);
  }

  override render(): ReactNode {
    return this.state.failed ? <BoardPlaceholder /> : this.props.children;
  }
}

/**
 * Stand-in for the board. Deliberately not an error state: it shows the zone,
 * the cities in play and the network standings, so the screen still reads as a
 * finished product while the renderer is being built.
 */
function BoardPlaceholder(): JSX.Element {
  const { state, map } = useMatch();
  const zoneAreas = map.areas.filter((a) => state.zone.includes(a.id));
  const cities = map.cities.filter((c) => state.zone.includes(c.area));

  return (
    <div className="pg-gboard">
      <div className="pg-gboard__grid" aria-hidden="true" />
      <div className="pg-gboard__inner">
        <span className="tt-overline">{map.name}</span>
        <h2 className="pg-gboard__title">
          {cities.length} cities in play
        </h2>
        <div className="pg-gboard__areas">
          {zoneAreas.map((area) => (
            <span key={area.id} className="pg-gboard__area" style={{ ['--pg-area' as string]: area.color }}>
              <i />
              {area.name}
              <b className="tt-numeral">{map.cities.filter((c) => c.area === area.id).length}</b>
            </span>
          ))}
        </div>
        <div className="pg-gboard__nets">
          {state.playerOrder
            .map((id) => state.players[id])
            .filter((p) => p !== undefined && !p.isTrust)
            .map((player) => (
              <span key={player!.id} className="pg-gboard__net" data-player-color={player!.color}>
                <i />
                {player!.name}
                <b className="tt-numeral">{player!.cities.length}</b>
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
