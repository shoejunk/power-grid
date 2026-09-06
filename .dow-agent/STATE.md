# Dead of Winter — current state

This file is the routine's handoff. **Read it first, update it last, push it with the work it
describes.** It records what is true right now; `PROGRESS.md` records how we got here.

Last updated: **2026-09-06** (nightly run 26: board/card art integrated and live; visual gates remain FAIL)

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

**Run 24's visual attempt produced nothing, for a reason worth knowing.** Three visual workers were
fanned out concurrently and **all three were killed by the same session rate limit** partway through
their first edit pass. The fan-out bought no parallelism and cost the whole visual budget. Prefer
**one or two** workers, and make each commit-ready its smallest useful unit early.

**The blind Wingspan comparison cannot be run from this sandbox.** Confirmed run 24 by direct test:
Steam, the review sites and every image CDN tried are refused by the egress proxy with `403` on
CONNECT; `WebSearch` returns text only. A critic **cannot** fetch reference screenshots. Do not
accept — or write — a claim that a side-by-side was performed here. Either score against the §0
benchmark description, or get a human to commit reference images into the repo. Until then that gate
is **BLOCKED**, which by the rubric's own rule counts as FAIL, not as passed.

Run 26 partially reopened that path: independent critics reached official Steam Wingspan material,
but it was a marketing-page/gameplay image rather than a clean game-only blind side-by-side. Record
the formal comparison as **FAIL**, not PASS, until a clean reference comparison is available.

Runs 5 through 21 all declared `engine-tests` and nothing else. Seventeen nights. In that time the
Visual, Motion and UX sections — which are the **majority of the quality bar and the actual stated
goal of the project** — were never assessed even once, and the Wingspan comparison was never
attempted. The queue's dependency argument ("don't judge a UI built on an unverified engine") was
sound in run 2 and stopped being sound a long time ago.

Run 22 broke that pattern and the next run should not restore it. The engine now has 338 tests
covering A1–A15. **The bottleneck is no longer the engine. It is that the game does not look
finished.** Spend the night on the visual queue unless the baseline is red.

## Scorecard

Scored against `docs/QUALITY-BAR-DOW.md`. `—` means not yet assessed, not "passing".

| Discipline | State | Notes |
| --- | --- | --- |
| Platform / multiplayer plumbing | **PASS** | 58 server tests green; game-agnostic boundary audited |
| Power Grid (regression guard) | **PASS** | 231 engine tests green; must never go red |
| DoW engine — code exists | **PASS** | ~5,400 lines under `engine/`; plugin implements the full `GamePlugin` contract |
| DoW engine — tested | **PASS for A1–A15 coverage** | 338 tests (run 24: +8 chooser, +6 vote secrecy). Every §23 criterion has a named suite; run 22 closed the last public §18.4 crossroads tranche. Two honest boundaries remain, recorded under Known debts |
| DoW content pack | **PASS** | Authored `dow-base` v0.5.0-dev at the §2.0 counts. Original development content, not reproduced licensed retail text |
| DoW client UI — exists | **PASS** | Match screen at `packages/client/src/games/dead-of-winter/` |
| Visual (V1–V15) | **FAIL** | Run 26 wired authored board scenes and item-card faces into the live match; independent critics still fail V2/V3/V8/V11/V13/V14/V15. |
| Motion (M1–M9) | **FAIL** | **Zero animation code in the entire match screen.** No `motion.` element, no `AnimatePresence`, in any of the 11 match components. Not a judgement call |
| UX (U1–U13) | — | Still unassessed. No critic pass has ever completed. Run 24 added one visible U5 gain (a "Only you can see these cards" label on the hand) as a side effect, unscored |
| Multiplayer N1/N3/N6 | **PASS** | Proven run 22 against two real browsers, 8/8 checks — see `tools/screenshot/multiplayer.mjs` |
| Multiplayer N4 | **PASS** | Run 24 audited the existing coverage rather than assuming it absent: `packages/server/src/__tests__/dead-of-winter-deferred-morale.test.ts` drives a real round to a position holding a pending `overrunCasualty` choice, a non-empty effect stack and `deferMoraleCheck`, restarts the server, and asserts all three survive — then rejoins the seat with its hand and secret objectives and plays on. `persistence.test.ts` covers the in-progress and lobby cases. Previous runs recorded this as "not attempted"; that was wrong |
| Multiplayer N7 | **PASS** | Proven run 24 by `src/engine/__tests__/vote-secrecy.test.ts` — 6 tests through the plugin boundary, verified to fail when the redaction guard is disabled |
| Multiplayer N5/N8 | — | Still not attempted. N8 (three clients, full game to a winner) is the valuable one |
| Blind comparison vs Wingspan | **BLOCKED → FAIL** | Reference images are unreachable from the sandbox (egress `403`). Run 24 proved this rather than assuming it. Needs human-supplied reference material or §0-based scoring |

### Visual failures measured on 2026-09-03 and rechecked on 2026-09-04, not guessed

Captured from a real running 4-player match by `node tools/screenshot/capture.mjs`:

- **V15/V14 run-22 baseline failure was materially reduced.** The run-23 live CUA audit measured a
  real 4-player setup at 1280×720, 1366×768, 1920×1080, 2560×1440, and 3840×2160. At each size,
  document, board, rail, and hand `scrollWidth` equalled `clientWidth`; document dimensions equalled
  the viewport. This is strong evidence for the normal setup state, but not a worst-case full-match
  PASS, and the compact layout still needs a harsh visual review.
- **V11 improved but is not independently closed.** Literal Unicode pictograms were removed from the
  DoW match sources and replaced with an inline SVG vocabulary plus pip dice. A full 200% scale and
  contrast audit was not completed.
- **V3 remains FAIL.** Run 26 wired authored winter location scenes into the board and removed the
  former dead region at 1920×1080, but independent review found the scenes render as shallow ribbons
  with insufficient foreground depth, lighting, and material texture.
- **V2 remains FAIL/partial.** Run 26 made five item cards illustrated and readable in the wide hand
  dock, but survivor, crisis, crossroads, and objective card families still lack card-scale treatment;
  the 1366 compact hand is too small for a visual pass.
- **V8/V11 remain FAIL.** Card shadows and SVG treatment add some depth, but board elevation and
  icon readability are not at the bar, especially at compact size.
- **Composition improved but is not closed.** The 1920×1080 normal state now shows the board and a
  readable five-card hand without document overflow. The 1366×768 fallback keeps the board and hand
  in view, but is cramped. Only these two resolutions were captured in run 26; the five-resolution
  matrix and a true five-player/full-hand worst-case remain unproven.

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
| DoW tests | `npm test -w @game/dead-of-winter` | 338 passed |
| Server tests | `npx vitest run --root packages/server` | 58 passed |

Run 25 reverified the runtime suites on Windows after restoring the required optional Windows Rollup
binary: Power Grid **231/231**, DoW **338/338**, and server **58/58** passed. Client, DoW and server
no-emit TypeScript checks passed. The emitted DoW/server builds still hit EPERM writing existing
`dist` artifacts, even on the elevated retry; no source diagnostics were reported. The Windows `npx`
shim still cannot resolve the server Vitest binary, so the equivalent repository-local Vitest
entrypoint was used. No tracked dependency files changed.

Run 26 reverified the same suites on Windows: Power Grid **231/231**, DoW **338/338**, and server
**58/58** passed. The client, DoW, and server no-emit TypeScript checks passed; both DoW SCSS
entrypoints compiled; `git diff --check` passed; and `npm run build` completed successfully,
including the Vite production bundle. The repository-local Vitest entrypoint was used for the server
suite. No dependency files changed.

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

0. **`visual-core` art modules — validated for retention, not quality closure.**
   Run 26 wired `game/board-art.tsx` into `Board.tsx` and `game/card-art.tsx` into `parts.tsx`,
   namespaced their SVG definitions, and captured the live result. They are no longer dead code, but
   both independent critics found the current board/card treatment below the AAA bar. Keep them for
   the next visual pass; do not call this item or the visual section PASS.

1. **`visual-core`** — the board (V3), card art (V2), and the icon set (V11). This is the largest
   remaining gap between us and the benchmark and it is where the comparison is won or lost.
   The measured defects are unchanged and visible in `.shots/run24-verify/match-1920x1080.png`:
   **~35% of a 1920×1080 screen is empty** below the board; the hand is **five ~45px slivers with
   names clipped mid-word**; survivor names ellipsize in the colony. Composition and hand size are
   the highest-value single change available.
2. **`layout-density`** — V14/V15. Normal-state overflow is now measured clean at five sizes, but
   the full worst-case state and visual composition still need proof.
3. **`motion`** — M1–M9, all currently FAIL with zero animation code. `@tt/ui` already ships motion
   tokens and `prefers-reduced-motion` handling, and `framer-motion` is already bundled, so the
   foundation is there and unused.
4. **`ux-pass`** — U1–U13 against the critic's findings.
5. **`multiplayer-proof`** — N4 and N7 are now PASS. What remains is **N5** (indefinite pause) and
   **N8** (three real clients, a full game to a winner including an exile, a bite chain, an overrun
   and winner evaluation). N8 is the valuable one.
6. **`engine-tests`** — now a maintenance item, not a blocker.

## Known debts

- **Runs keep dying mid-night with unpushed work.** Push each unit the moment its tests are green.
  Do not batch. Run 22 pushed five times; run 24 pushed six.
- **Sub-agents die too, and they die mid-edit.** Run 24's layout worker left an `@@RESPONSIVE@@`
  placeholder in `dead-of-winter.scss` that broke the stylesheet outright — the client would not
  render and the harness could not reach START GAME. Its work was reverted. **Always compile the
  SCSS (`npx sass ... /dev/null`) and capture a screenshot before believing a worker's output**;
  `tsc` alone does not catch a broken stylesheet.
- **The salvaged art modules are now wired but still below the bar** (`board-art.tsx`,
  `card-art.tsx/.scss`). See queue item 0 and the run-26 critic verdicts; improve their scale/depth
  and card-family coverage before considering deletion or visual PASS.
- **Do not use `git add -A` while sub-agents are running.** Run 22 did once and swept an agent's
  in-flight test file into an unrelated commit. It happened to be green; it might not be next time.
  Stage the specific paths you verified.
- ~~Latent engine gap found run 22~~ — **RESOLVED run 24** (`4c7e7b9`). The schema was narrowed to
  `'activePlayer' | 'firstPlayer'` rather than growing a second N-ary voting path beside the binary
  one: §10's "unless the card specifies a vote" is served by the `vote` *effect*, which is the only
  place an electorate can be expressed at all (§15/§18.4 `Outbreak`). `triggerCrossroads` is now
  exhaustive, so a future member is a compile error. `src/engine/__tests__/crossroads-chooser.test.ts`
  guards the data path the compiler cannot see, and was verified to fail when the old declaration is
  reinstated.
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
- ~~`portal.scss` still uses `.pg-setup__*`~~ — **STALE, corrected run 24.** `portal.scss` contains
  zero `pg-setup` or `--pg-` occurrences. The only surviving `--pg-*` tokens live under
  `packages/client/src/games/power-grid/`, where they are correctly game-scoped, not platform
  tokens. There is nothing to rename.
- ~~Whether headless screenshots are possible in the sandbox~~ — **RESOLVED and now automated.**
  Chromium is at `/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is set,
  and **`playwright install` must never be run**. `puppeteer-core` is a root devDependency and
  `tools/screenshot/` wraps all of it. Chromium must be launched with Google's telemetry hosts
  disabled or navigation stalls until timeout — the harness already does this.
- The Wingspan blind comparison cannot be run against the real product from inside the sandbox
  unless the critic fetches reference material itself. `docs/QUALITY-BAR-DOW.md` §0 encodes
  Wingspan's specific strengths and weaknesses so the comparison is checkable either way.
