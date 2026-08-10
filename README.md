# Tabletop

A site for playing board games online, with persistent multiplayer.

Two games ship today:

| Game | Players | Spec | Quality bar |
| --- | --- | --- | --- |
| **Power Grid** | 2–6 | [`power-grid-gameplay-requirements.md`](./power-grid-gameplay-requirements.md) | [`docs/QUALITY-BAR.md`](./docs/QUALITY-BAR.md) |
| **Dead of Winter** | 2–5 | [`dead-of-winter-gameplay-requirements.md`](./dead-of-winter-gameplay-requirements.md) | [`docs/QUALITY-BAR-DOW.md`](./docs/QUALITY-BAR-DOW.md) |

## Layout

```
packages/
  core/      @tt/core — the game-agnostic platform. Seats, lobbies, join codes,
             the wire protocol, the seeded RNG, and the GamePlugin contract.
             Depends on nothing. Knows about no game.
  ui/        @tt/ui — the game-agnostic design system. Source-only; the client
             bundles it. Themed per game through GameDescriptor.theme.
  games/
    power-grid/       @game/power-grid — rules engine, canonical data, plugin.
    dead-of-winter/   @game/dead-of-winter — rules engine, content pack, plugin.
  server/    @tt/server — authoritative host. Lobbies, join codes, WebSocket
             transport, SQLite persistence, reconnection. Holds no game rules.
  client/    @tt/client — the portal plus one UI per game.
```

The rule that keeps this honest: **nothing game-specific may appear in `core`, `ui`, `server`, or the
client's `net/` and `portal/` layers.** If the server ever needs to branch on which game is being played,
the branch belongs behind a new method on `GamePlugin` instead.

### The plugin boundary

`packages/core/src/plugin.ts` is the whole contract. The server hosts tables, mints codes, owns sockets,
persists state and decides who may speak; it asks a `GamePlugin` everything else:

| Question | Method |
| --- | --- |
| Is this settings payload well-formed? | `parseSettingsPatch` |
| May this table start? | `validateSettings` |
| How many seats does this table take? | `seatCapacity` |
| Is this action well-formed? | `parseAction` |
| Is it legal right now? | `validateAction` |
| What happens next? | `applyAction` |
| Whose input am I waiting on? | `activePlayerOf` |
| May this player act out of turn? | `allowsOutOfTurn` |
| What must I hide from this recipient? | `redactStateFor` |
| What should a bot do? | `defaultActionFor` / `safeDefaultActions` |

`redactStateFor` is the security-critical one: it is the only thing between a hidden-information game and
a player reading the answer out of a WebSocket frame.

Adding a game means writing a package under `packages/games/` and adding one line to
[`packages/server/src/games.ts`](./packages/server/src/games.ts). Nothing else changes.

### Determinism

Every rules engine is a **pure deterministic reducer** — `(state, action) -> state` — with no I/O, no
`Date.now()` and no `Math.random()`. All randomness flows through a seeded stream (`Rng`) whose cursor is
part of the persisted state, so any game can be replayed exactly from its seed and action log.

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

`typecheck` and `build` both run `tsc -b`, so TypeScript project references resolve the build order
across packages automatically.

## Deploying to Oracle Cloud

Both halves run on **one OCI Compute instance**, which is the simplest correct topology here: the server
process serves the built client itself, so client and server share an origin and the browser talks to
`/ws` on the same host. No cross-origin configuration, no `VITE_WS_URL`, no CORS.

What the server actually needs is a **long-lived process**, **WebSocket support**, and a **persistent
disk** for its SQLite database. A plain VM gives all three. Serverless does not — which is why this is a
Compute instance and not Functions.

### 1. Create the instance

An Always Free **Ampere A1 (ARM64)** shape is more than enough — these are turn-based board games, not
simulations. Ubuntu 22.04 or later. The AMD micro shapes work too, but 1 GB of RAM makes the client build
tight; build elsewhere and copy `dist/` up if you use one.

> **ARM note:** everything needed to build and run is pure JavaScript. `sharp` is a devDependency used
> only to regenerate board art offline and is never required to build the client or run the server.

### 2. Open the port — in *both* places

This is the step that wastes an afternoon if you miss half of it. OCI filters traffic in two independent
layers, and an instance that looks correctly configured will still refuse connections if only one is open.

**a. VCN ingress**, in the Console: Networking → Virtual Cloud Networks → your VCN → the instance's subnet
→ Security List (or the NSG attached to the instance) → Add Ingress Rule. Source `0.0.0.0/0`, IP protocol
TCP, destination ports `80,443`.

**b. The instance's own firewall.** Oracle's Ubuntu images ship with iptables rules that drop everything
except SSH, and those rules are *not* what `ufw` shows you:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

On Oracle Linux instead:

```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

### 3. Install Node and build

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
```

```bash
git clone <your-repo-url> /opt/tabletop && cd /opt/tabletop && npm ci
```

```bash
npm run build
```

Run it from the repo root — this is an npm workspaces monorepo, and the workspace packages are only linked
into each other when the install and build happen from the top.

(Development tooling resolves TypeScript source instead, via the `development` export condition, so editing
a game's engine needs no rebuild while you work.)

### 4. Run it as a service

Create `/etc/systemd/system/tabletop.service`:

```ini
[Unit]
Description=Tabletop game server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/tabletop
ExecStart=/usr/bin/node packages/server/dist/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=TT_DATA_DIR=/var/lib/tabletop

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/tabletop && sudo chown ubuntu:ubuntu /var/lib/tabletop
```

```bash
sudo systemctl enable --now tabletop && sudo systemctl status tabletop
```

`TT_DATA_DIR` is the important line. It defaults to `packages/server/data/` inside the checkout, which a
`git clean` or a redeploy will happily delete — taking every in-progress game with it and quietly undoing
the persistence guarantee the whole design rests on. Point it somewhere outside the working tree, and if
you attach a block volume, point it there.

`NODE_ENV=production` also switches `TT_SERVE_CLIENT` on by default, which is what makes the server serve
`packages/client/dist` with a SPA fallback.

> **Upgrading from the single-game deployment:** the old `PG_*` variables are still read as fallbacks, and
> the SQLite schema migrates itself — a `gameKey` column is added on first boot and every existing row is
> marked `power-grid`. In-progress games survive the upgrade.

### 5. Terminate TLS with nginx

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Put this in `/etc/nginx/sites-available/tabletop` and symlink it into `sites-enabled`:

```nginx
server {
    listen 80;
    server_name your.domain;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;

        # Required for the WebSocket upgrade. Without these three lines the
        # page loads and then sits on "Reconnecting" forever, which looks like
        # a bug in the game rather than a proxy misconfiguration.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # A seated player may sit idle through several opponents' turns; the
        # default 60s read timeout would cut them off mid-game.
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d your.domain
```

Certbot rewrites the block for 443 and keeps the proxy settings. The client picks `wss://` automatically
once the page is served over HTTPS.

### 6. Verify

```bash
curl -s https://your.domain/health
```

Then open the site, create a game, and confirm the status pill reads **ONLINE**. If it says
*Reconnecting*, the WebSocket upgrade is not getting through — check the three `proxy_set_header` lines
before anything else.

To confirm persistence actually works, start a game, then `sudo systemctl restart tabletop` and reload
the page. You should land back in the same seat with your position intact. If you do not, `TT_DATA_DIR`
is pointing somewhere ephemeral.

### Updating

```bash
cd /opt/tabletop && git pull && npm ci && npm run build && sudo systemctl restart tabletop
```

Games survive the restart, provided `TT_DATA_DIR` lives outside the checkout.

### Useful environment variables

Each also accepts its legacy `PG_`-prefixed name.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | TCP port |
| `TT_DATA_DIR` | `packages/server/data` | Where the SQLite database lives — **override this** |
| `TT_DB_FILE` | `power-grid.db` | Database filename (unchanged, so existing deployments keep their data) |
| `TT_SERVE_CLIENT` | on when `NODE_ENV=production` | Serve the built client |
| `TT_CLIENT_DIST` | `packages/client/dist` | Where the client bundle is |
| `TT_LOG_LEVEL` | `info` in production | `debug`, `info`, `warn`, `error` |

### Hosting the client separately

If you ever split them — a CDN in front of the client, say — build the client with `VITE_WS_URL` pointing
at the server:

```
VITE_WS_URL=wss://your.domain/ws
```

It is baked in at build time, so changing it means rebuilding. Unset, the client talks to `/ws` on its own
origin, which is what the single-instance setup above relies on.

## Multiplayer model

One player picks a game and creates a table, receiving a six-character join code. Codes are unique across
every title, so a player only ever needs the code — never the game's name as well. Anyone with the code can
take a seat until the host starts the match. Each seated player holds a session token in `localStorage`.

Games are persisted on every applied action. Closing the tab, losing the network, or restarting the server
does not end a game — reconnecting with the session token restores the exact seat and position, including
private information such as a hand of cards or a secret objective.

Games are asynchronous: a human player's turn has no time limit. If they disconnect while active, the server
waits indefinitely for them to reconnect and never takes a default action on their behalf. Bot seats remain
automated, in the games that have them.

## Content

Dead of Winter's card set ships as a **versioned content pack** rather than being hard-coded, and the pack
version is pinned into each match so a later content patch cannot change an in-progress or replayed game.
The bundled pack is original work written to the mechanical shape the spec describes; the published card
text of the retail game is not reproduced here.
