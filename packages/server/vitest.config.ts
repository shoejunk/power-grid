import { defineConfig } from 'vitest/config';

/**
 * Test runner configuration.
 *
 * Note that `node:sqlite` is *not* aliased here: `persistence/sqliteStore.ts`
 * loads it through `createRequire` precisely so that neither Vite nor the
 * production build needs to know about it.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Integration tests bind real ports and open real SQLite files; give them
    // room, and keep files sequential so ephemeral ports never collide.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
