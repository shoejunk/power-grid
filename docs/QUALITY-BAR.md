# Quality Bar

The stated benchmark for this project is **Risk: Global Domination** (SMG Studio) — the user's requirement is
that a reviewer doing a blind side-by-side comparison picks *this* game as the better-looking one.

This document turns that into objective, checkable criteria so review is not a matter of taste.
Every critic pass must score against it and cite specific evidence (screenshots, measured values, console output).

---

## 0. Know the benchmark honestly

Risk: Global Domination's strengths, which we must at least match:

- A **painted, illustrative board** with real texture and depth — never flat vector fills.
- **Strong faction colour identity**, readable at a glance across a busy board.
- **Confident, chunky typography** and clear numeric readouts.
- **Constant motion**: units animate, territories pulse, transitions never cut hard.
- **Consistent art direction** across menu, lobby, and match — one world, not three.
- A soundtrack of multiple themes plus dense UI SFX.

Its documented weaknesses, which we must **beat** — this is where the win is available:

- It is widely criticised as **a mobile port**: oversized touch-sized buttons, wasted screen real estate at
  desktop resolutions, and controls that reviewers call "weirdly placed and unintuitive".
- Information density is low; desktop users get a phone layout on a 27" monitor.
- Map legibility problems severe enough that a "Territory Connection Overlay" had to be bolted on.

**Our thesis:** desktop-native layout, higher information density with no loss of clarity, and a board whose
topology is legible without needing an overlay. If we match its art quality and beat its ergonomics, we win
the comparison.

---

## 1. Visual — must all be true

| # | Criterion | How to check |
|---|---|---|
| V1 | No element looks like unstyled/default HTML. No browser-default buttons, selects, checkboxes, scrollbars, or focus outlines. | Screenshot every screen; search the DOM for unstyled `<button>`, `<select>`, `<input>`. |
| V2 | The board reads as painted artwork with texture, depth and lighting — not flat fills. | Screenshot the board at 1920×1080 and zoom to 200%. |
| V3 | Every one of the 6 player colours is distinguishable at a glance on the board, including for deuteranopia and protanopia. | Screenshot with a colour-blindness filter applied; all 6 must remain separable. |
| V4 | Text contrast ≥ 4.5:1 for body, ≥ 3:1 for large text, everywhere. | Measure computed colours; no exceptions. |
| V5 | Consistent art direction across menu → lobby → match. Same palette, same panel language, same type. | Screenshots side by side. |
| V6 | Depth is expressed through layered elevation (shadow, blur, bevel, glow), not borders alone. | Visual inspection at 200% zoom. |
| V7 | Numerals are tabular and aligned everywhere money, costs, and counts appear. | Inspect the money HUD as values change. |
| V8 | No layout shift, no flash of unstyled content, no visible pop-in on load. | Record page load; watch for reflow. |
| V9 | Renders correctly at 1280×720, 1366×768, 1920×1080, 2560×1440 and 3840×2160 with no clipping, overlap, or scrollbars where none are intended. | Resize and screenshot each. |
| V10 | Density beats the benchmark: at 1920×1080 the player can see board, their assets, the markets, and whose turn it is **without scrolling or opening a menu**. | Single screenshot must contain all four. |

## 2. Motion and game feel

| # | Criterion |
|---|---|
| M1 | Every state change is animated — no hard cuts. Phase changes, turn passes, money changes, market moves, house placement. |
| M2 | Animations use spring/eased curves, not linear. Nothing takes longer than 400 ms for routine feedback. |
| M3 | Hover, press, focus, disabled and loading states exist for every interactive element and are visually distinct. |
| M4 | Key moments land with weight: winning an auction, powering cities, triggering a Step change, game end. |
| M5 | `prefers-reduced-motion` is respected — animation reduces to opacity fades, and the game stays fully playable. |
| M6 | Sustained 60 fps on the board during pan, zoom and animation. |

## 3. UX / ergonomics — where we beat the benchmark

| # | Criterion |
|---|---|
| U1 | The current player always knows: whose turn it is, what phase it is, what they are being asked to do, and what it will cost. Visible without hunting. |
| U2 | Illegal actions are *impossible*, not merely rejected — disabled with a tooltip stating the rule that forbids them (spec §14 "Legal-action validation"). |
| U3 | Costs are previewed before commitment. Hovering a city shows the full route cost + slot cost breakdown before you buy. |
| U4 | Nothing is sized for touch on desktop. Controls are desktop-proportioned; pointer targets ≥ 32 px but not cartoonish. |
| U5 | Board topology is legible unaided — connection costs always readable, no overlay needed to understand who connects to what. |
| U6 | Full keyboard navigation with visible focus. Escape closes modals. Enter confirms. |
| U7 | Every automatic transition is explained in a human-readable rules log (spec §14 "Determinism and auditability"). |
| U8 | New players can learn from the interface: a rules reference is reachable at all times, and phase panels state their own rules. |
| U9 | Reconnection is invisible in the good case and clearly communicated in the bad case. Never a blank screen. |

## 4. Gameplay conformance

Binary, no partial credit. Every rule in `power-grid-gameplay-requirements.md` §1–§13 is implemented exactly, and
all nine acceptance criteria in §15 are demonstrable. The critic must verify these against the running game,
not against the source code alone.

## 5. Multiplayer conformance

| # | Criterion |
|---|---|
| N1 | One player hosts; the server mints a shareable game code; others join with it. |
| N2 | State is server-authoritative. A tampered client cannot make an illegal move. |
| N3 | A player who closes the tab and returns resumes their exact seat, money, plants, houses and turn position. |
| N4 | The game survives a **full server restart** with no loss of state. |
| N5 | A disconnected player may pause the game indefinitely without losing their seat or state. |
| N6 | Two real browser clients can play a full game against each other end to end. |

---

## Scoring

Each critic pass reports, per section, one of:

- **PASS** — every criterion met, with cited evidence.
- **FAIL** — lists each failing criterion, the evidence, and the specific fix required.

The loop does not terminate while any section is FAIL. A critic that cannot produce
evidence for a criterion must treat it as FAIL, not as a pass by default.

### The blind comparison

The final gate. The critic assembles a screenshot of this game and a screenshot of Risk: Global Domination,
strips identifying marks, and judges which is the more polished product on: art quality, layout confidence,
typography, colour discipline, information density, and desktop-appropriateness. It must state a winner and
justify it criterion by criterion. If it does not pick this game, the loop continues.
