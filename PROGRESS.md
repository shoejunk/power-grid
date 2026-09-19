# Power Grid improvements — September 18, 2026

## Handoff and commit policy

Work is being implemented in stages on `master`. Each implementation commit updates this file with completed scope and verification. Look up the commit by its stage message with `git log --oneline`; subsequent stages record earlier hashes. Do not commit `.env` or credentials. Preserve existing saved games and unrelated Dead of Winter behavior. No production deployment is included in this request.

## Stages

- [x] Stage 0 — document requested scope before implementation (`docs: track Power Grid improvements and handoff`).
- [x] Stage 1 — rules and board: clearer starting cities; zones 2/3/4/5/6 players = 3/3/4/5/5; investigate and fix hybrid resource storage; successful resource purchase ends the player's resource turn (retain skipping without a purchase).
- [x] Stage 2 — lobby and navigation: immediate readiness, remove ready toggle; remove turn notifications; invite code takes precedence over existing session; creator-defined game names, including mid-game rename and invite-code fallback in game lists.
- [ ] Stage 3 — Jev bot: separate ADD JEV option, server-only .env configuration, legal move choices and bounded bidding, validated responses and safe fallback. Awaiting the user's identification of Jev API/documentation.
- [ ] Stage 4 — account achievements: persistent awards, own/other-player viewing, win without ever scrapping a plant, eligibility only with at least two humans, idempotent awarding and saved-game compatibility.
- [ ] Stage 5 — integrated verification and final handoff; record commits, checks, limitations, and any remaining configuration.

## Verification and open questions

- Initial checkout: clean `master`, tracking `origin/master`.
- Use focused engine/server regression tests for rules, permissions, invite routing, and account persistence, then workspace typecheck/build and relevant test suites.
- Jev provider details are not established yet. Do not invent a provider endpoint or expose its key to the client.
- Push staged commits to the existing remote so another agent can pull the handoff. Do not deploy or alter production data.

## Completed commits

- Stage 0: this document (commit identified by the stage message above).

- Stage 0 committed as e627341.
- Stage 1: gold starting-city markers, corrected zones, basket-aware shared hybrid capacity controls, and buy-and-finish resource turns. Engine suite: 233/233 passed, including complete bot games. Client typecheck passed. Full workspace typecheck encounters pre-existing EPERM writing generated Dead of Winter/server outputs; source validation will use isolated outputs in the final stage.


- Stage 1 committed/pushed: 66c7c77.
- Stage 2: automatic readiness (legacy unready requests ignored), turn-alert UI/delivery/subscriptions disabled, invite routing precedence, and persisted host-only game names at creation/lobby/mid-game. Existing audit streams retain version-1 rules; new games use version 2. Server suite 71/71 and client/server source typechecks passed; targeted name/restart and invite tests added.
