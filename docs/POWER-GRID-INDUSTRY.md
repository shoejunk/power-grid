# Power Grid: Industry

Industry is an optional Power Grid rules mode selected when creating a table. Classic remains the default; existing saves without `rulesMode` retain classic rules. Industry shares auctions, maps, resource purchases, power production, networking and rendering with classic. Its economy and balance tables live in `engine/industry.ts`; facility definitions live in `data/facilities.ts`. New Industry games use version 7; classic games still use version 3. Existing version-4 Industry saves retain their separate facility offers and cash victory for deterministic replay. Version-5 saves retain one copy per facility and 1/2/3 output. Version-6 saves retain two copies per facility and 1/3/5 output. New games use the rules below.

## Rules

- Nineteen facility cards: six coal mines and six oil refineries producing 1–6, four recycling facilities producing 2–5, and three uranium mines producing 1–3 tokens per round. There is one copy of each card, and each counts toward the five-card limit. No abilities, upkeep, city placement or connection cost.
- Facilities are shuffled into the plant deck and share the current and future markets. Facilities costing 15 or less join the opening plug-backed pool; the rest join the socket-backed pool. Normal random setup removals apply to both kinds, so not every facility appears in every game. All replacement, discount, removal, burial and Step-transition rules apply equally. All 42 plants and 19 facilities have distinct printed costs, consecutively numbered 3–63. The plant order and plant backs are unchanged; facilities are interleaved among them. Cards sort by printed cost. Stable internal IDs are not prices.
- One auction purchase per round: a plant **or** a facility. In the first round, acquire either kind. Printed cost is the minimum bid, or 1 Elektro when discounted; only the winning bid is paid. The discount replacement rule compares printed costs strictly. Historical games with tied costs retain the equal-cost replacement rule.
- Own up to five plants and facilities combined. Acquiring a sixth pauses play for a scrap choice. Industry permits scrapping any of the six, including the newly acquired card. Fuel on a scrapped plant transfers normally; facilities cannot store or consume fuel.
- The opening resource market is unchanged. Subsequent free refills are reduced and depend only on player count, never Step.
- In ordinary rounds, after everyone locks their build-and-power choices, all power income is paid and fuel returned. The free baseline enters the market first, followed by automatic facility production. Resources use the finite reserve (USA coal uses its coal storage) and fill the highest-priced empty spaces first.
- Each delivered facility token earns `max(0, filled-slot price - 1)` Elektro. A shipment filling 6, 5, 5 earns 13. Undelivered output earns nothing; no negative payment. Producers of the same resource pool revenue and share it in proportion to their output. Whole-Elektro shares use largest remainders, with exact ties rotating by round using a stable player-ID ordering. This removes delivery-order advantages and handles partial shipments without creating resource tokens.
- Germany's uranium phase-out is disabled in Industry so plant 39 cannot invalidate mine investments. USA coal storage remains active. The Trust cannot be combined with Industry.
- The normal city threshold triggers the ending after all build-and-power turns. Final evaluation uses feasible supply from owned plants and stored fuel: most powered cities wins, then most cash. No power income, facility production or facility income occurs during final evaluation, and fuel is not consumed. Cash alone never triggers the ending. The normal zero-city payment of 10 remains during ordinary rounds.
- Turn order ranks connected cities first, then the highest printed cost among all owned plants and facilities. Printed cost is used even when the actual auction payment differed, and is not the sum of card values. Recalculate after the first auction round and at the start of later rounds. City slots, electricity payouts, starting money and Step transitions remain as in classic. Classic achievements are not awarded for Industry games.

## Initial balance values (provisional)

| Resource | Production tiers | Printed costs (same order) |
|---|---|---|
| Coal | 1, 2, 3, 4, 5, 6 | 9, 17, 24, 34, 44, 52 |
| Oil | 1, 2, 3, 4, 5, 6 | 12, 21, 31, 42, 53, 60 |
| Garbage | 2, 3, 4, 5 | 15, 25, 35, 45 |
| Uranium | 1, 2, 3 | 26, 39, 54 |

Plant prices fill the remaining numbers from 3–63 in their original relative order. `data/facilities.ts` defines the interleaving anchors and generates the unique price map. Classic and saved versions 4–6 keep their previous plant prices, facility catalogs and plant-only order tiebreaker.

| Players | Coal baseline | Oil baseline | Garbage baseline | Uranium baseline |
|---|---|---|---|---|
| 2 | 1 | 1 | 1 | 0 |
| 3 | 2 | 1 | 1 | 0 |
| 4 | 2 | 1 | 1 | 0 |
| 5 | 2 | 2 | 1 | 1 |
| 6 | 3 | 2 | 1 | 1 |

These numbers are starting values, not a demonstrated balance result. Watch facility payback periods, resource shortages, renewable strength and game length before tuning. Facilities support the power network economy; owning only facilities cannot produce winning city supply.

## Verification

- `npm run test -w @game/power-grid -- --pool=threads --poolOptions.threads.singleThread`
- `npm run test -w @tt/server -- power-grid-legacy-replay power-grid-industry-replay games integration table-improvements`
- `node --import tsx --conditions=development tools/verify-power-grid-classic.mjs` compares original commit `4cc87a6` against current classic states, logs, RNG and bot decisions for versions 1–3.
- `node --import tsx --conditions=development tools/verify-power-grid-classic.mjs --legacy-industry` compares complete version-4 games against released commit `a64be9b`.
- `node --import tsx --conditions=development tools/verify-power-grid-classic.mjs --industry-v5` compares complete version-5 games against released commit `f375e74`.
- `node --import tsx --conditions=development tools/verify-power-grid-classic.mjs --industry-v6` compares complete version-6 games against released commit `b9080a1`.
- `npm run build -w @tt/client -- --outDir ../../.shots/industry-client-build`
- `node tools/screenshot/industry-smoke.mjs` starts a temporary Vite server on port 5188 and uses an installed Chromium test browser (override with `BROWSER_EXE`). It exercises the actual UI and reducer with local fixtures, not live multiplayer or human gameplay. Screenshots and report go to `.shots/industry-ui/`.

The engine tests include full deterministic games at 2–6 players, city-based victory, no final income, mixed-deck setup and discount rules, mixed scrapping, exact price-slot revenue, finite reserves, full markets, proportional revenue, map exceptions and classic isolation. The server test replays complete version-4, version-5, version-6 and version-7 Industry games through the persisted audit contract. None of these proves competitive balance or human enjoyment.
