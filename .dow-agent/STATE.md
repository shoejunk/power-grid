# Dead of Winter — current state

This file is the routine's handoff. **Read it first, update it last, push it with the work it
describes.** It records what is true right now; `PROGRESS.md` records how we got here.

Last updated: **2026-09-01** (nightly run 20: granular audit and public A14 evidence)

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
Run 18 pushed `d016044` with authored 10-card main and 44-card secret-objective families, active-pack
wiring, exact manifest controls, and updated public A14 fixtures. Run 19 pushed `3173608` with a
public-plugin Samples setup/sample-before-exposure regression and `3d112dd` with a real WebSocket
random-action replay/hash-tamper regression. Run 20 pushed `45e3a08` for per-automatic-transition audit
granularity, `2ec71d4` for public survivor/item rulings, and `0684ae2` for public Samples removal and
authored Raiding Party/Bev Russell proofs. The bounded A15 granularity and A14 survivor/item critics
PASSed, but strict A14 still lacks several public crossroads/ruling proofs and orphan reconciliation;
full A15/N4/N8 sign-off is also open. No UI, visual, or Wingspan comparison work was attempted.

## Scorecard

Scored against `docs/QUALITY-BAR-DOW.md`. `—` means not yet assessed, not "passing".

| Discipline | State | Notes |
| --- | --- | --- |
| Platform / multiplayer plumbing | **PASS** | 58 server tests green; game-agnostic boundary audited |
| Power Grid (regression guard) | **PASS** | 231 engine tests green; must never go red |
| DoW engine — code exists | **PASS** | ~5,400 lines under `engine/`; plugin implements the full `GamePlugin` contract |
| DoW engine — tested | **PARTIAL** | 319 tests pass. Deferred-morale restart, audit checkpoints, granular automatic traces, random replay, redaction, and public A14 slices are green; strict A14 still lacks public ruling/orphan coverage and strict A15 lacks full independent sign-off |
| DoW content pack | **PASS** | Live plugin uses authored `dow-base` v0.5.0-dev content at the §2.0 counts; objective-family critics PASSed and the active boundary reports no fixture-backed families. This remains original development content, not reproduced licensed retail text |
| DoW client UI — exists | **PASS** | Run 4 landed the match screen (`packages/client/src/games/dead-of-winter/`) |
| DoW client UI — judged | **PARTIAL** | Live 1280×720 screenshot verified named chips, setup previews and survivor detail modal; no Wingspan blind critic pass yet |
| DoW art | **PARTIAL** | 30 cohesive generated survivor portraits shipped; item/card/board/zombie art and a full visual critic pass remain |
| Visual (V1–V15) | — | UI exists but has had no critic pass; assume nothing |
| Motion (M1–M9) | — | Same |
| UX (U1–U13) | — | Same |
| Blind comparison vs Wingspan | — | Final gate; not attempted |

## Build and test status

Verify the baseline yourself every run; do not trust this table. Figures below were measured on
Windows on 2026-08-31. The global npm/npx shims still point to a missing user-prefix CLI, so the
mandated commands fail before execution; repository-local binaries were used for verification. The
install-generated `package-lock.json` remains intentionally uncommitted.

| Check | Command | Status |
| --- | --- | --- |
| Core | `npx tsc -b packages/core/tsconfig.json` | OK |
| Power Grid | `npx tsc -b packages/games/power-grid/tsconfig.json` | OK |
| Dead of Winter | `npx tsc -b packages/games/dead-of-winter/tsconfig.json` | OK |
| Server | `npx tsc -b packages/server/tsconfig.json` | OK |
| Client | `npx tsc -p packages/client/tsconfig.json --noEmit` | OK |
| Client production build | `npm run build -w @tt/client` | OK |
| Power Grid tests | `npm test -w @game/power-grid` | 231 passed |
| DoW tests | `npm test -w @game/dead-of-winter` | 319 passed |
| Server tests | `npx vitest run --root packages/server` | 58 passed |

## Queue — next workstreams, in dependency order

1. **`engine-tests`** — retain the deferred-morale checkpoint/restart, per-transition snapshot,
   public-explanation, and action-driven replay proofs while completing strict A14/A15 sign-off.
   Engine replay, whole-view redaction, session-token reconnection, the real pending-effect restart,
   the public boundary, and the 319-test DoW suite are green; an independent full strict product review
   is not recorded.
2. **`content-pack`** — **PASS for the authored development boundary** at the §2.0 counts: 30 survivors, 25 starter items,
   6×20 location items, 20 crisis, 80 crossroads, 10 dual-sided main objectives, 24 non-betrayal +
   10 betrayal + 10 exiled secret objectives. **Original names and text** — the retail card text is
   not reproduced. The ~18 cards named in §18 keep their real names so those regression tests mean
   something. All card families are now authored in `dow-base`; the active status is
   `authored-development`, not a claim of licensed retail publication.
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
- `testPack` remains a fixture for isolated engine tests only; the live `dow-base` pack no longer
  uses fixture-backed objective families.
- The six executable errata survivor fixtures retain their regression-oriented engine values; their
  original occupations are now shown. Two newly named influence values remain deliberate tie
  sentinels for the setup regression; the other newly named cards use the base-game roster stats.
- Survivor portraits are complete for the 30-card base roster, but original survivor ability text and
  the remaining retail card families are not yet a shipping catalog.
- **The execution environment varies between Linux and Windows.** Anything platform-specific can
  silently make a whole run a no-op. Run the baseline before believing any claim in this file.
- **Run 18 strict-review debts:** the authored main and secret objective catalogs now complete the
  §2.0 card-family boundary, and objective-family critics PASSed. A14 still needs the final strict
  independent audit recorded against the active plugin; A15 still needs an independent strict PASS
  for the runtime audit/replay evidence. Original development content is not a licensed retail pack.
- **Run 19 strict-review result:** public Samples setup and sample-before-exposure evidence is now
  covered by `strict-a14-audit.test.ts`, and a real WebSocket random action/replay/hash-tamper case is
  covered by `strict-dead-of-winter-a15.test.ts`. A14 still FAILs on missing public proofs for several
  named §18 rulings; A15 has no independent critic PASS and still lacks per-automatic-transition audit
  granularity evidence. Both fresh strict critics were shut down without returning a verdict, so no
  strict gate moved to PASS.
- **Run 20 strict-review result:** granular automatic audit records now have an independent bounded PASS,
  and public Edward White, John Price, survivor timing, once-per-round item, Samples removal, and authored
  Raiding Party/Bev Russell slices are green. A14 remains partial because the broad crossroads/objective
  probe failed and was discarded, remaining public movement/Outbreak/This Taste Funny/option-legality
  evidence is incomplete, and orphan reconciliation cannot be driven through the public API. Full A15,
  N4, and N8 sign-off remains open; visual/browser/Wingspan work was deferred.
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
