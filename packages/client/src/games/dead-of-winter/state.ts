import type { GameState } from '@game/dead-of-winter';

import { useGameStore } from '@/net';

/**
 * The one place the opaque store snapshot becomes a Dead of Winter state.
 *
 * Guarded by `gameKey`: if this browser is seated at some other game's table
 * the answer is `null` rather than a lie. The snapshot is always the *redacted*
 * view — other players' hands are opaque placeholders and the seed is blank —
 * so nothing downstream may assume it can read a card it was not shown.
 */
export function useDeadOfWinterState(): GameState | null {
  return useGameStore((s) =>
    s.gameKey === 'dead-of-winter' ? ((s.state as GameState | null) ?? null) : null,
  );
}
