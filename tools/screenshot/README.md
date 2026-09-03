# Screenshot harness

Drives a real Dead of Winter match in headless Chromium and captures it, so the
visual criteria in [`docs/QUALITY-BAR-DOW.md`](../../docs/QUALITY-BAR-DOW.md)
can be scored against pixels from the running game instead of against source.

## Running it

Both dev servers must be up first:

```sh
npm run dev:server &
npm run dev:client &
```

Then:

```sh
node tools/screenshot/capture.mjs                 # all five required resolutions
node tools/screenshot/capture.mjs --only 1920x1080
node tools/screenshot/capture.mjs --players 5 --seed my-seed --out .shots/run23
```

Images and a `report.json` land in `.shots/match/` by default (gitignored). The
report carries the console output, page errors and overflow measurements that
V6, V12, V13 and V15 are scored against.

**Read the images.** The script exiting zero means it drove the game, not that
the game looked good.

## Notes for whoever picks this up next

- Chromium is pre-installed at `/opt/pw-browsers/chromium`. Never run
  `playwright install` — it is unnecessary and blocked.
- The container's egress proxy rejects Google's telemetry hosts. Chromium is
  launched with those disabled; without that, navigation stalls until timeout.
- Setup is not one screen. `resolveSetup()` answers whatever decisions the game
  opens with — multi-select dialogs gate a Confirm button, single-select ones
  commit on click — and reports what it answered.
- Clicks must be one round trip each. React batches state inside a single
  `page.evaluate`, so a loop that clicks every option at once never observes
  the Confirm button enabling and over-selects.
- `hostMatch()` navigates straight to `/g/dead-of-winter`. Do not click the
  game's name on the portal home: once the server holds games, resumable-table
  tiles carry the same name and clicking by text resumes an old table.

## Proving multiplayer

```sh
node tools/screenshot/multiplayer.mjs
```

Drives **two real browsers** through the criteria in §5 of the quality bar that
only a browser can demonstrate: a host mints a code (N1), a second client joins
with nothing but that code (N1), each seat sees its own secret objective and
neither appears in the other's DOM (N6), and a client that closes its tab and
returns comes back to the same seat with the same hidden state (N3, N6).

It exits non-zero if any criterion fails, and writes screenshots plus
`multiplayer-report.json` to `.shots/multiplayer/`.

Not covered by this script, and still owed: N4 (a full server restart mid-game),
N5 (an indefinite pause), N7 (simultaneous vote commit-before-reveal) and N8
(three or more clients playing a full game to a winner).
