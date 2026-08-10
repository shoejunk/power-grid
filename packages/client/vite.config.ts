import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Client build configuration.
 *
 * The game server speaks WebSocket on ws://localhost:8787 in development. We
 * never hard-code that origin in application code: the client always dials
 * `<same-origin>/ws` and Vite proxies it, so the same code path works in dev,
 * in `vite preview`, and behind a reverse proxy in production.
 */
const SERVER_ORIGIN = process.env.TT_SERVER_ORIGIN ?? 'http://localhost:8787';
const SERVER_WS_ORIGIN = SERVER_ORIGIN.replace(/^http/, 'ws');

const fromHere = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],

  resolve: {
    /*
     * Source aliases, mirroring tsconfig `paths`. The client is `noEmit`, so
     * there is nothing to gain from compiling the workspace packages first —
     * and plenty to lose, because a stale `dist` that still type-checks is the
     * hardest kind of bug to see. `@game/dead-of-winter` is deliberately absent:
     * that package is still being built out, so it resolves through its own
     * `exports` map and the client only ever reads its descriptor.
     */
    alias: {
      '@': fromHere('./src'),
      '@tt/core': fromHere('../core/src/index.ts'),
      '@tt/ui/styles': fromHere('../ui/src/styles'),
      '@tt/ui': fromHere('../ui/src/index.ts'),
      '@game/power-grid': fromHere('../games/power-grid/src/index.ts'),
    },
  },

  css: {
    preprocessorOptions: {
      scss: {
        // Opt in to the Dart Sass modern compiler API (silences the legacy warning).
        api: 'modern-compiler',
        /*
         * Lets any stylesheet in the app say `@use 'mixins' as *` and get the
         * design system's, exactly as a stylesheet inside @tt/ui does. Without
         * it, every game stylesheet would carry a `../../../../ui/src/styles`
         * relative path that breaks the moment a file moves.
         */
        loadPaths: [fromHere('../ui/src/styles')],
      },
    },
  },

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        target: SERVER_WS_ORIGIN,
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: SERVER_ORIGIN,
        changeOrigin: true,
      },
    },
  },

  preview: {
    port: 5174,
    strictPort: true,
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * PixiJS is large and only needed once the board renderer mounts, so it
         * gets its own chunk to keep the portal shell small. Expressed as a
         * function rather than a static map so the chunk simply does not exist
         * until something actually imports Pixi — a static map emits an empty
         * chunk (and a build warning) while the renderer is still a mount point.
         */
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/pixi.js')) return 'pixi';
          if (id.includes('node_modules/framer-motion')) return 'motion';
          return undefined;
        },
      },
    },
  },
});
