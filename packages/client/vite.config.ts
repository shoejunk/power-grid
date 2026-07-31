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
    // PixiJS is large and only needed once the board renderer mounts; keep it
    // in its own chunk so the menu/lobby shell stays small.
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
