# Power Grid

A web implementation of the board game **Power Grid**, with persistent multiplayer.

Built to the specification in [`power-grid-gameplay-requirements.md`](./power-grid-gameplay-requirements.md),
against the visual and UX bar set out in [`docs/QUALITY-BAR.md`](./docs/QUALITY-BAR.md).

## Layout

```
packages/
  shared/    Domain model, canonical game data, and the pure rules engine.
             Depends on nothing. Imported by both server and client.
  server/    Authoritative game server. Lobbies, join codes, WebSocket
             transport, SQLite persistence, reconnection.
  client/    React + PixiJS front end. Design system, board renderer,
             phase UI.
```

The rules engine is a **pure deterministic reducer** — `(state, action) -> state` — with no I/O, no
`Date.now()` and no `Math.random()`. All randomness flows through a seeded stream (`Rng`) whose cursor is
part of the persisted state, so any game can be replayed exactly from its seed and action log
(spec §14, "Determinism and auditability").

The server is the only place actions are validated and applied. The client renders state and proposes
actions; it is never trusted.

## Running it

```bash
npm install
```

Start the server and the client dev server in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

The client dev server proxies WebSocket traffic to the game server on port 8787.

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

## Multiplayer model

One player creates a game and receives a six-character join code. Anyone with the code can take a seat until
the host starts the match. Each seated player holds a session token in `localStorage`.

Games are persisted on every applied action. Closing the tab, losing the network, or restarting the server
does not end a game — reconnecting with the session token restores the exact seat, hand, network, money and
turn position.
