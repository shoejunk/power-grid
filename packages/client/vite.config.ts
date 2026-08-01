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
const SERVER_ORIGIN = process.env.PG_SERVER_ORIGIN ?? 'http://localhost:8787';
const SERVER_WS_ORIGIN = SERVER_ORIGIN.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Workspace source alias so TS and Vite agree on where @pg/shared lives.
      '@pg/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },

  css: {
    preprocessorOptions: {
      scss: {
        // Opt in to the Dart Sass modern compiler API (silences the legacy warning).
        api: 'modern-compiler',
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
         * gets its own chunk to keep the menu/lobby shell small. Expressed as a
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
