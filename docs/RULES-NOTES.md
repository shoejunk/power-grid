# Rules notes: verified data, known divergences, open questions

The spec (`power-grid-gameplay-requirements.md`) is the authority for this implementation. Where an outside
source disagrees with it, we follow the spec and record the disagreement here.

Reviewers and critic agents should read this before filing a rules bug — the entries below are **deliberate**.

---

## Verified against the rulebook

Audited against the local `power-grid-rules.pdf` plus independent secondary sources.

- **Payment table** — all 21 entries read digit-by-digit off the payment card illustration (p. 6, which appears
  twice on the page; both renderings agree).
- **Market layout** — prices, capacity, totals and initial occupancy (p. 2). The p. 7 worked example only
  reconciles with capacity 3 per space and these exact starting spaces; notably it places garbage on spaces 6
  and 5, which rules out the older 7–8 garbage start.
- **Uranium price ladder** `[1..8, 10, 12, 14, 16]` — confirmed by the same worked example (refill lands on 12
  then 10).
- **All 42 power plants** — resource type, fuel and city count, plus the plug/socket split at 03–15 vs 16–50
  (p. 3: cards "with a plug on the back (numbered '03' to '15')").
- **Setup removals**, **zone sizes**, **Step 2 thresholds**, **end-game thresholds**, **slot costs**, starting
  money, house counts, Trust house count, USA coal price.

### Corrected during the audit

`REFILL_TABLE.usa` coal column, all 15 values (Steps 1–3 × player counts 2–6), was wrong — it had been written
from memory as USA-specific values one higher than Germany's. **The USA map does not have its own refill
values.** Setup step 7 (p. 3) says each refill summary card "shows the resource refill values for both maps",
and the card illustration carries a single 4×3 table. The USA's only resource-side difference is the separate
coal storage (§12). Corroborated by three independent implementations, all of which use one refill table for
both maps.

---

## Known divergences from outside sources — we follow the spec

### 1. Two-player refill in *Against the Trust*

- **Spec §9.2:** "Use the refill summary for the current player count, map, and Step." No Trust override.
- **Official 2015 Trust rules:** "The players re-supply the resource market according to 3 players."

We use the 2-player column, per the spec. This is the one place where a rules-accuracy reviewer is most likely
to disagree with the implementation, so it is called out explicitly. The local rulebook's Trust section
(pp. 9–10) contains no re-supply sentence either way, and no image of the printed 2-player refill card could be
obtained, so the printed values remain unconfirmed.

**If this is ever changed**, it is a one-line change in `refillFor()` — gate on
`settings.againstTheTrust` and read the 3-player row.

### 2. German nuclear phase-out plant number

One published data set gives the trigger as plant **37**. Both the local rulebook (p. 7) and the spec (§9.2,
§12) give plant **39**. We use **39**.

### 3. No metropolis pairs on either base map

Neither the Germany nor the USA board has metropolis city pairs — validation found zero `metropolisPartner`
entries on both. The `metropolisPartner` field and the §8 metropolis restriction are still implemented, because
the spec requires the rule and the type supports it, but **no shipped map data exercises that code path**.
Any future map with metropolises must be tested deliberately.

---

## Map data provenance

Both maps were transcribed and then diffed against **six independent open-source transcriptions each**. City
names and area partitions match across all six on both maps. Connection topology and costs match across all
sources except a handful of outliers, each resolved by majority plus a rules-text check:

| Map | Disputed value | Resolution |
| --- | --- | --- |
| Germany | Erfurt–Fulda | **13** (one source said 15; 5-to-1) |
| Germany | Wiesbaden–Frankfurt-M | **0** (one source omitted it) |
| USA | Jacksonville–Tampa | **4** (one source said 5) |
| USA | Boise–Cheyenne | **24**, confirmed by BGG thread 115823, which also confirms the endpoint is Cheyenne, not Denver |

The published worked example ("no connecting costs between Duisburg and Essen"; Aachen for 10+9+2 via
Düsseldorf; Münster–Dortmund 2) matches the shipped data exactly.

Zero-cost edges are real and intentional: Essen–Duisburg, Halle–Leipzig, Wiesbaden–Frankfurt-M (Germany);
Cheyenne–Denver, New York–Philadelphia, Savannah–Jacksonville (USA). Spec §1 explicitly permits cost 0.

Caveats:

- **No photographic verification** — BGG blocks automated fetching, so this is 6-way agreement between
  transcriptions, not a reading of the cardboard.
- **Area names and colours are ours.** The printed board labels its six areas by colour only, and sources
  disagree on what to call each colour. Treat `name`/`color` as cosmetic.
- **`x`/`y` are real WGS84 coordinates**, latitude-corrected and relaxed for minimum separation — geographically
  faithful, but they will not pixel-match the board's stylised layout.
- `adjacentAreas` is derived mechanically from `connections`, not hand-written. One consulted source ships a
  hand-written region table that is simply wrong (it omits Southwest–South on the USA map); deriving avoids
  that class of error.

## Unverified — honest gaps

These are values the implementation depends on that could not be confirmed from a primary source. They are
corroborated by multiple independent secondary sources that agree with each other, which is strong evidence but
is not the printed component.

1. **Refill values for player counts 2, 3, 4 and 6.** Only the 5-player card is legible in the PDF. The other
   four rows rest on three secondary sources.
2. **No source physically shows a USA refill card.** The "USA == Germany" conclusion rests on the rulebook's
   "for both maps" wording, the single-table card illustration, and three implementations — not on a scan.
3. **33 of 42 power plant cards** are confirmed only by two independent open-source implementations, which
   agree with each other perfectly. The nine cards named in rulebook examples have primary-source backing.
4. **BoardGameGeek was unreachable** during the audit (API "Unauthorized", web pages Cloudflare 403), so the
   canonical community reference threads and file downloads could not be consulted. Those would be the most
   direct confirmation of items 1–3 and should be the first stop if any of this data is ever questioned.
