/**
 * The content half of `@game/dead-of-winter`.
 *
 * A catalog author needs `schema`, `effects` and `primitives`, and nothing
 * else; the engine additionally needs `validate`. `testPack` is exported
 * because the engine's own tests depend on it, and because it is the only
 * worked example of the schema until the licensed catalog lands — but it is a
 * fixture, and its own header says so.
 */

export * from './primitives.js';
export * from './effects.js';
export * from './schema.js';
export * from './validate.js';
export { TEST_PACK } from './testPack.js';
