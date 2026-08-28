/**
 * The content half of `@game/dead-of-winter`.
 *
 * A catalog author needs `schema`, `effects` and `primitives`, and nothing
 * else; the engine additionally needs `validate`. `testPack` is exported
 * because the engine's own tests depend on it. It remains an isolated fixture;
 * the live plugin imports the authored `BASE_PACK` instead.
 */

export * from './primitives.js';
export * from './effects.js';
export * from './schema.js';
export * from './validate.js';
export { BASE_PACK, BASE_PACK_STATUS } from './basePack/index.js';
export { TEST_PACK } from './testPack.js';
