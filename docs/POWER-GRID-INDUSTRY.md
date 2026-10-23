# Power Grid: Industry

Industry is an optional Power Grid rules mode selected when creating a table. Classic remains the default; existing saves without `rulesMode` retain classic rules. Industry shares auctions, maps, resource purchases, power production, networking and rendering with classic. Its economy and balance tables live in `engine/industry.ts`; facility definitions live in `data/facilities.ts`. New Industry saves use version 4, while new classic games still use version 3. Future incompatible Industry changes must preserve version-4 replay behavior.

## Rules

- Twelve facility cards: small, medium and large for coal, oil, garbage and uranium. Each makes one resource type, at 1, 2 or 3 tokens per round. No abilities, upkeep, city placement or connection cost.
- Four public facility offers sit beside the plant market. Each starts small; buying it reveals the medium, then large facility of that resource. An acquired or scrapped facility never returns. Plant deck and discount rules do not affect facilities.
- One auction purchase per round: a plant **or** a facility. In the first round, acquire either kind. Printed facility cost is the minimum bid; only the winning bid is paid.
- Own up to five plants and facilities combined. Acquiring a sixth pauses play for a scrap choice. Industry permits scrapping any of the six, including the newly acquired card. Fuel on a scrapped plant transfers normally; facilities cannot store or consume fuel.
- The opening resource market is unchanged. Subsequent free refills are reduced and depend only on player count, never Step.
- After everyone locks their build-and-power choices, all power income is paid and fuel returned. The free baseline enters the market first, followed by automatic facility production. Resources use the finite reserve (USA coal uses its coal storage) and fill the highest-priced empty spaces first.
- Each delivered facility token earns `max(0, filled-slot price - 1)` Elektro. A shipment filling 6, 5, 5 earns 13. Undelivered output earns nothing; no negative payment. Producers of the same resource pool revenue and share it in proportion to their output. Whole-Elektro shares use largest remainders, with exact ties rotating by round using a stable player-ID ordering. This removes delivery-order advantages and handles partial shipments without creating resource tokens.
- Germany's uranium phase-out is disabled in Industry so plant 39 cannot invalidate mine investments. USA coal storage remains active. The Trust cannot be combined with Industry.
- At the end of settlement, if anyone has at least the cash target, the game ends. Everyone receives both final-round income streams before comparison. Most cash wins; cash ties share victory. Cities do not end the game. The normal zero-city payment of 10 remains.
- Turn ordering, city slots, electricity payout table, starting money, and plant/Step transitions remain as in classic. Facilities do not count as plants for city-order ties. Classic achievements are not awarded for Industry games.

## Initial balance values (provisional)

| Resource | Small cost / output | Medium cost / output | Large cost / output |
|---|---|---|---|
| Coal | 8 / 1 | 18 / 2 | 30 / 3 |
| Oil | 10 / 1 | 22 / 2 | 36 / 3 |
| Garbage | 12 / 1 | 24 / 2 | 40 / 3 |
| Uranium | 18 / 1 | 36 / 2 | 54 / 3 |

| Players | Coal baseline | Oil baseline | Garbage baseline | Uranium baseline | Default cash target |
|---|---|---|---|---|---|
| 2 | 1 | 1 | 1 | 0 | 250 |
| 3 | 2 | 1 | 1 | 0 | 250 |
| 4 | 2 | 1 | 1 | 0 | 250 |
| 5 | 2 | 2 | 1 | 1 | 250 |
| 6 | 3 | 2 | 1 | 1 | 250 |

The target has a separate entry per player count for later tuning. The host can override it in setup. These numbers are starting values, not a demonstrated balance result. Watch facility payback periods, idle subsidies, resource shortages, renewable strength, game length, and the frequency of supplier-only wins before tuning.

## Verification

- `npm run test -w @game/power-grid -- --pool=threads --poolOptions.threads.singleThread`
- `npm run test -w @tt/server -- power-grid-legacy-replay power-grid-industry-replay games integration table-improvements`
- `node --import tsx --conditions=development tools/verify-power-grid-classic.mjs` compares original commit `4cc87a6` against current classic states, logs, RNG and bot decisions for versions 1–3.
- `npm run build -w @tt/client -- --outDir ../../.shots/industry-client-build`
- `node tools/screenshot/industry-smoke.mjs` starts a temporary Vite server on port 5188 and uses an installed Chromium test browser (override with `BROWSER_EXE`). It exercises the actual UI and reducer with local fixtures, not live multiplayer or human gameplay. Screenshots and report go to `.shots/industry-ui/`.

The engine tests include full deterministic games at 2–6 players, final-round payments, supplier victory, mixed scrapping, exact price-slot revenue, finite reserves, full markets, proportional revenue, map exceptions and classic isolation. The server test replays a complete Industry game through the persisted audit contract. None of these proves competitive balance or human enjoyment.
