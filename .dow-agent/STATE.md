# Dead of Winter — current state

This file is the routine's handoff. **Read it first, update it last, push it with the work it
describes.** It records what is true right now; `PROGRESS.md` records how we got here.

Last updated: **2026-08-23** (nightly run 8, in progress)

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
Run 8 is bounded to A5, A6, and A7, with one implementation file and one independent harsh critic
per criterion. Each green criterion lands in its own push.

## Scorecard

Scored against `docs/QUALITY-BAR-DOW.md`. `—` means not yet assessed, not "passing".

| Discipline | State | Notes |
| --- | --- | --- |
| Platform / multiplayer plumbing | **PASS** | 42 server tests green; game-agnostic boundary audited |
| Power Grid (regression guard) | **PASS** | 230 engine tests green; must never go red |
| DoW engine — code exists | **PASS** | ~5,400 lines under `engine/`; plugin implements the full `GamePlugin` contract |
| DoW engine — tested | **PARTIAL** | 165 tests on master. A1–A5 and A7 covered; A6, A8–A15, and §18 errata remain |
| DoW content pack | **FAIL** | Schema + validator + `testPack` fixture only. **No shipping catalog** — the game is played with the engine's test fixture |
| DoW client UI — exists | **PASS** | Run 4 landed the match screen (`packages/client/src/games/dead-of-winter/`) |
| DoW client UI — judged | **FAIL** | **Never screenshotted, never critiqued.** No evidence for any V/M/U criterion |
| DoW art | **FAIL** | Nothing produced. No procedural pipeline for this game yet |
| Visual (V1–V15) | — | UI exists but has had no critic pass; assume nothing |
| Motion (M1–M9) | — | Same |
| UX (U1–U13) | — | Same |
| Blind comparison vs Wingspan | — | Final gate; not attempted |

## Build and test status

Verify the baseline yourself every run; do not trust this table. Figures below were measured at the
start of run 8, on Windows, at `e12fbe1`.

| Check | Command | Status |
| --- | --- | --- |
| Core | `npx tsc -b packages/core/tsconfig.json` | OK |
| Power Grid | `npx tsc -b packages/games/power-grid/tsconfig.json` | OK |
| Dead of Winter | `npx tsc -b packages/games/dead-of-winter/tsconfig.json` | OK |
| Server | `npx tsc -b packages/server/tsconfig.json` | OK |
| Client | `npx tsc -p packages/client/tsconfig.json --noEmit` | OK |
| Power Grid tests | `npm test -w @game/power-grid` | 230 passed |
| Server tests | `npx vitest run --root packages/server` | 42 passed |
| DoW tests | `npm test -w @game/dead-of-winter` | 165 passed on master after A7 |

## Queue — next workstreams, in dependency order

1. **`engine-tests`** — §23 A5–A15 plus every §18 erratum, one named regression test each, plus a
   determinism test (same seed + action log ⇒ identical final state) and a redaction test that
   walks the whole serialised view rather than checking named fields. **In progress, run 8;
   tonight's bounded tranche is A5–A7. A5 and A7 are PASS; A6 remains in its critic loop.**
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
- **The nightly sandbox is Linux; the dev machine is Windows.** Anything platform-specific will
  be caught here first and can silently make a whole run a no-op. Run the baseline before
  believing any claim in this file.
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
