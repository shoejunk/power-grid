/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Address of the game server's WebSocket endpoint.
   *
   * Optional. When unset the client talks to `/ws` on its own origin, which is
   * what the Vite dev proxy serves and what a single-origin deployment serves.
   * Set it when the client is hosted separately from the server — for example a
   * static host such as Netlify, which cannot hold a WebSocket open:
   *
   *   VITE_WS_URL=wss://power-grid.fly.dev/ws
   */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
