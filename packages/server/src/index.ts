/**
 * Entry point. `npm run dev` (tsx watch) and `npm start` (built) both land here.
 *
 * Shutdown is graceful on purpose: `hub.shutdown()` closes sockets and cancels
 * timers, and the store is flushed/closed before the process exits, so a
 * deploy never loses a move. Nothing needs to be saved *at* shutdown — every
 * action was already persisted when it was applied.
 */

import { startServer } from './server.js';

async function main(): Promise<void> {
  const server = await startServer();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    void (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\nReceived ${signal}; shutting down.`);
      try {
        await server.close();
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A crash mid-game must not take the persisted state with it: the store is
  // already durable, so we log loudly and keep serving other tables.
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection', reason);
  });
}

main().catch((err: unknown) => {
  console.error('Failed to start the Power Grid server:', err);
  process.exit(1);
});
