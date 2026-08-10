/**
 * `@tt/core` — the game-agnostic half of the platform.
 *
 * Nothing exported here knows what game is being played. If you find yourself
 * wanting to add a resource type, a phase name, a card or a rule, it belongs
 * in a `@game/*` package instead.
 */

export * from './types.js';
export * from './plugin.js';
export * from './protocol.js';
export * from './registry.js';
export * from './rng.js';
export * from './validate.js';
