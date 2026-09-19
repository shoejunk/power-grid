# Power Grid improvements — September 18, 2026

## Handoff and commit policy

Work is being implemented in stages on `master`. Each implementation commit updates this file with completed scope and verification. Look up the commit by its stage message with `git log --oneline`; subsequent stages record earlier hashes. Do not commit `.env` or credentials. Preserve existing saved games and unrelated Dead of Winter behavior. No production deployment is included in this request.

## Stages

- [x] Stage 0 — document requested scope before implementation (`docs: track Power Grid improvements and handoff`).
- [x] Stage 1 — rules and board: clearer starting cities; zones 2/3/4/5/6 players = 3/3/4/5/5; investigate and fix hybrid resource storage; successful resource purchase ends the player's resource turn (retain skipping without a purchase).
- [x] Stage 2 — lobby and navigation: immediate readiness, remove ready toggle; remove turn notifications; invite code takes precedence over existing session; creator-defined game names, including mid-game rename and invite-code fallback in game lists.
- [x] Stage 3 — Jev bot: separate ADD JEV option, server-only .env configuration, legal move choices and bounded bidding, validated responses and safe fallback. Official TypeSafe API verified.
- [x] Stage 4 — account achievements: persistent awards, own/other-player viewing, win without ever scrapping a plant, eligibility only with at least two humans, idempotent awarding and saved-game compatibility.
- [x] Stage 5 — integrated verification and final handoff; record commits, checks, limitations, and any remaining configuration.

## Verification and open questions

- Initial checkout: clean `master`, tracking `origin/master`.
- Use focused engine/server regression tests for rules, permissions, invite routing, and account persistence, then workspace typecheck/build and relevant test suites.
- Jev uses the official TypeSafe endpoint and server-only JEV_API_KEY (or TYPESAFE_API_KEY); live access remains untested until a key is configured.
- Push staged commits to the existing remote so another agent can pull the handoff. Do not deploy or alter production data.

## Completed commits

- Stage 0: this document (commit identified by the stage message above).

- Stage 0 committed as e627341.
- Stage 1: gold starting-city markers, corrected zones, basket-aware shared hybrid capacity controls, and buy-and-finish resource turns. Engine suite: 233/233 passed, including complete bot games. Client typecheck passed. Full workspace typecheck encounters pre-existing EPERM writing generated Dead of Winter/server outputs; source validation will use isolated outputs in the final stage.


- Stage 1 committed/pushed: 66c7c77.
- Stage 2: automatic readiness (legacy unready requests ignored), turn-alert UI/delivery/subscriptions disabled, invite routing precedence, and persisted host-only game names at creation/lobby/mid-game. Existing audit streams retain version-1 rules; new games use version 2. Server suite 71/71 and client/server source typechecks passed; targeted name/restart and invite tests added.

- Stage 2 committed/pushed: 4d3dd2d. Targeted name/restart test and all three socket-storage tests pass.
- Stage 3: Add Jev, persisted bot kind, official TypeSafe Choice integration, validated legal move baskets and bid ranges, timeout/local fallback, stale-response rejection, and root .env loading. Provider docs verified at docs.typesafe.ai. See docs/jev.md and .env.example. No API key or live paid test used.

- Stage 3 committed/pushed: b0c2718. Three provider-contract tests, complete-game legal-choice/privacy test, and 233 engine regressions passed.
- Stage 4: account-owned achievement storage in SQLite, JSON and memory; own/other-player profile browser; first finish, first win, and Built to Last (win without scrapping). Requires two original humans still human at completion; same-account duplicate seats do not count twice. Anonymous humans count and may claim awards by linking a retained audited game. Six tests cover persistence, idempotency, scrapping, eligibility and public-profile privacy.


- Stage 4 committed/pushed: c1dcc2b.
- Stage 5: added version-1/version-2 audited replay regressions; the new explicit buyResourcesAndFinish action gives existing games the one-click purchase flow while old audited buyResources actions retain their historical behavior. Invite resumes reuse a matching anonymous seat token. Anonymous game lists refresh renamed titles. Tightened Jev response parsing and achievement empty states.
- Stage 5 commit: `fix: finish Power Grid compatibility checks and handoff` (find its hash with `git log --oneline`; this document is included in that commit).

## Final verification

- Full suites passed: Power Grid 235/235, server 83/83, client 6/6 (324 total). Includes complete bot games, Jev legal-choice/privacy checks, account achievement persistence/privacy, host-only naming, invite token routing, saved-game replay, and existing Dead of Winter server regressions.
- Core and Power Grid builds passed. Client typecheck, server compilation into `.shots/server-build`, and Vite production client build into `.shots/client-build` passed. The ordinary workspace build/typecheck is blocked by pre-existing EPERM locks on generated Dead of Winter/server outputs; isolated outputs avoid altering these files.
- Local browser verification with an isolated memory server: immediate-ready lobby, Add Jev missing-key error, named game creation, mid-game rename reflected in My Games, visible solid gold starting-city markers, achievement browser, and an invite to a second lobby while an unrelated saved match was active. Reloading the invite preserved one seat. No production data or paid provider calls were used.
- Hybrid investigation: authoritative shared-capacity validation already rejected overflow. The client previously offered independently sized coal/oil selections; limits now consider the entire basket and shared hybrid storage. Mixed-resource/existing-stock regression coverage passes.

## Remaining operational steps

- No requested implementation remains. All stages are committed and pushed to `origin/master`.
- Set `JEV_API_KEY` in repository-root `.env` and restart the server to enable Add Jev. See `docs/jev.md`. Live provider authentication and playing strength have not been verified; invalid responses/timeouts fall back to the local strategist.
- Deployment was not requested and has not been performed. A future release should follow the saved-game backup/replay checks before production cutover.
- New games use the restored zone counts. Existing games retain their original zone/rules version for audit compatibility. Existing audited games can earn achievements when eligibility is provable; legacy snapshots without a starting roster cannot establish eligibility. Awards require an account, though eligible anonymous players can link a retained game later.

## Authorized deployment completed — September 19, 2026 UTC

This section supersedes the earlier pending-key/not-deployed notes. The user supplied the local key and authorized production deployment while preserving active games.

- Deployed application commit: `5184de8714bb940a8a65c4a8cf9f25e992eb9abe`; `origin/release` points to it. This deployment-record-only commit on `master` adds no application changes and needs no server restart.
- Complete production build passed in `/opt/power-grid/releases/5184de8`. All six production game histories replayed against a SQLite copy. Only volatile connection/last-seen metadata differed from snapshots; durable game state and audited checkpoints matched. The copied server restored all six games, 22 seats and nine sessions.
- Transferred only the Jev key over SSH into root-owned mode-600 `/etc/power-grid/jev.env`, loaded via `/etc/systemd/system/power-grid.service.d/jev.conf`. Verified the running process has the key without printing it. Never place this file or its contents in Git. Keep this systemd configuration on future releases.
- One synthetic-state live provider request returned HTTP 200 and a valid `nominatePlant` action in 636 ms. No real player state was sent for validation.
- Final quiesced backup: `/var/lib/power-grid/backups/pre-5184de8-20260919T004456Z.db`. Prior release `/opt/power-grid/releases/5a03409` retained for rollback. Atomically switched the symlink and restarted only `power-grid`; startup replay took about 29 seconds, causing a brief reconnect window.
- Pre/post counts matched exactly: six games (all started), 22 seats, nine game sessions, two accounts, 46 auth sessions, 898 audit events. Verified all game/session/account identities survived and SQLite integrity was `ok`.
- Public HTTPS 200, HTTP 301, secure WebSocket connection, localhost-only listener and exact release marker passed. Live browser showed the new achievement browser and existing account profiles. No live game was created, modified or deleted during verification.
- No deployment steps remain. Subsequent play-quality monitoring for Jev is optional; provider failures retain the safe local fallback.

## Saved-game turns and sticky rules log — September 19, 2026 UTC

- Your Games marks the current player's turn from authoritative game state for account and local saved games. The visible portal refreshes every five seconds and on tab focus/return, with no account-loading flicker.
- The Power Grid rules log initially follows the bottom, stops when manually scrolled up, and resumes following when scrolled back to the bottom. Updates still follow after reaching the 120-entry display cap.
- Verified 84 server tests and eight client tests; client typecheck and server no-output typecheck passed. Production client build passed in a fresh output directory. A local Chromium component fixture passed initial scrolling, large batches at the display cap, manual scroll-up, and sticky resume.
- The user authorized committing all pending changes, pushing master/release, and deploying with existing games preserved. Production cutover follows a full inactive build, copied-database replay, and fresh backup with pre/post identity and count checks.
