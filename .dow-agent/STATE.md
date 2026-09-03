# Dead of Winter — current state

This file is the routine's handoff. **Read it first, update it last, push it with the work it
describes.** It records what is true right now; `PROGRESS.md` records how we got here.

Last updated: **2026-09-03** (nightly run 22: screenshot harness, first visual evidence, multiplayer proof)

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

## Read this before picking a workstream

Runs 5 through 21 all declared `engine-tests` and nothing else. Seventeen nights. In that time the
Visual, Motion and UX sections — which are the **majority of the quality bar and the actual stated
goal of the project** — were never assessed even once, and the Wingspan comparison was never
attempted. The queue's dependency argument ("don't judge a UI built on an unverified engine") was
sound in run 2 and stopped being sound a long time ago.

Run 22 broke that pattern and the next run should not restore it. The engine now has 324 tests
covering A1–A15. **The bottleneck is no longer the engine. It is that the game does not look
finished.** Spend the night on the visual queue unless the baseline is red.

## Scorecard

Scored against `docs/QUALITY-BAR-DOW.md`. `—` means not yet assessed, not "passing".

| Discipline | State | Notes |
| --- | --- | --- |
| Platform / multiplayer plumbing | **PASS** | 58 server tests green; game-agnostic boundary audited |
| Power Grid (regression guard) | **PASS** | 231 engine tests green; must never go red |
| DoW engine — code exists | **PASS** | ~5,400 lines under `engine/`; plugin implements the full `GamePlugin` contract |
| DoW engine — tested | **PASS for A1–A15 coverage** | 324 tests. Every §23 criterion has a named suite; run 22 closed the last public §18.4 crossroads tranche. Two honest boundaries remain, recorded under Known debts |
| DoW content pack | **PASS** | Authored `dow-base` v0.5.0-dev at the §2.0 counts. Original development content, not reproduced licensed retail text |
| DoW client UI — exists | **PASS** | Match screen at `packages/client/src/games/dead-of-winter/` |
| Visual (V1–V15) | **FAIL** | First real evidence captured run 22. See below — this is now measured, not unknown |
| Motion (M1–M9) | **FAIL** | **Zero animation code in the entire match screen.** No `motion.` element, no `AnimatePresence`, in any of the 11 match components. Not a judgement call |
| UX (U1–U13) | — | Critic pass in flight at end of run 22; treat as unassessed |
| Multiplayer N1/N3/N6 | **PASS** | Proven run 22 against two real browsers, 8/8 checks — see `tools/screenshot/multiplayer.mjs` |
| Multiplayer N4/N5/N7/N8 | — | Not attempted. N4 server restart is the most valuable next one |
| Blind comparison vs Wingspan | **FAIL** | Final gate; first attempt run 22 |

### Visual failures measured on 2026-09-03, not guessed

Captured from a real running 4-player match by `node tools/screenshot/capture.mjs`:

- **V15 FAIL, the headline bug.** `.dow-hand` — the player's own hand — hides **213px behind an
  inner scroll at every resolution, including 3840×2160.** This is precisely the Wingspan weakness
  §0 of the quality bar says we must beat: the player's most important state is not visible at a
  glance. A 4K desktop cannot see its own hand.
- **V15/V14 FAIL at small resolutions.** At 1280×720 `.dow-match__rail` hides 632px and
  `.dow-match__board` hides 185px; at 1366×768, 584px and 137px.
- **V11 FAIL.** Iconography is literal Unicode emoji (`⚔ 🔍 ✦ 🎓 🥫 🔧`) in `content.ts` and
  `game/parts.tsx`, not a designed set. Emoji render differently per platform and carry colours
  that fight the desaturated winter palette.
- **V3 FAIL.** The board is rounded rectangles with a location name and "Nobody here." — exactly
  what V3 forbids ("not coloured boxes labelled with location names").
- **V2 partial.** Survivor portraits are real illustration. Item, crisis, crossroads and objective
  cards are text boxes.
- **Composition.** A large empty dead region sits mid-left at 1920×1080, below the Hospital panel.

Passing, with evidence: the document itself never scrolls at any of the five resolutions, and the
console is **clean** — zero page errors and zero failed requests at all five. The production build
(`npm run build`) is clean.

## Build and test status

Verify the baseline yourself every run; do not trust this table. Measured on **Linux** on
2026-09-03. `npm install` was clean in 12 seconds and no dependency file needed hand-editing.

| Check | Command | Status |
| --- | --- | --- |
| Core | `npx tsc -b packages/core/tsconfig.json` | OK |
| Power Grid | `npx tsc -b packages/games/power-grid/tsconfig.json` | OK |
| Dead of Winter | `npx tsc -b packages/games/dead-of-winter/tsconfig.json` | OK |
| Server | `npx tsc -b packages/server/tsconfig.json` | OK |
| Client | `npx tsc -p packages/client/tsconfig.json --noEmit` | OK |
| Client production build | `npm run build` | OK |
| Power Grid tests | `npm test -w @game/power-grid` | 231 passed |
| DoW tests | `npm test -w @game/dead-of-winter` | 324 passed |
| Server tests | `npx vitest run --root packages/server` | 58 passed |

## Tooling you now have — use it, do not rebuild it

`tools/screenshot/` (added run 22, with its own README):

- `capture.mjs` drives a real match and screenshots all five required resolutions, writing a
  `report.json` with console output, page errors and per-element overflow measurements.
- `multiplayer.mjs` drives **two real browsers** through host/join/reconnect and exits non-zero on
  failure.
- `harness.mjs` is the shared driver. Read its README before changing it — three non-obvious things
  are documented there that cost run 22 time to rediscover.

Start both dev servers first (`npm run dev:server &`, `npm run dev:client &`).

## Queue — next workstreams, in dependency order

1. **`visual-core`** — the board (V3), card art (V2), and the icon set (V11). This is the largest
   remaining gap between us and the benchmark and it is where the comparison is won or lost.
2. **`layout-density`** — V14/V15. The measured overflow above. Partially addressed run 22.
3. **`motion`** — M1–M9, all currently FAIL with zero animation code. `@tt/ui` already ships motion
   tokens and `prefers-reduced-motion` handling, and `framer-motion` is already bundled, so the
   foundation is there and unused.
4. **`ux-pass`** — U1–U13 against the critic's findings.
5. **`multiplayer-proof`** — N4 server restart mid-game, then N7 vote secrecy, then N8 a full
   three-client game to a winner.
6. **`engine-tests`** — now a maintenance item, not a blocker.

## Known debts

- **Runs keep dying mid-night with unpushed work.** Push each unit the moment its tests are green.
  Do not batch. Run 22 pushed five times.
- **Do not use `git add -A` while sub-agents are running.** Run 22 did once and swept an agent's
  in-flight test file into an unrelated commit. It happened to be green; it might not be next time.
  Stage the specific paths you verified.
- **Latent engine gap found run 22, untested and unfixed.** `CrossroadsCardDefinition.chooser`
  admits `'activePlayer' | 'vote' | 'firstPlayer'` (`src/content/schema.ts:220`), but
  `triggerCrossroads` (`src/engine/crossroads.ts:194`) only special-cases `'firstPlayer'` and maps
  everything else to the active player. `xr-outbreak` declares `chooser: 'vote'` and is unaffected
  because its single option's outcome *is* the vote. A future `chooser: 'vote'` card with two or
  more options would silently let the active player decide alone. Decide whether to fix or to
  narrow the schema.
- **Two honest A14 boundaries, recorded rather than faked.** `This Taste Funny` has no
  counterfactual — no legal action sequence lets the holder act while holding the card, so the test
  proves the structure instead. Orphan-standee reconciliation cannot be constructed through the
  public action algebra at all.
- The public/strict suites reach their positions by deterministic seed search over real games. A
  content or RNG change may require re-finding seeds.
- `testPack` remains a fixture for isolated engine tests only; the live `dow-base` pack no longer
  uses fixture-backed objective families.
- Survivor portraits cover the 30-card base roster. No item, crisis, crossroads, objective, board,
  zombie or token art exists.
- **The Windows npm debt is Windows-only.** Earlier runs recorded the global `npm`/`npx` shims
  resolving a missing user-prefix CLI and the user npm config forcing `os=linux`. None of that
  applies in the Linux sandbox, where `npm install` is clean. Do not let that note stop you.
- **Pushing requires GitHub write access for the session.** Confirmed working run 22.
- **Concurrent sub-agents share one typecheck.** `tsconfig.check.json` includes `src/**/*.ts`, so an
  agent typechecking its own file also compiles every other agent's in-progress file. Brief agents
  that only errors in their own path are theirs, and run the clean full typecheck yourself before
  committing.
- `packages/client/src/portal/portal.scss` still uses `.pg-setup__*` class names; the
  `--pg-*` → `--tt-*` rename did not reach it.
- ~~Whether headless screenshots are possible in the sandbox~~ — **RESOLVED and now automated.**
  Chromium is at `/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is set,
  and **`playwright install` must never be run**. `puppeteer-core` is a root devDependency and
  `tools/screenshot/` wraps all of it. Chromium must be launched with Google's telemetry hosts
  disabled or navigation stalls until timeout — the harness already does this.
- The Wingspan blind comparison cannot be run against the real product from inside the sandbox
  unless the critic fetches reference material itself. `docs/QUALITY-BAR-DOW.md` §0 encodes
  Wingspan's specific strengths and weaknesses so the comparison is checkable either way.
