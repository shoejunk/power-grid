# Dead of Winter — current state

This file is the routine's handoff. **Read it first, update it last, push it with the work it
describes.** It records what is true right now; `PROGRESS.md` records how we got here.

Last updated: **2026-08-15** (nightly run 2, in progress)

---

## Stop switch

If `.dow-agent/STOP` exists, all work halts. The routine disables itself and exits.
Create it with `touch .dow-agent/STOP` to stop the nightly builds by hand.

## Definition of done

All of these, simultaneously:

1. Every section of [`docs/QUALITY-BAR-DOW.md`](../docs/QUALITY-BAR-DOW.md) scores **PASS** with cited
   evidence — visual, motion, UX, gameplay conformance, multiplayer conformance.
2. Every one of the 15 acceptance criteria in §23 of
   [`dead-of-winter-gameplay-requirements.md`](../dead-of-winter-gameplay-requirements.md) is
   demonstrable against the running game, and every named erratum in §18 has a regression test.
3. An independent shipping judge that touched no files that run fails to reject the claim.

When that holds, write `.dow-agent/.aaa-complete` and disable the routine.

---

## Current focus

**Workstream: `engine-tests`** — the Dead of Winter engine has ~9,400 lines and no tests at all.
Nothing else can be trusted until that changes, because every later claim about rules conformance
rests on it.

## Scorecard

Scored against `docs/QUALITY-BAR-DOW.md`. `—` means not yet assessed, not "passing".

| Discipline | State | Notes |
| --- | --- | --- |
| Platform / multiplayer plumbing | **PASS** | 42 server tests green; game-agnostic boundary audited |
| Power Grid (regression guard) | **PASS** | 230 engine tests green; must never go red |
| DoW engine — code exists | **PASS** | 9,419 lines; plugin implements the full `GamePlugin` contract |
| DoW engine — tested | **PARTIAL** | 140 tests. A1–A4 covered; A5–A15 and §18 errata in flight (run 2) |
| DoW content pack | **PARTIAL** | Schema + validator + `testPack` fixture only. No shipping catalog |
| DoW client UI | **FAIL** | `packages/client/src/games/dead-of-winter/index.tsx` is a placeholder |
| DoW art | **FAIL** | Nothing produced |
| Visual (V1–V15) | — | Cannot assess until a UI exists |
| Motion (M1–M9) | — | Cannot assess until a UI exists |
| UX (U1–U13) | — | Cannot assess until a UI exists |
| Blind comparison vs Wingspan | — | Final gate; not attempted |

## Build and test status

All packages build clean as of the last push, **on Linux as well as Windows** — which was not
previously true. Verify the baseline yourself every run; do not trust this table.

| Check | Command | Status |
| --- | --- | --- |
| Core | `npx tsc -b packages/core/tsconfig.json` | OK |
| Power Grid | `npx tsc -b packages/games/power-grid/tsconfig.json` | OK |
| Dead of Winter | `npx tsc -b packages/games/dead-of-winter/tsconfig.json` | OK |
| Server | `npx tsc -b packages/server/tsconfig.json` | OK |
| Client | `npx tsc -p packages/client/tsconfig.json --noEmit` | OK |
| Power Grid tests | `npm test -w @game/power-grid` | 230 passed |
| Server tests | `npx vitest run --root packages/server` | 42 passed |
| DoW tests | `npm test -w @game/dead-of-winter` | 140 passed |

## Queue — next workstreams, in dependency order

1. **`engine-tests`** — a vitest suite covering all 15 §23 acceptance criteria and every §18
   erratum, plus a determinism test (same seed + action log ⇒ identical final state) and the
   redaction test (serialise player A's view; assert player B's secret ids do not appear).
2. **`content-pack`** — the shipping catalog at the §2.0 counts: 30 survivors, 25 starter items,
   6×20 location items, 20 crisis, 80 crossroads, 10 dual-sided main objectives, 24 non-betrayal +
   10 betrayal + 10 exiled secret objectives. **Original names and text** — the retail card text is
   not reproduced. The ~18 cards named in §18 keep their real names so those regression tests mean
   something.
3. **`client-ui`** — the board: colony plus six locations, survivor standees, dice tray, hand,
   crisis and objective areas, crossroads reveal, vote panel, exposure and bite resolution, zombie
   placement narration, morale/round/food/waste readouts, rules log.
4. **`art`** — survivor portraits, item cards, zombies, board, tokens. Follow the procedural art
   pipeline already in `packages/client/src/games/power-grid/art/`.
5. **`polish`** — motion, sound, accessibility, reduced-motion, resolution sweep.
6. **`multiplayer-proof`** — 3+ real browser clients playing a full game end to end, including a
   server restart and a reconnection mid-match.

## Known debts

- **The nightly sandbox is Linux; the dev machine is Windows.** Anything platform-specific will
  be caught here first and can silently make a whole run a no-op. Run the baseline before
  believing any claim in this file.
- **Pushing requires GitHub write access for the session.** Run 1 initially had none: `git push`
  returned 403 through the agent proxy and the GitHub API returned `Resource not accessible by
  integration` on the trees, refs and contents endpoints. If a future run cannot push, that is
  the cause — report it rather than working all night into a sandbox that gets discarded.
- `packages/ui/src/components/ErrorBoundary.tsx` logs a literal `[power-grid]` from a
  game-agnostic component.
- `packages/client/src/portal/portal.scss` still uses `.pg-setup__*` class names; the
  `--pg-*` → `--tt-*` rename did not reach it.
- ~~Whether headless screenshots are possible in the sandbox~~ — **RESOLVED, run 2.** They are.
  Chromium ships at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (symlinked from
  `/opt/pw-browsers/chromium`), and `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is already set, so
  **never run `playwright install`**. Verified working recipe:
  `chrome --headless --no-sandbox --disable-gpu --screenshot=out.png --window-size=1280,720 <url>`.
  The `dbus/bus.cc` connection errors it prints are harmless noise in this container, not a failure.
  The resulting PNG can be read back and actually looked at. Puppeteer must be pointed at that
  binary via `executablePath` rather than downloading its own. **No future run may claim it could
  not do visual verification without first trying this.**
- The Wingspan blind comparison cannot be run against the real product from inside the sandbox
  unless the critic fetches reference screenshots itself. `docs/QUALITY-BAR-DOW.md` §0 encodes
  Wingspan's specific strengths and weaknesses so the comparison is checkable either way.
