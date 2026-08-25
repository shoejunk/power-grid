# Dead of Winter — current state

This file is the routine's handoff. **Read it first, update it last, push it with the work it
describes.** It records what is true right now; `PROGRESS.md` records how we got here.

Last updated: **2026-08-25** (A14/A15 evidence and real reconnection slice)

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

**Workstream: `engine-tests`** — still the first non-PASS item in the queue and the bottleneck.
Run 11 added public-plugin A14 plumbing evidence, a setup-to-terminal engine replay proof, and a
real DoW WebSocket/session-token reconnection test across a SQLite restart. Independent critics pass
the narrow engine replay, redaction, and reconnection slices, but A14 remains FAIL because the active
plugin is explicitly `TEST_PACK` and most §18 rulings are not public-boundary tests. Full product A15
also remains FAIL because the server persists opaque snapshots rather than an append-only action/event
audit stream that can rebuild a match. The next run stays on `engine-tests` and starts with that
server audit/replay boundary, then the retail content boundary.

## Scorecard

Scored against `docs/QUALITY-BAR-DOW.md`. `—` means not yet assessed, not "passing".

| Discipline | State | Notes |
| --- | --- | --- |
| Platform / multiplayer plumbing | **PASS** | 43 server tests green; game-agnostic boundary audited |
| Power Grid (regression guard) | **PASS** | 230 engine tests green; must never go red |
| DoW engine — code exists | **PASS** | ~5,400 lines under `engine/`; plugin implements the full `GamePlugin` contract |
| DoW engine — tested | **PARTIAL** | 266 tests pass. A1–A10 plus A11/A12/A13 are covered; A14 and full A15 still fail strict evidence review |
| DoW content pack | **PARTIAL** | All 30 base-game survivor names, occupations, stats and portraits now exist; the game still uses `testPack` and lacks the complete retail abilities/items/crossroads catalog |
| DoW client UI — exists | **PASS** | Run 4 landed the match screen (`packages/client/src/games/dead-of-winter/`) |
| DoW client UI — judged | **PARTIAL** | Live 1280×720 screenshot verified named chips, setup previews and survivor detail modal; no Wingspan blind critic pass yet |
| DoW art | **PARTIAL** | 30 cohesive generated survivor portraits shipped; item/card/board/zombie art and a full visual critic pass remain |
| Visual (V1–V15) | — | UI exists but has had no critic pass; assume nothing |
| Motion (M1–M9) | — | Same |
| UX (U1–U13) | — | Same |
| Blind comparison vs Wingspan | — | Final gate; not attempted |

## Build and test status

Verify the baseline yourself every run; do not trust this table. Figures below were measured at the
end of this pass on Windows, against the exact tree committed as `9e9ac9e`.

| Check | Command | Status |
| --- | --- | --- |
| Core | `npx tsc -b packages/core/tsconfig.json` | OK |
| Power Grid | `npx tsc -b packages/games/power-grid/tsconfig.json` | OK |
| Dead of Winter | `npx tsc -b packages/games/dead-of-winter/tsconfig.json` | OK |
| Server | `npx tsc -b packages/server/tsconfig.json` | OK |
| Client | `npx tsc -p packages/client/tsconfig.json --noEmit` | OK |
| Client production build | `npm run build -w @tt/client` | OK |
| Power Grid tests | `npm test -w @game/power-grid` | 230 passed |
| Server tests | `npx vitest run --root packages/server` | 43 passed |
| DoW tests | `npm test -w @game/dead-of-winter` | 266 passed |

## Queue — next workstreams, in dependency order

1. **`engine-tests`** — persist a validated append-only action/event audit stream and prove replay
   across restart; then close A14's named §18 public-boundary coverage and shipping-content boundary.
   The engine replay, whole-view redaction, and real session-token reconnection slices are green, but
   the strict A14/A15 critics still FAIL the full criteria.
2. **`content-pack`** — the shipping catalog at the §2.0 counts: 30 survivors, 25 starter items,
   6×20 location items, 20 crisis, 80 crossroads, 10 dual-sided main objectives, 24 non-betrayal +
   10 betrayal + 10 exiled secret objectives. **Original names and text** — the retail card text is
   not reproduced. The ~18 cards named in §18 keep their real names so those regression tests mean
   something. Until this exists the shipped game is played with `testPack`.
3. **`client-ui`** — exists as of run 4 but unjudged. The next visual run does not start from
   nothing: it starts from `packages/client/src/games/dead-of-winter/` and a first critic pass.
4. **`art`** — survivor portraits, item cards, zombies, board, tokens. Follow the procedural art
   pipeline already in `packages/client/src/games/power-grid/art/`.
5. **`polish`** — motion, sound, accessibility, reduced-motion, resolution sweep.
6. **`multiplayer-proof`** — 3+ real browser clients playing a full game end to end, including a
   server restart and a reconnection mid-match.

## Known debts

- **Runs keep dying mid-night with unpushed work.** Runs 1, 2, 3 and 4 were all killed before
  writing their PROGRESS result; three of them lost their declared workstream entirely. Push each
  unit of work on its own the moment its tests are green. Do not batch.
- **The shipped game uses the engine's test fixture as its content.** `testPack` is a fixture, not
  a catalog. Anything judged about gameplay depth today is judging the fixture.
- The six executable errata survivor fixtures retain their regression-oriented engine values; their
  original occupations are now shown. Two newly named influence values remain deliberate tie
  sentinels for the setup regression; the other newly named cards use the base-game roster stats.
- Survivor portraits are complete for the 30-card base roster, but original survivor ability text and
  the remaining retail card families are not yet a shipping catalog.
- **The execution environment varies between Linux and Windows.** Anything platform-specific can
  silently make a whole run a no-op. Run the baseline before believing any claim in this file.
- **Run 11 strict-review debts:** A14's new public suite is green but only covers active-pack pinning,
  Attract, and betrayal omission; the strict critic still FAILs all unproven named §18 rulings and the
  fact that `plugin.ts` activates `TEST_PACK`. A15's engine replay and redaction slices pass, and the
  server reconnection test proves same-seat private restoration across SQLite restart, but full A15
  still lacks a persisted action/event audit log and replay harness. Multiplayer critics also still
  require hostile-action proof, pending-effect restart proof, and a full browser game with exile,
  bite-chain, overrun, and winner evaluation.
- **Windows package-manager environment:** the global `npm`/`npx` shims resolve a missing user-prefix
  CLI, and the user npm config forces `os=linux` on this Windows checkout. This run used the installed
  Node npm CLI directly and a one-run `--os=win32 --package-lock=false` optional-binary install; no
  tracked dependency files changed. The repository's required builds and tests are green now.
- **Pushing requires GitHub write access for the session.** Run 1 initially had none: `git push`
  returned 403 through the agent proxy. Confirmed working in run 5. If a future run cannot push,
  that is the cause — report it rather than working all night into a sandbox that gets discarded.
- **Concurrent sub-agents share one typecheck.** `tsconfig.check.json` includes `src/**/*.ts`, so
  an agent typechecking its own file also compiles every other agent's in-progress file. Brief
  agents that only errors in their own path are theirs, and run the clean full typecheck yourself
  before committing.
- `packages/client/src/portal/portal.scss` still uses `.pg-setup__*` class names; the
  `--pg-*` → `--tt-*` rename did not reach it.
- ~~`packages/ui/src/components/ErrorBoundary.tsx` logs a literal `[power-grid]`~~ — fixed, run 3.
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
