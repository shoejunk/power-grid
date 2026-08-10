/**
 * Board renderer — public surface.
 *
 * `GameScreen`'s `<BoardMount>` takes this and nothing else. Everything the
 * board needs it reads for itself from `useGameStore`, and everything it sends
 * goes through `net.action`.
 */
export { GameBoard } from './GameBoard';
