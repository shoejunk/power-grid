# Quality Bar — Dead of Winter

The stated benchmark for this game is **Wingspan on Steam** (Monster Couch) — the user's requirement is
that a reviewer doing a blind side-by-side comparison of screenshots picks *our* Dead of Winter as the
better-looking, better-laid-out product.

This document turns that into objective, checkable criteria so review is not a matter of taste.
Every critic pass must score against it and cite specific evidence (screenshots, measured values, console output).

The design spec referenced throughout is `dead-of-winter-gameplay-requirements.md`.

---

## 0. Know the benchmark honestly

Wingspan's strengths, which we must at least match:

- **Illustrated card art is the hero element.** The birds are painted, they are large, and the layout is
  built to show them off rather than to squeeze them in. Art is never decoration around a spreadsheet.
- **A warm, confident, low-saturation natural palette.** Few hues, held consistently, nothing neon,
  nothing accidental.
- **Generous whitespace and calm composition.** Panels breathe; the eye is led, not assaulted. The game
  looks unhurried even under time pressure.
- **Tactile physical components.** The dice tower, egg tokens and food dice are modelled as real objects
  and animate with weight, bounce and settle — they read as things with mass, not as sprites being moved.
- **Typographic confidence.** A serif display face for headings and card names paired with a clean sans
  for body text, used consistently and at sizes that trust the reader.
- **Motion that arcs and settles.** Cards played into the tableau travel along a curve and come to rest;
  nothing snaps into position.
- **Consistent iconography legible at card scale.** One symbol vocabulary, drawn to survive being small.
- **Unhurried, diegetic sound design.** Birdsong, wood, dice — the audio belongs to the world.

Its documented weaknesses, which we must **beat** — this is where the win is available:

- **A fairly static board.** The main play surface does very little; the life is in the cards, not the table.
- **Low information density.** Large areas of the screen carry very little state, and desktop resolutions
  are not rewarded for their extra pixels.
- **Readability problems in small text.** Reviewers repeatedly report card and log text that is hard to
  read at default sizes.
- **A tableau that outgrows its frame.** At higher bird counts players must scroll and zoom to see their
  own board, so the player's most important state is not visible at a glance.

**Our thesis:** Dead of Winter is a bleak winter-horror game, so we do **not** copy Wingspan's warm palette.
We match its *production values* — art as the hero element, tactile components, weighted motion, typographic
confidence — and express them in a desaturated, cold palette. We then beat it on the two axes where it is
weakest: **desktop information density** and **never hiding state behind scrolling**. If we match its craft
and beat its ergonomics, we win the comparison.

---

## 1. Visual — must all be true

| # | Criterion | How to check |
|---|---|---|
| V1 | No element looks like unstyled/default HTML. No browser-default buttons, selects, checkboxes, range inputs, scrollbars, dialogs, or focus outlines. | Screenshot every screen; search the DOM for `<button>`, `<select>`, `<input>`, `<dialog>` with no authored styling. |
| V2 | Card art (survivors, items, crisis, crossroads, objectives) reads as illustration with texture, grain, depth and lighting — not flat vector shapes or icon-on-a-rectangle. | Screenshot a survivor card and a crossroads card at 1920×1080 and zoom to 200%. |
| V3 | The board reads as a painted winter environment with material and atmosphere — snow, boarded windows, cold light — not coloured boxes labelled with location names. | Screenshot the full board and zoom to 200%. |
| V4 | All 5 seat colours (`ember` `#e8622c`, `frost` `#5fb3d9`, `moss` `#7ba05b`, `rust` `#b5453b`, `violet` `#9a7bc8` — `packages/games/dead-of-winter/src/descriptor.ts`) remain separable at a glance on standees, dice, hand counts and the influence order. | Screenshot a 5-player match with all seats represented; identify each seat without reading labels. |
| V5 | Those 5 colours remain separable under deuteranopia **and** protanopia **and** in greyscale. `ember`/`rust` in particular must not collapse. | Apply each simulation filter to the same screenshot; all 5 must stay distinct in all three. |
| V6 | Text contrast ≥ 4.5:1 for body, ≥ 3:1 for large text, everywhere — including card body text, the rules log, and text over artwork. | Measure computed colours against their actual backdrop; no exceptions, no "it's over an image" excuses. |
| V7 | One consistent art direction across portal → lobby → match. Same palette, same panel language, same type ramp, same icon vocabulary. | Screenshots side by side. |
| V8 | Depth is expressed through layered elevation — shadow, blur, bevel, inner light, paper/card thickness — not borders alone. | Visual inspection at 200% zoom; a 1px outline is not elevation. |
| V9 | Typography is deliberate: a display face for headings/card names paired with a clean sans for body, one type ramp, no orphaned system-font text. | Inspect computed `font-family` on every text node class; count distinct families. |
| V10 | Numerals are tabular and aligned everywhere counts appear: morale, rounds remaining, food, starvation, wounds, frostbite, dice values, hand counts, deck counts, waste count, influence, thresholds. | Watch each readout change value; digits must not shift horizontally. |
| V11 | Iconography is one consistent set and legible at card scale. The seven item symbols (weapon, fuel, education, food, medicine, tool, survivor) are individually identifiable at their smallest rendered size. | Screenshot a hand at 1920×1080 and name every symbol without zooming. |
| V12 | No layout shift, no flash of unstyled content, no visible pop-in on load or on phase transition. | Record page load and a full round; watch for reflow. |
| V13 | Renders correctly at 1280×720, 1366×768, 1920×1080, 2560×1440 and 3840×2160 with no clipping, overlap, or scrollbars where none are intended. Art must not look upscaled at 4K. | Resize and screenshot each. |
| V14 | **Density beats the benchmark.** At 1920×1080 a player can see, simultaneously and without scrolling or opening a menu: the colony (morale, rounds, food, starvation, waste, entrances/barricades), all six non-colony locations, their own survivors, their unused and used dice, their hand, the active crisis, and whose turn it is. | A **single** unedited screenshot must contain all nine. Anything reachable only by scroll or menu is a FAIL. |
| V15 | Nothing important is hidden behind scrolling at any supported resolution — the benchmark's tableau failure must not be reproduced. Growing survivor counts, growing hands and growing zombie counts must reflow, scale or compact rather than overflow. | Force a worst case (5 players, many survivors, full hands, crowded locations) and screenshot at 1366×768. |

## 2. Motion and game feel

| # | Criterion |
|---|---|
| M1 | Every state change is animated — no hard cuts. Phase and step changes, turn passing, first-player token passing, die spend, card draw, card play, zombie placement, morale change, token gain/loss. |
| M2 | Animations use spring/eased curves, never linear. Routine feedback resolves in under 400 ms; only the deliberate weighted moments in M4 may exceed it. |
| M3 | Hover, press, focus, disabled and loading states exist for every interactive element and are visually distinct from one another. |
| M4 | The moments that matter in **this** game land with real weight: an action die landing and settling on its face; an exposure roll resolving (blank vs wound vs frostbite vs bitten must feel different); a bite spreading down the influence order survivor by survivor; a barricade breaking; an entrance overrun and its casualty; morale dropping; a crossroads card flipping face up; exile passing. |
| M5 | Dice and tokens animate as objects with mass — they arc, tumble, settle and cast shadow. This is the benchmark's signature strength and must be matched or exceeded. |
| M6 | Automatic sequences are paced so a human can follow them. Add Zombies places one zombie at a time, entrance by entrance, at a readable cadence; the bite chain resolves one survivor at a time. Neither may resolve in a single frame. |
| M7 | `prefers-reduced-motion` is respected — animation reduces to opacity fades, all M6 sequences remain step-by-step and legible, and the game stays fully playable with no information conveyed by motion alone. |
| M8 | Sustained 60 fps during board pan/zoom, dice rolls, zombie placement sequences and card animations, with 5 seats populated. |
| M9 | Sound design is diegetic and unhurried, matching the world: wind, snow, wood, bone, dice. Every mechanical event has an audio counterpart, and audio is mutable without breaking pacing. |

## 3. UX / ergonomics — where we beat the benchmark

| # | Criterion |
|---|---|
| U1 | The current chooser and the exact phase **and step** are always visible — Player Turns vs Colony Phase, and which of the seven colony-phase steps (spec §5.2) is resolving. Never "something is happening". |
| U2 | Illegal actions are *impossible*, not merely rejected — disabled with a tooltip citing the rule that forbids them (spec §21 "Show legal die assignments and why a die/action is illegal"). |
| U3 | Costs and die requirements are previewed before commitment: which unused die satisfies which threshold (attack, search, ability), what a food token would raise it to, and what the action will consume. Hovering an action shows its full requirement before it is taken. |
| U4 | Nothing is sized for touch on desktop. Controls are desktop-proportioned; pointer targets ≥ 32 px but never cartoonish. |
| U5 | **Hidden information is unambiguous.** The UI must make it obvious at a glance what is private to you (your hand identities, your secret objective, your search results, an untriggered crossroads card you hold) and what the table can see (hand *counts*, deck counts, crisis contribution *counts*, face-up main-objective contributions). Private and public zones must be visually distinct by treatment, not just by label (spec §3). |
| U6 | Full keyboard navigation with visible focus. Escape closes modals, Enter confirms, focus is trapped in dialogs and returned on close. |
| U7 | Every automatic transition is explained in a human-readable log: each zombie placement and its entrance, each barricade destroyed, each overrun and its casualty, each morale change and its cause, crisis scoring, food/starvation, waste. The log must never leak hidden card identities (spec §3, §22). |
| U8 | The direction of play is unambiguous: turns pass left/clockwise while the first-player token passes right at round end (spec §15). Both must be shown, not inferred. |
| U9 | A rules reference is reachable at all times, and every phase/step panel states its own rule in plain language. New players can learn the game from the interface. |
| U10 | Every pause point is explicit and attributed: casualty choice, bite decision, crossroads option, first-player ordering choice, objective contribution, vote. The table always knows who it is waiting for. |
| U11 | Reconnection is invisible in the good case and clearly communicated in the bad case. Never a blank screen, never a silent desync. |
| U12 | The UI never offers a "show objective" action, and the no-reveal rule reminder is visible near the objective and chat controls (spec §3). |
| U13 | Board topology and capacity are legible unaided: entrance spaces, barricades, survivor-space capacity and noise spaces are countable by looking, without opening a panel or counting overlapping standees. |

## 4. Gameplay conformance

Binary, no partial credit. Every rule in `dead-of-winter-gameplay-requirements.md` §2–§20 is implemented exactly.
The critic must verify against the **running game**, not against source code alone.

### 4.1 The §23 acceptance criteria — tick individually

| # | Acceptance criterion (§23) | Status |
|---|---|---|
| A1 | A standard game can be set up for every supported player count with the correct objective, betrayal probability, starting hand, survivors, colony placement, and first player. | |
| A2 | Cooperative, two-player, betrayer, hardcore, player-elimination, and Prisoner's Dilemma setup changes are isolated and reproducible. | |
| A3 | Dice are group resources, new survivors do not grant mid-round dice, and frostbite deaths occur after dice are rolled but before that player's actions. | |
| A4 | Every die and no-die action enforces thresholds, locations, capacities, move limits, exile restrictions, and card timing. | |
| A5 | Search privacy/noise, crisis secrecy/scoring, waste ordering, food/starvation persistence, and objective contribution visibility work exactly as specified. | |
| A6 | Zombie attacks, survivor attacks, kill-versus-remove semantics, exposure, frostbite, bite chains, and last-survivor replacement pass deterministic tests. | |
| A7 | Colony entrance cycling, barricade destruction, overruns, casualty choice, non-colony placement, and noise-generated zombies resolve in the correct order. | |
| A8 | Morale-zero termination is immediate except at the three defined Add Zombies checkpoints. | |
| A9 | Crossroads cards are drawn by the right-hand player, trigger only for the active player after a triggering action fully resolves, and preserve option legality. | |
| A10 | Exile relocation, exposure, no-space swapping, objective adjustment, action restrictions, allowed interactions, and the two-non-betrayer-exiles loss condition all work. | |
| A11 | Card effects cannot interrupt active effects, card text overrides only conflicting general rules, and once-per-round state survives item transfers. | |
| A12 | Main-objective completion is checked only at the correct phase boundary, while morale and round failures suppress a final objective check. | |
| A13 | Winner evaluation supports multiple winners and an all-lose result without exposing hidden objectives before required. | |
| A14 | All named errata and card rulings in §18 have targeted regression tests. | |
| A15 | Reconnection and replay preserve authorized hidden information and reproduce every random result. | |

### 4.2 Errata coverage

Every named erratum and card ruling in spec §18 must be covered by a **named regression test**, and the critic
must be able to point at the test for each one: §18.1 errata (Loretta Clay `4+`, `Old Divisions` trigger,
Attract moving fewer than two zombies, optional omission of the betrayal objective); §18.2 objectives
(`Stockpile`, `We Need More Samples` sample-before-exposure and the introductory scenario values,
`Raiding Party` + `Bev Russell`, `Hunger`, `Hoarder`, non-starter requirements, colony-phase completion timing);
§18.3 survivors (Edward White, John Price in all five of his listed rulings, mid-turn survivor additions,
orphan-standee reconciliation); §18.4 crossroads (movement-before-trigger, `Bev Russell`, `Old Divisions`
thumbs-up, `Outbreak` electorate, `This Taste Funny`, read-all-options); §18.5 items (EVENT/OUTSIDER still items,
duplicate equips, Baseball Bat two exposure rolls, Megaphone under Attract rules, Switchblade, once-per-round
persistence). A ruling with no test is a FAIL for section 4 regardless of whether the behaviour happens to be correct.

## 5. Multiplayer conformance

| # | Criterion |
|---|---|
| N1 | One player hosts; the server mints a shareable game code; others join with it. |
| N2 | State is server-authoritative. A tampered client cannot make an illegal move, cannot read another player's hand, objective or search results, and cannot forge a vote. |
| N3 | A player who closes the tab and returns resumes their exact seat, hand, survivors, equipped items, dice pools, secret objective, exile status and turn position. |
| N4 | The game survives a **full server restart** with no loss of state, including pending choices, the effect stack and the deferred morale checkpoint. |
| N5 | A disconnected player may pause the game indefinitely without losing their seat or state. |
| N6 | Hidden information survives reconnection **without leaking**: the reconnecting player gets their private state back; no other player, replacement or spectator ever receives it (spec §21). |
| N7 | Simultaneous votes commit before reveal. No player can see another's vote before committing, and no vote can change after reveal (spec §8.8, §15). |
| N8 | Three or more real browser clients can play a full game end to end, including at least one exile, one bite chain, one overrun and a game-end winner evaluation. |

---

## Scoring

Each critic pass reports, per section, one of:

- **PASS** — every criterion met, with cited evidence (screenshot, measured value, log excerpt, test name).
- **FAIL** — lists each failing criterion, the evidence, and the specific fix required.

A critic that cannot produce evidence for a criterion must record **FAIL**, not a pass by default.
"Probably fine", "looks right" and "not checked" are all FAIL.

The loop does not terminate while any section is FAIL.

### The blind comparison

The final gate. The critic assembles a screenshot of this game and a screenshot of Wingspan on Steam,
strips identifying marks, and judges which is the more polished product on: art quality, layout confidence,
typography, colour discipline, iconographic clarity, information density, and desktop-appropriateness.
It must state a winner and justify it criterion by criterion. If it does not pick this game, the loop continues.
