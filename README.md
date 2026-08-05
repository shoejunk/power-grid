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

## Deploying to Oracle Cloud

Both halves run on **one OCI Compute instance**, which is the simplest correct topology here: the server
process serves the built client itself, so client and server share an origin and the browser talks to
`/ws` on the same host. No cross-origin configuration, no `VITE_WS_URL`, no CORS.

What the server actually needs is a **long-lived process**, **WebSocket support**, and a **persistent
disk** for its SQLite database. A plain VM gives all three. Serverless does not — which is why this is a
Compute instance and not Functions.

### 1. Create the instance

An Always Free **Ampere A1 (ARM64)** shape is more than enough — this is a turn-based board game, not a
simulation. Ubuntu 22.04 or later. The AMD micro shapes work too, but 1 GB of RAM makes the client build
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
git clone <your-repo-url> /opt/power-grid && cd /opt/power-grid && npm ci
```

```bash
npm run build
```

`npm run build` builds all three packages in dependency order, and that order is load-bearing: `@pg/shared`
publishes its compiled `dist` to Node, so the server genuinely cannot start until it exists. Run it from the
repo root — this is an npm workspaces monorepo, and `@pg/shared` is only linked into the other two packages
when the install and build happen from the top.

(Development tooling resolves the TypeScript source instead, via the package's `development` export
condition, so editing shared code needs no rebuild while you work.)

### 4. Run it as a service

Create `/etc/systemd/system/power-grid.service`:

```ini
[Unit]
Description=Power Grid game server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/power-grid
ExecStart=/usr/bin/node packages/server/dist/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=PG_DATA_DIR=/var/lib/power-grid

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/power-grid && sudo chown ubuntu:ubuntu /var/lib/power-grid
```

```bash
sudo systemctl enable --now power-grid && sudo systemctl status power-grid
```

`PG_DATA_DIR` is the important line. It defaults to `packages/server/data/` inside the checkout, which a
`git clean` or a redeploy will happily delete — taking every in-progress game with it and quietly undoing
the persistence guarantee the whole design rests on. Point it somewhere outside the working tree, and if
you attach a block volume, point it there.

`NODE_ENV=production` also switches `PG_SERVE_CLIENT` on by default, which is what makes the server serve
`packages/client/dist` with a SPA fallback.

### 5. Terminate TLS with nginx

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Put this in `/etc/nginx/sites-available/power-grid` and symlink it into `sites-enabled`:

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

To confirm persistence actually works, start a game, then `sudo systemctl restart power-grid` and reload
the page. You should land back in the same seat with your money, plants and turn position intact. If you
do not, `PG_DATA_DIR` is pointing somewhere ephemeral.

### Updating

```bash
cd /opt/power-grid && git pull && npm ci && npm run build && sudo systemctl restart power-grid
```

Games survive the restart, provided `PG_DATA_DIR` lives outside the checkout.

### Useful environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | TCP port |
| `PG_DATA_DIR` | `packages/server/data` | Where the SQLite database lives — **override this** |
| `PG_DB_FILE` | `power-grid.db` | Database filename |
| `PG_SERVE_CLIENT` | on when `NODE_ENV=production` | Serve the built client |
| `PG_CLIENT_DIST` | `packages/client/dist` | Where the client bundle is |
| `PG_TURN_TIMEOUT_MS` | `180000` | Before a default move is taken for a *disconnected* player |
| `PG_LOG_LEVEL` | `info` in production | `debug`, `info`, `warn`, `error` |

### Hosting the client separately

If you ever split them — a CDN in front of the client, say — build the client with `VITE_WS_URL` pointing
at the server:

```
VITE_WS_URL=wss://your.domain/ws
```

It is baked in at build time, so changing it means rebuilding. Unset, the client talks to `/ws` on its own
origin, which is what the single-instance setup above relies on.

## Multiplayer model

One player creates a game and receives a six-character join code. Anyone with the code can take a seat until
the host starts the match. Each seated player holds a session token in `localStorage`.

Games are persisted on every applied action. Closing the tab, losing the network, or restarting the server
does not end a game — reconnecting with the session token restores the exact seat, hand, network, money and
turn position.
