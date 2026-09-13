# Dead of Winter — current state

This is the nightly handoff. PROGRESS.md contains the historical run record. The quality bar and
`dead-of-winter-gameplay-requirements.md` remain authoritative; passing builds are not AAA proof.

Last updated: **2026-09-13 07:08:48 -07:00, nightly run 36**.

## Current checkpoint and blocker

- No STOP or .aaa-complete marker. Run 36 checkpoint `31e5c30` is pushed to `master` and
  `origin/master`; the four reviewed source/harness files below remain uncommitted until the
  visual/evidence unit is finalized.
- Run 36 changed only `packages/client/src/games/dead-of-winter/game/{dead-of-winter.scss,card-art.scss}`
  and `tools/screenshot/{harness.mjs,capture.mjs}`. The CSS improves compact card floors, wraps
  compact location headers, and caps the 4K hand. The harness now asserts rendered configured count,
  lobby seats, visible setup completion, and a live `PLAYER TURNS` state.
- Full baseline is green: five TypeScript checks, production build, Power Grid 231/231, DoW 338/338,
  and server 58/58. Exact npm/test entrypoints still hit known Windows EPERM process limits; the
  repository-local single-thread fallback passed.
- Fresh five-player matrix evidence is under `.shots/run36-matrix/`; actual count and live setup passed
  at 1280, 1366, 1920, 2560, and 3840. The 1920 frame contains the required density areas. 1280/1366
  retain 452/412px internal match overflow; every capture has a WebSocket startup warning.
- Independent evidence and visual critics both failed the formal gates. Wingspan still wins overall;
  V13/V15, 200%/accessibility/contrast/icon audits, clean console, motion, UX, and multiplayer proof
  remain open. No completion claim.

## Run 36 evidence and critic verdicts

The isolated server used `.shots/run36-data/power-grid.db`; no pre-existing user game database was
modified. Headless Edge was launched through `TT_CHROMIUM`. The harness caught and fixed two runtime
bugs during this run: case-sensitive `PLAYER TURNS` matching and a page-scope crash in capture error
handling. The repaired rerun and complete matrix both exited successfully and were read as images.

- `.shots/run36-five-rerun/report.json` proves requested/configured/lobby/observed count 5, five named
  seats, no setup dialog, and one acting seat in the rendered live phase. It does not prove independent
  human clients, authoritative seat IDs, full-round play, or private-state recovery.
- `.shots/run36-matrix/report.json` proves actual five-seat live captures at all required resolutions.
  Document overflow is zero, but `.dow-match` hides 452px at 1280 and 412px at 1366. The report still
  records intended public/log inner scroll, and every resolution contains a WebSocket closed-before-
  established warning. These are evidence limits, not PASS claims.
- Visual critic: V4 and V14 PASS only; V1/V2/V3/V5/V6/V8/V9/V10/V11/V13/V15 FAIL or unproven.
  Wingspan wins art, layout confidence, typography, icon clarity and overall desktop polish; Dead of
  Winter wins only the 1920 information-density comparison. Highest-value next fix is responsive
  composition: eliminate hidden compact scroll and remove the detached 4K hand/empty-space treatment.
- Evidence critic: count/live-state assertions materially improved, but N1/N3/N6/N8 remain FAIL. The
  harness is DOM evidence, not authoritative server-state or multi-browser proof; next test is three
  independent clients, completed setup in each, tab return with exact hidden-state comparison, then a
  full game with exile, bite chain, overrun, winner evaluation, and restart.

## Fresh baseline — run 35 (historical)

Exact npm install failed with Windows spawn EPERM. The approved repair completed:
`npm install --include=optional --os=win32 --cpu=x64 --package-lock=false --ignore-scripts`.
No tracked dependency manifest or lockfile changed. Exact test commands then hit Windows fork
EPERM and the npx Vitest shim failure; approved repository-local single-thread Vitest passed.

| Check | Fresh result |
| --- | --- |
| Core, Power Grid, DoW, server composite TypeScript builds | PASS |
| Client TypeScript no-emit | PASS |
| Full production build, including Vite/SCSS | PASS |
| Power Grid | 231/231 tests PASS |
| Dead of Winter | 338/338 tests PASS |
| Server | 58/58 tests PASS |

Fallback suite command pattern:
`node packages/<workspace>/node_modules/vitest/vitest.mjs run --root packages/<workspace> --pool=threads --poolOptions.threads.singleThread`.
Use games/power-grid, games/dead-of-winter, and server as the workspace paths. Do not repeat
installation if optional binaries are already available. Do not delete node_modules or the lockfile.

## Run 35 runtime evidence and newly found harness limits

The isolated server uses `.shots/run35-data/power-grid.db`; no pre-existing user game database was
modified. Set TT_CHROMIUM to `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` to run
`tools/screenshot/` on this Windows host. Headless capture succeeded this run. Its success is a
current observation, superseding earlier Windows launch failures as a blanket blocker.

- `.shots/run35-baseline/match-1920x1080.png` and report.json: real four-player match after setup.
  Read directly: tiny/truncated hand text, excess empty top-panel area, small survivor labels;
  colony and six locations are visible. No document overflow, page errors or failed local requests.
  The report DOES include a WebSocket closed-before-established warning. Do not call its console clean.
- The matrix in `.shots/run35-five-seats/` was requested with --players 5 but is **not five-player
  evidence**. Read-only inspection of the isolated SQLite rows confirms playerCount=4 and four seats
  for the completed captures. The directory name and report's players field describe the request,
  not the actual table. No V4/V5/V15 five-player PASS is supported.
- `tools/screenshot/harness.mjs:228` assumes the form starts at two players and uses clickText for
  the icon-only Increase Players button. That helper searches innerText, not its accessible label,
  so changing the count silently fails. Read and set the actual stepper, then assert real seat count
  before declaring five-player screenshots admissible. This correction remains unimplemented.
- `.shots/multiplayer/multiplayer-report.json` reports 8/8 assertions passed, zero host/guest page
  errors, and real code join, objective separation, tab return and objective restoration. These are
  narrow assertions, not full N3/N6 or full-round proof. Its handCount selector counts descendants
  (162 here), not actual cards; the title selector misses .dow-card__name. Compare actual visible
  card identities and every required seat field rather than counting arbitrary card-class elements.
- More seriously, the two-browser table remained in **setup** after the harness returned success:
  the host had kept survivors before the guest completed their setup, but its later leader choice
  was never revisited. SQLite confirmed phase=setup. Alternate setup resolution across all real
  clients until the game reaches playerTurns, then prove a full round. No current full-game,
  mid-round tab-return or browser/server-restart claim is justified by this script.
- Browser matrix results are recorded in the final run-35 PROGRESS entry. No 200% audit, 60fps
  measurement, crowded full-hand state, clean Wingspan comparison, or independent visual verdict.

## Scorecard

Strict criteria without sufficient evidence remain FAIL. Historical evidence is identified below;
no overall completion or full-product pass follows from a scoped suite.

| Discipline | State | Evidence / limit |
| --- | --- | --- |
| Platform regression guard | PASS | 58 server tests, freshly green |
| Power Grid regression guard | PASS | 231 engine tests, freshly green |
| DoW engine implementation and A1–A15 named test coverage | PASS for coverage | 338 tests, freshly green; full running-game acceptance is a separate gate |
| Authored development content manifest | PASS for counts | dow-base v0.5.0-dev; not licensed retail text or shipping parity |
| DoW client exists | PASS | Running match captured |
| Visual V1–V15 | FAIL | Run-36 matrix is real five-seat evidence; V4/V14 only PASS. Compact overflow, art depth, 200%, contrast, accessibility and density gaps remain |
| Motion M1–M9 | FAIL | No established match animation/audio system or 60fps proof |
| UX U1–U13 | FAIL / unassessed | No complete independent assessment |
| N1 host/code/join | PASS, scoped runtime | Historical two-browser join evidence; run-36 capture uses one host plus bots and is not new N1 proof |
| N3/N6 exact state and hidden-information browser recovery | FAIL | Historical scoped passes; run-36 harness is one rendered DOM and proves no exact hidden-state recovery |
| N4 pending-state restart | PASS, prior targeted evidence reverified | dead-of-winter-deferred-morale.test.ts and persistence tests; no new full-browser restart proof |
| N7 vote secrecy | PASS, prior targeted evidence reverified | vote-secrecy.test.ts through plugin boundary |
| N5 indefinite pause | FAIL for full DoW browser proof | Generic server test passes; complete scoped runtime evidence still owed |
| N8 full game with three real clients and required incidents | FAIL | Not demonstrated |
| Wingspan side-by-side | FAIL | Run-36 critic fetched current Steam gameplay reference; Wingspan wins overall |

Run 32's QA accepted asset resolution, privacy branches and interaction preservation, and the visual
critic accepted scoped card elevation. Formal V2 still failed per-card illustration uniqueness;
V11/V13 remained unproven at compact/200% scale. These verdicts are retained, not upgraded.
Older reference-fetch failures are historical: run 26 reached official Steam material but did not
produce an admissible clean comparison. Future critics should verify availability afresh.

## Queue — dependency order

0. **Checkpoint run 36 and preserve truthful critic failures.** Stage only the four reviewed files plus
   this handoff, verify the full suite/build, and push. Do not claim V13/V15 or multiplayer from the
   matrix. The visual unit remains below the bar and must continue.
1. **visual-core — first unfinished product workstream.** Critic returned the unit for responsive
   composition. Next target is removing 1280/1366 hidden match scrolling while keeping the hand readable,
   and integrating the 4K hand without a detached empty-space composition. Preserve private/public
   boundaries, card selection and actions. Then re-run the harsh Wingspan comparison; do not move to
   motion until this visual gate has a passing responsive proof.
2. **layout-density.** V14 requires one 1920x1080 screenshot containing all nine state areas.
   V15 requires a verified five-player crowded state at 1366x768. Internal scrolling is not a PASS.
3. **motion.** M1–M9; use the existing @tt/ui tokens, reduced-motion support and framer-motion.
4. **ux-pass.** U1–U13, keyboard, explicit legality/costs/pauses, privacy treatment and topology.
5. **multiplayer-proof.** Correct the harness, verify exact field/identity restoration, then N5/N8:
   three real clients, full game, exile, bite chain, overrun, winner evaluation and server restart.
6. **engine-tests.** Maintenance unless a fresh baseline is red.

## Known debts and safeguards

- Two A14 evidence boundaries remain: This Taste Funny lacks a legal counterfactual holder action;
  orphan reconciliation cannot be constructed through the public action algebra. Do not invent proof.
- The authored content pack meets shape/count goals but the design doc separately calls for a licensed
  catalog. Original development content is not licensed retail completeness. testPack is fixture-only.
- Run 32's default local server skipped five persisted DoW rows unreadable by the current plugin.
  Fresh isolated tables work; old-row compatibility was not investigated and no old row was altered.
- Original seven item plates and four hero plates are committed. Zombie/token art and board treatment
  remain below the full visual bar. No per-definition unique illustration or full-family 200% audit.
- Preserve unrelated edits and untracked files. Root NUL/NUL.map were identified as generated Sass
  output and preserved under ignored .shots/preserved-sass-20260911/ at the prior checkpoint.
- Only the parent runs Git. Never git add -A while workers run. Compile SCSS plus the client build,
  capture and READ screenshots, then stage only reviewed paths. TypeScript does not validate SCSS.
- Limit to one or two workers; earlier fan-out died at a common usage limit with unpushed edits.
  Push each green unit and keep this handoff truthful. No indirect workaround for denied pushes.
- Screenshot reports can describe intended settings rather than actual state. Verify visible state
  and real seat counts, and inspect screenshots. A script exit code alone is not quality evidence.

## Completion gate

Write .aaa-complete only after all quality-bar criteria have cited PASS evidence, every §23 criterion
is demonstrable in the running game, every §18 erratum has a named regression, the full suite passes,
and a separate shipping judge who touched no files fails to reject completion. No such claim is made.
STOP/.aaa-complete halt future work. RemoteTrigger is not callable in this session; disabling that
remote trigger would require an available supported tool if a stop marker is later encountered.
