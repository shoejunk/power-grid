# Dead of Winter — progress log

Append-only. Newest entry at the top. One section per run.

Each entry must say: what the run intended, what actually landed, every critic verdict with its
reasoning, which disciplines changed state, and what the next run should do first. A lazy entry
makes the next run worse — it is the only memory the next run has.

---

## 2026-08-23 — nightly run 9

**Intent:** continue the first non-PASS queue item, `engine-tests`, starting with A8–A10 in
dependency order: immediate morale-zero termination and the three Add Zombies checkpoints;
Crossroads right-hand draw, active-player timing, movement/exposure ordering, and option legality;
then exile relocation, exposure/swap rules, objective adjustment, restrictions, allowed interactions,
and the two-non-betrayer-exiles loss condition. Each bounded area will have one owned test file and
an independent harsh critic. Integration fixes, verification, commits, and pushes remain with the
primary agent.

**(in progress — entry opened before implementation)**

---

## 2026-08-23 — nightly run 8

**Intent:** continue the first non-PASS queue item, `engine-tests`, with three bounded acceptance
areas and a push after each green unit:

- **A5:** search privacy/noise, crisis secrecy/scoring, ordered waste, food/starvation persistence,
  and public main-objective contributions.
- **A6:** zombie/survivor combat, kill-versus-remove, exposure/frostbite, bite chains, and
  last-survivor replacement.
- **A7:** colony entrance cycling, barricade destruction, overruns/casualty ordering,
  non-colony placement, and noise-generated zombies.

Each implementation agent owns one new test file, runs no git, and may only report engine defects
outside that file. Each area must then survive a separate harsh critic review against the design
doc before it can be called complete. Integration fixes, full-suite verification, commits, and
pushes remain with the primary agent.

**Landed, in separate green pushes:**

- `b51514d` — A5: 9 acceptance tests for search privacy/noise and deterministic bottoming,
  crisis secrecy/scoring/non-exiled threshold/cleanup, ordered waste, starvation persistence,
  and public objective contributions. Fixed crisis cleanup skipping every other contribution
  while mutating the live contribution array.
- `20528f2` — A7: 9 acceptance tests for exact 1→6→1 colony cycling, real sequence resets,
  barricade destruction, tied casualty choice, last-survivor replacement ordering, helpless and
  empty overruns, non-colony placement, and deterministic population/noise order.
- `38effc0` — A6: 18 acceptance tests for zombie/survivor combat, kill versus remove, all exposure
  faces, movement-before-exposure, frostbite, bite-chain ordering/stops/ties, deterministic private
  theft, and standard/exiled last-survivor replacement. Fixed first-player authority for tied bite
  targets, deferred replacement after a blank bite response, private exiled replacement choices,
  and former-owner authorization for stolen-card identity.

**Harsh critic verdicts:**

- **A5:** initial **FAIL** — only one bottomed search card, missing search boundaries, no spectator
  crisis proof, no non-exiled threshold proof, and ambiguous food arithmetic. Revised suite closed
  every gap; re-review **PASS**, 9/9 targeted.
- **A6:** initial **FAIL** — missing movement exposure, redacted/replay theft proof, multi-token
  frostbite, and exiled replacement. Second review **FAIL** because the former owner still could not
  identify the stolen card. After both revisions and engine fixes, final review **PASS**, 18/18
  targeted.
- **A7:** initial **FAIL** — no 6→1 wrap, last-survivor replacement ordering, helpless/empty
  overrun branches, or real sequence-reset proof. Revised suite closed every gap; re-review
  **PASS**, 9/9 targeted.

**Final verification:** all five TypeScript checks passed; Power Grid **230/230**, Dead of Winter
**183/183**, server **42/42**, and `git diff --check` passed. The exact validated implementation is
on `master` at `38effc0`; the handoff-only commit follows it.

**State change:** engine-test coverage advanced from A1–A4 to **A1–A7**. The discipline remains
**PARTIAL** because A8–A15 and all named §18 errata still need their acceptance/regression suites.
Content, visuals, motion, UX, art, blind comparison, and multiplayer proof did not change and must
not be inferred to pass. No visual critic or screenshot run was performed because the dependency-
ordered workstream was engine tests.

**Next run:** stay on `engine-tests`; take A8–A10 first (morale-zero checkpoints, crossroads
draw/trigger/option legality, and exile relocation/restrictions/two-non-betrayer loss), again with
one owned test file and a separate harsh critic loop per criterion group.

---

## 2026-08-22 — nightly run 7

**What run 6 got done, for the record:** one commit, `976490a`, its own intent entry. **Zero A5–A15
tests written.** That is now five consecutive runs (2, 3, 4, 5, 6) that declared `engine-tests` and
landed no acceptance tests. Verified on master tonight: `src/engine/__tests__/` still holds only
`setup.test.ts`, `dice-and-actions.test.ts`, `redaction-replay.test.ts`, `bot.test.ts`,
`smoke.test.ts` and `helpers.ts`. `STATE.md`'s claim of A1–A4 coverage is accurate; everything else
in the queue is untouched.

**Diagnosis, refined.** Run 6 correctly identified that the kill lands inside the first hour, but
its fix (commit the smallest unit first) did not address *why* that hour is spent: **I** was doing
all the reading — the design doc, the engine API, the helper fixtures — before any sub-agent could
be briefed. That reading is the hour. Tonight I do not read the design doc or the engine source at
all. Each sub-agent is given a §-number, a file list and its one output file, and does its own
reading. My only jobs are: push this entry, spawn, apply engine fixes agents report, run the full
suite, commit each green file separately.

**Baseline verified before any work, and it is green** at `58648e8`, measured not trusted:
`npm install` clean; all five `tsc` builds OK (core, power-grid, dead-of-winter, server, client);
Power Grid **230 passed**, server **42 passed**, Dead of Winter **147 passed** across the five
pre-existing files. `STATE.md`'s build table was accurate.

**Intent:** workstream `engine-tests`, in parallel, one sub-agent per §23 criterion group, each
owning exactly one new file under `src/engine/__tests__/`, each looping against its own harsh
critic:

- A5 — search privacy, crisis secrecy, waste, food persistence
- A6 — combat, kill-vs-remove, exposure, frostbite, bite chains, last-survivor replacement
- A7 — colony entrance cycling, barricades, overruns, casualty choice, noise zombies
- A8–A10 — morale-zero termination, crossroads draw/trigger/legality, exile
- A11–A13 — effect interruption, once-per-round persistence, objective-check timing, winners
- A14 — every named §18 erratum, one targeted regression test each
- A15 — determinism (same seed + action log ⇒ identical state) and a whole-view redaction walk

Sub-agents run no git and never edit engine source. Engine bugs they find are reported back and I
apply them, so no two agents ever touch the same file.

(in progress — entry completed at end of run)

---

## 2026-08-20 — nightly run 6

**What run 5 got done, for the record:** run 5 was killed after two commits — `f0e821e` (its intent
entry) and `8e15e2c` (a full rewrite of `STATE.md` correcting three runs of staleness). It wrote
**none** of the A5–A15 tests it declared. That is now four consecutive runs (2, 3, 4, 5) that
declared `engine-tests` and landed zero acceptance tests. `STATE.md` is at least accurate now.

**Diagnosis of the pattern:** every one of those runs spent its first hour re-reading the design
doc, re-deriving the engine API, and briefing sub-agents from scratch before a single test file
existed. The kill always landed inside that window. Tonight inverts it: the *smallest* useful unit
is committed first and the briefing is amortised. One sub-agent per §23 criterion group, each
owning exactly one new test file under `src/engine/__tests__/`, each looping against its own harsh
critic, and **I commit and push the moment a file's suite is green** — not at the end of the group,
not at the end of the night.

**Intent:** workstream `engine-tests`. Targets in order: §23 **A5, A6, A7** (search privacy /
crisis secrecy / waste / food persistence; combat, kill-vs-remove, exposure, frostbite, bite chains,
last-survivor replacement; colony entrance cycling, barricades, overruns, casualty choice, noise
zombies), then **A8–A13** (morale-zero termination, crossroads draw/trigger/legality, exile,
effect-interruption and once-per-round persistence, objective-check timing, winner evaluation),
then the **§18 errata** required by **A14**, then **A15** determinism + a whole-view redaction walk.

Sub-agents run no git and do not edit engine source. Engine bugs they find are reported back and I
apply them, so no two agents ever touch the same file.

(in progress — entry completed at end of run)

---

## 2026-08-20 — nightly run 5

**What run 4 actually got done, for the record:** run 4's own entry below stops at "in progress" —
it was killed before writing its result — but it landed a large commit, `ee833d0`
*"feat(dow): make Dead of Winter playable"*. That commit did **not** do the A5–A15 engine-test work
it declared as its intent. It jumped ahead to queue item 3 (`client-ui`) and built the whole Dead of
Winter match screen: `Match.tsx`, `Board.tsx`, `ChoiceDialog.tsx`, `Seats.tsx`, `LogPanel.tsx`,
`GameOverPanel.tsx`, a `content.ts` lookup, plus bot seats and an `activePlayerOf` fix in the game
package. So the client UI now exists and the portal will create a Dead of Winter game — but it has
had **no critic pass, no screenshot, and no visual verification of any kind**, and `STATE.md` (last
touched at run 2) still describes it as a placeholder. That row is wrong and gets corrected tonight.

**Intent:** the queue is still in dependency order and `engine-tests` is still its first non-PASS
item. Runs 2, 3 and 4 each declared A5–A15 and each died before writing a single one of those tests,
which is a pattern, not bad luck: the work was batched behind one big push at the end of the night.
Tonight changes the method rather than the target. Each sub-agent owns exactly one test file, and
**each finished file is committed and pushed on its own the moment its suite is green** — so a kill
at any point keeps everything landed up to that point. Targets, in order: §23 **A5–A7** (search
privacy / crisis secrecy / waste / food, combat and exposure and bite chains, colony entrance and
overrun ordering), then **A8–A13**, then the **§18 errata** required by A14. Sub-agents run no git
and do not edit engine source; engine bugs they find come back to me and I apply them, so no two
agents ever touch the same file.

(in progress — entry completed at end of run)

---

## 2026-08-18 — nightly run 4

**Baseline verified before any work, and it is green.** `npm install` clean; all five `tsc` builds
clean (core, power-grid, dead-of-winter, server, client); Power Grid **230**, Dead of Winter **141**,
server **42**. Working tree clean at `b286a93`.

**What run 3 actually got done, for the record:** run 3 was killed very early. It landed exactly
three commits — deleting run 2's broken scratch probe (`9e27937`), adding `tsconfig.check.json`
(`365d170`), and the ErrorBoundary tag fix (`b286a93`). **None of the A5–A15 test work it intended
was written.** Its PROGRESS entry above stops at "in progress" and should be read as intent only.

**Intent:** continue workstream `engine-tests` — still the first queue item and still incomplete.
Coverage on master today is A1–A4 (`setup.test.ts` 68, `dice-and-actions.test.ts` 70) plus one
redaction test. Tonight targets the remaining §23 criteria **A5–A13**, the **§18 errata** regression
coverage required by A14, and **A15** replay/redaction. One sub-agent per criterion group, each
owning exactly one new test file, each looping against its own harsh critic. Sub-agents run no git
and do not edit engine source; engine bugs they find come back to me and I apply them, so no two
agents ever touch the same file.

(in progress — entry completed at end of run)

---

## 2026-08-18 — nightly run 3

**Baseline verified before any work.** `npm install` clean. Builds: core OK, power-grid OK, server
OK, client OK — but **dead-of-winter and server `tsc -b` were RED**. Run 2 was killed mid-run and
left `src/engine/__tests__/crossroads.test.ts` on `master`: a sub-agent's scratch `console.log`
probe, not a real test, referencing a non-existent `GameState.rounds`. It passed `vitest` (which
does not typecheck) while breaking every downstream build. Deleted it — first commit of the night.
Post-fix baseline: all five builds clean, Power Grid **230**, server **42**, Dead of Winter **142**.

**Correction to run 2's record:** despite the commit message `wip(dow): in-flight crossroads and
redaction suites`, there is no crossroads coverage on master. The only crossroads file was the
probe. `redaction-replay.test.ts` holds exactly **one** test. Real coverage today is A1–A4 via
`setup.test.ts` (68) and `dice-and-actions.test.ts` (70).

**Intent:** finish workstream `engine-tests` — the remaining §23 criteria **A5–A13**, the **§18
errata** regression coverage required by A14, and **A15** replay/redaction. Fanning out sub-agents,
each owning exactly one new test file, each looping against its own harsh critic. Sub-agents run no
git and do not edit engine source; engine bugs they find are reported back and applied here.

(in progress — entry completed at end of run)

---

## 2026-08-15 — nightly run 2

**Baseline verified before any work** (not trusted from `STATE.md`): `npm install` clean on Linux,
all five `tsc` builds clean, Power Grid **230 passed**, Dead of Winter **140 passed**, server
**42 passed**. Run 1's own PROGRESS entry was left unfinished — it was killed mid-run — but its
work did land on `master` (`fb8fa62`): the A1–A4 acceptance suites plus five engine fixes those
suites found. `STATE.md` still claims "DoW tests: none exist"; that is stale and gets corrected
tonight.

**Intent:** continue workstream `engine-tests`, the first queue item, which is only ~27% done.
A1–A4 are covered. Tonight takes the remaining §23 acceptance criteria **A5–A15** and the **§18
errata** regression coverage required by A14. Fanning out one sub-agent per criterion group, each
owning exactly one new test file, each looping against its own harsh critic. Sub-agents do not run
git and do not edit engine source — engine bugs they find are reported back and applied here, so
two agents can never race the same file.

(in progress — entry completed at end of run)

---

## 2026-08-13 — nightly run 1

**Intent:** workstream `engine-tests` — stand up the vitest suite for the Dead of Winter engine
covering all 15 §23 acceptance criteria and every §18 erratum.

**Blocker found first, before any of that:** `npm install` fails outright on Linux. The root
`package.json` carried `@esbuild/win32-x64` and `@rollup/rollup-win32-x64-msvc` as **hard**
`devDependencies`. On any non-Windows machine npm aborts the whole install with `EBADPLATFORM`,
so `node_modules` was never populated, `@tt/core` and `vitest` did not resolve, and every build
and test command failed. The previous run's "all packages build clean" claim was true only on the
Windows dev machine — the nightly sandbox is Linux, so **no nightly run could have built or tested
anything**. Moved both to `optionalDependencies`, which npm skips on platform mismatch while still
installing them on Windows. Install, all five builds and both suites are green again.

(in progress — entry completed at end of run)

---

## 2026-08-12 — setup run (interactive, not the routine)

**Intent:** turn the single-game Power Grid repo into a multi-game platform, add Dead of Winter as
the second game, and stand up a nightly routine to carry it to AAA quality.

**Landed:**

- **Platform restructure.** `packages/core` (`@tt/core`) now holds the game-agnostic platform:
  seats, lobbies, join codes, the wire protocol, the seeded `Rng`, `GameRegistry`, and the
  `GamePlugin` contract. `packages/shared` became `packages/games/power-grid`. `packages/ui`
  (`@tt/ui`) holds the shared design system. The server is registry-driven and holds no game rules;
  the client is a portal that mounts one UI per game.
- **Plugin boundary.** Everything the server used to know about Power Grid moved behind
  `GamePlugin`. Three methods were added because removing them silently broke real behaviour, each
  caught by a test rather than by reading: `seatCapacity` (host sizing a table below the game's
  ceiling), `applyHostChange` (a game that gates setup on the host strands its table when the host
  leaves), and `applyPresence` (folding socket presence into game state without the server knowing
  what a player record looks like).
- **Persistence migration.** `games` gained a `gameKey` column with a self-applying, idempotent
  migration; pre-existing rows are tagged `power-grid`. Verified against a copy of the live
  database — 78 games, state blobs intact. One real bug was caught here: the new index was being
  created before the column existed, which would have crashed any existing deployment on boot.
- **Server tests rewritten** to run against a deliberately fictional stub game, so server code that
  had quietly grown game-specific behaviour cannot pass. 42 tests.
- **`docs/QUALITY-BAR-DOW.md`** written — the Wingspan-calibrated rubric: V1–V15 visual, M1–M9
  motion, U1–U13 UX, all 15 §23 acceptance criteria as a checklist, N1–N8 multiplayer, and the
  blind-comparison gate.
- **Dead of Winter engine**, ~9,400 lines: content schema and validator, effect runner, state,
  setup, flow, survivors, zombies, crossroads, exile, endgame, redaction, actions, policy. The
  plugin implements the full platform contract.
- **Boundary audit.** `packages/core`, `packages/server` and `packages/client/src/net` carry no
  game vocabulary beyond doc comments and the deliberate legacy-migration constants.

**Critic verdicts:** none. No critic pass has been run — there is no Dead of Winter UI to judge yet.

**State changes:** platform plumbing → PASS. DoW engine code → exists. Everything visual → still
absent.

**Honest gaps:**

- The Dead of Winter engine has **zero tests**. Its 9,400 lines are unverified against the spec.
- The Dead of Winter client UI is a placeholder file.
- No content catalog beyond the `testPack` fixture.
- Two shared-code leaks recorded in `STATE.md` under "Known debts".

**Next run should do first:** `engine-tests`. Nothing downstream can be trusted until the engine is
verified against §23 and §18.
