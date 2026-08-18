# Dead of Winter — progress log

Append-only. Newest entry at the top. One section per run.

Each entry must say: what the run intended, what actually landed, every critic verdict with its
reasoning, which disciplines changed state, and what the next run should do first. A lazy entry
makes the next run worse — it is the only memory the next run has.

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
