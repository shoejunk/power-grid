# Dead of Winter — progress log

Append-only. Newest entry at the top. One section per run.

Each entry must say: what the run intended, what actually landed, every critic verdict with its
reasoning, which disciplines changed state, and what the next run should do first. A lazy entry
makes the next run worse — it is the only memory the next run has.

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
