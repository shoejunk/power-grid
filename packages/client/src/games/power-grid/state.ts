import { useGameStore } from '@/net';
import type { GameState } from '@game/power-grid';

/**
 * The one place the opaque store snapshot becomes a Power Grid state.
 *
 * The platform deliberately carries `state: unknown` — it has no business
 * knowing what a plant or a resource market is. This is the boundary where
 * that changes, and it is guarded by `gameKey`: if the browser is seated at
 * some other game's table, the answer is `null` rather than a lie.
 */
export function usePowerGridState(): GameState | null {
  return useGameStore((s) =>
    s.gameKey === 'power-grid' ? ((s.state as GameState | null) ?? null) : null,
  );
}
