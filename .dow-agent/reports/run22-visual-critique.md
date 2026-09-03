# Run 22 — Adversarial Visual Critique, Dead of Winter

**Evidence:** `/home/user/power-grid/.shots/run22/` (5 screenshots, 4-player live match, seed `dow-run22`, captured 2026-09-03T02:20Z) plus `report.json`, plus measurements taken directly off those PNGs and off the frozen source at the time of capture.

**Method note on sources:** the sandbox egress proxy blocks `WebFetch` to every domain I attempted (Steam, Meeple Mountain, Board Game Quest, TouchArcade, Big Boss Battle, TheSixthAxis, Gideon's Gaming, Monster Couch, Wikipedia — all returned `EGRESS_BLOCKED`). Wingspan reference below is therefore built from `WebSearch` result synthesis with the source URLs cited. Every claim about *our* game is first-hand measurement.

---

## VERDICT

**No. Our game loses a blind side-by-side comparison against Wingspan on Steam, and it does not lose narrowly. It loses on every axis the quality bar names except one.**

The single sentence version: **we have not built a game that looks like a game. We have built a well-organised admin console for a game.** There is no artwork, no board, no components, and no motion. There is a competent dark-navy dashboard with rounded panels and Unicode glyphs standing in for every physical object in the box.

Three measured facts carry the verdict:

1. **The only illustration in the entire product is a 24×28 pixel survivor thumbnail** (`dead-of-winter.scss:294-297`), cropped down from 198×236 source art. That is the *whole* art budget on screen. Wingspan's central design principle — per the quality bar's own §0 — is "illustrated card art is the hero element… large, and the layout is built to show them off." Ours is a favicon.
2. **0.49% of the 1920×1080 frame carries any saturated colour at all** (measured: 10,106 of 2,073,600 px at S>0.35). The screen is 99.5% desaturated navy. That is not "a confident low-saturation palette." That is the absence of a palette.
3. **The layout has exactly two failure states and no success state.** At 1280×720 it *clips*: 1.6% bare background but the player's entire hand and half the board are gone behind inner scrollers. At 3840×2160 it *voids*: **67.0% of the 4K frame is bare page background**, including a **1560px-tall empty band**. It never once fits the screen it is given.

The quality bar's stated thesis was that we beat Wingspan on desktop information density and on never hiding state behind scrolling. **We currently lose to Wingspan on both of those axes** — the two we picked as our win condition.

---

## §1 — VISUAL (V1–V15)

| # | Result | Evidence |
|---|---|---|
| **V1** | **PASS** | No browser-default chrome in any of the five shots. Buttons, badges and panels are authored; scrollbars are styled (`packages/ui/src/styles/reset.scss:159-176`, `scrollbar-width: thin` + `::-webkit-scrollbar-thumb`); a global `:focus-visible` ring exists (`reset.scss:118`). The one criterion we win outright. |
| **V2** | **FAIL** | There is no card art. `packages/client/public/games/dead-of-winter/` contains exactly one subdirectory: `survivors`. Item, crisis, crossroads and objective cards are text boxes — see `match-1920x1080.png`, "YOUR HAND" panel at x≈1530-1850, y≈560-830: four cards, each a bordered rectangle containing a name in body sans, an emoji, and a paragraph. Zero texture, grain, depth or lighting: `dead-of-winter.scss` contains **0 occurrences of `url(`** in 1,016 lines. |
| **V3** | **FAIL — exactly as suspected** | The board is coloured boxes labelled with location names, which V3 names as the forbidden pattern. `Board.tsx:48-60` maps `allLocations` to a `LocationCard` in a flat `.dow-board` grid. In `match-1920x1080.png` y≈335-475 the "board" is six identical rounded rectangles reading POLICE STATION / GROCERY STORE / SCHOOL / GAS STATION / LIBRARY, with HOSPITAL orphaned onto a second row at y≈490-610 beside ~1340px of nothing. No snow, no boarded windows, no cold light, no environment. Zombies are the character `●`, barricades `▮`, free entrance slots `○` (`parts.tsx:266-280`). |
| **V4** | **FAIL** | Seat identity is delivered by an **8×8px flat circle** (`dead-of-winter.scss:322-327`) plus a 2px seat-tinted left border on the bottom seat cards. It is not on dice (all dice render as the same grey Unicode die faces regardless of owner — `parts.tsx:44-48`, `DIE_FACE[value]`), not on hand counts, not on standees (there are no standees). In `match-1920x1080.png` the colony influence row at y≈285-300 identifies seven survivors' owners by seven 8px dots. At 3840×2160 nothing scales, so that dot is 8 *device* pixels. |
| **V5** | **FAIL — hard numbers** | Computed with Viénot/Brettel simulation and Rec.709 luminance from the five hexes in `descriptor.ts`.<br>**Greyscale collapse:** ember→140, violet→137, moss→149, frost→169, rust→106. **Ember and violet are 3 levels apart out of 255.** Four of five seats sit inside a 13-level luminance band (137–149).<br>**Deuteranopia:** frost (157,158,218) vs violet (134,134,199) — distance 67, a collapse.<br>**Protanopia:** ember/rust 90.5, ember/moss 93.3, frost/violet 103.5 — all three weak.<br>The criterion specifically warns ember/rust must not collapse; in *normal* vision they are already the closest pair (105.6). |
| **V6** | **FAIL** | Measured off `match-1920x1080.png`. The top-bar stat labels (MORALE / FOOD / ROUNDS LEFT / ROUND / WASTE) are `--tt-text-faint` `#74879c` over the vitals panel's lightened gradient, sampled at `#1a2430`: **4.25:1 measured**, below the 4.5:1 body minimum for 11px uppercase text. Token-level this is systemic: `#74879c` scores **4.14:1 on `--tt-surface-elevated`** and **3.88:1 on `--tt-surface-overlay`** — so every faint-tone label on a hovered panel, menu, popover or tooltip is non-compliant by construction. Secondary offender: the disabled MOVE / END TURN buttons measure **1.90:1** (`match-1920x1080.png` x≈1543-1660, y≈449-466) — the two primary actions of the game are effectively invisible in their resting state. |
| **V7** | **FAIL** | Not assessable across portal → lobby → match: run22 captured match only, so I have no portal or lobby frame. Per the scoring rule ("cannot produce evidence → FAIL"), FAIL. Independently, art direction is already inconsistent *inside* the match: the emoji glyphs inject a foreign palette (below, V11) and card names use the body sans while panel headings use the display face. |
| **V8** | **FAIL** | 1,016 lines of `dead-of-winter.scss` contain **7 `box-shadow` declarations total**. Three are `0 0 0 1px` — which V8 explicitly disqualifies ("a 1px outline is not elevation"); one is a focus ring; one is a 0-offset glow. **Exactly one is a real elevation shadow** (`0 14px 30px rgba(0,0,0,.28)`, line 380). There is one gradient in the whole file that is not a hairline (a page vignette, line 28) and one `repeating-linear-gradient`. Depth is expressed by borders and background-value steps, which is precisely what the criterion forbids. |
| **V9** | **FAIL** | The *pairing* exists globally — Oswald display + Inter UI, self-hosted woff2 (`packages/ui/src/styles/typography.scss:64-67`). But `dead-of-winter.scss` references `--tt-font-display` **zero times**; its only two `font-family` declarations are both `--tt-font-mono` (lines 59, 450). V9 requires the display face on "headings **and card names**." Card names do not get it: in `match-1920x1080.png` compare "POLICE STATION" (condensed Oswald, y≈358) against "Sack of Dog Food" (Inter, y≈580). Every card name in the game is set in body copy. |
| **V10** | **FAIL** | **0 occurrences** of `tabular-nums` or `font-variant-numeric` in `dead-of-winter.scss`. Inter's default figures are proportional; every count on screen — morale, food, rounds, waste, hand counts, deck counts, thresholds, dice values — will shift horizontally on change. Compounding this, the Starvation stat is conditionally mounted (`TopBar.tsx:45-53`, `starvation > 0 ? … : null`), so the entire vitals row reflows sideways the first time the colony misses a feeding. |
| **V11** | **FAIL — as suspected, and worse** | `content.ts:64-72` is literal Unicode: `⚔ ⛽ 🎓 🥫 ✚ 🔧 🧍`. This is not one icon set, it is a *mixture of two incompatible presentation classes* — `⚔` and `✚` are monochrome text dingbats, while `⛽ 🎓 🥫 🔧 🧍` resolve to the platform colour-emoji font. Measured proof from `match-1920x1080.png`: the food glyph in "Sack of Dog Food" renders at **RGB (243,179,12)** and **(255,81,25)**; "Night Watch Roster" at **(238,121,16)** and **(241,146,21)**. **These are the most saturated pixels in the entire frame** — the game's loudest colour is coming from Noto Color Emoji, not from our palette. They also change per OS. `parts.tsx:126-128` adds a *third* vocabulary: `⚔` `🔍` `✦` for attack/search/influence thresholds — so `⚔` means "weapon item" in one place and "attack threshold" in another. Not one set, not designed, not drawn to survive being small. |
| **V12** | **FAIL** | Not assessable from stills → FAIL per scoring rule, stated plainly. Concrete supporting evidence exists regardless: the conditional Starvation `Stat` (V10 above) is a guaranteed mid-game reflow of the vitals row. |
| **V13** | **FAIL** | Document-level scroll is clean at all five (`report.json`, `documentOverflowX/Y: 0` everywhere) — but the criterion is "no clipping." At **1280×720** the board clips 185px and the rail clips **632px**: `match-1280x720.png` shows only three of six non-colony locations (Police Station, Grocery Store, School), and those three are sliced through the middle at y≈490; GAS STATION, LIBRARY and HOSPITAL do not exist on screen; the "YOUR HAND" panel is entirely absent. At **1366×768** the same, rail clipping 584px. On "art must not look upscaled at 4K": the only raster asset is 198×236 source shown at 24×28, so it is *down*sampled to nothing — and were it ever shown at a real card size it would upscale immediately, because 198px is below any reasonable card width. |
| **V14** | **FAIL** | The criterion demands all nine simultaneously in one unedited 1920×1080 shot. `match-1920x1080.png` fails at least two: (a) **the hand is not fully visible** — the count badge reads **5** at x≈1878,y≈523, four cards are rendered, and `.dow-hand` hides **213px**; the fifth card is below the fold. (b) **Used dice are not visible** — `TurnPanel.tsx:562-564` renders spent dice inside the rail, which hides 254px at this resolution. (Starvation is also absent, though legitimately zero.) Anything reachable only by scroll is an explicit FAIL under this criterion. |
| **V15** | **FAIL — the flagship failure** | `.dow-hand` hides **213px at every resolution including 3840×2160**. There is no resolution at which a player can see their own hand. This is *literally the Wingspan tableau failure the quality bar told us to beat* — "the player's most important state is not visible at a glance" — reproduced verbatim, and reproduced at 4K, which is worse than Wingspan manages. Worst case at 1366×768 (`match-1366x768.png`) additionally loses the whole hand panel, three of six locations, and the used-dice tray behind a 584px rail scroll. `.dow-log__list` hides a further 503-520px everywhere. |

**§1 result: 1 PASS / 14 FAIL.**

---

## §2 — MOTION AND GAME FEEL (M1–M9)

These are not "unassessable from stills." I checked the source, and the finding is unambiguous: **Dead of Winter has no motion system whatsoever.**

- `dead-of-winter.scss` contains **0** occurrences of `transition`, `@keyframes` and `animation:` — combined, across 1,016 lines.
- **0** occurrences of `prefers-reduced-motion`.
- The DoW module imports `framer-motion` **0 times**, despite it being a declared dependency (`packages/client/package.json:18`) and despite Power Grid using it (`power-grid/board/useBoardMotion.ts`).
- `howler` is a declared dependency (`package.json:19`) and DoW imports it **0 times**. There are **no audio files anywhere** in `packages/client/public`.
- Interactive states in DoW: `:hover` ×4, `:active` ×0, `:focus-visible` ×0 (global ring only), `:disabled` ×1.

| # | Result | Evidence |
|---|---|---|
| **M1** | **FAIL** | Zero transitions/keyframes. Every state change is a hard cut, by construction. |
| **M2** | **FAIL** | No curves exist to be eased or sprung. |
| **M3** | **FAIL** | Four `:hover` rules, zero `:active`, one `:disabled`. Press and loading states do not exist. Disabled is expressed only as an opacity drop measuring **1.90:1** against its panel — indistinguishable from "absent." |
| **M4** | **FAIL** | None of the named moments (die settling, exposure roll, bite chain, barricade break, overrun, morale drop, crossroads flip, exile) has any visual treatment. They are log lines. |
| **M5** | **FAIL** | Dice and tokens are not objects. Dice are the Unicode characters `⚀⚁⚂⚃⚄⚅` (`parts.tsx:44-48`); zombies are `●`; barricades are `▮`. There is nothing with mass to arc, tumble, settle or cast a shadow. This is the benchmark's signature strength and we have not attempted it. |
| **M6** | **FAIL** | No sequencing layer. `match-1920x1080.png`'s log shows a bite/exposure chain resolving as four instantaneous consecutive lines (y≈983-1021). |
| **M7** | **FAIL** | Zero `prefers-reduced-motion` handling in DoW. Vacuously "respected" because nothing moves, which is not a pass — the criterion also requires M6 sequences to stay step-by-step and legible, and M6 does not exist. |
| **M8** | **FAIL** | Cannot be measured from stills, and there is no board pan/zoom, dice roll or card animation to measure. FAIL, stated plainly. |
| **M9** | **FAIL** | Zero audio assets in the repo. `howler` installed, never imported by DoW. |

**§2 result: 0 PASS / 9 FAIL.** This section is not "behind"; it has not been started.

---

## §3 — UX / ERGONOMICS (U1–U13)

| # | Result | Evidence |
|---|---|---|
| **U1** | **PASS** | `model.ts:137-150` `phaseLabel` renders `Colony — <step>` from `COLONY_STEP_LABEL`, so all seven colony steps are named. `match-1920x1080.png` shows the phase pill "PLAYER TURNS" (x≈33,y≈146) and the chooser badge "WAITING ON BOT 3" (x≈1580,y≈28), plus "Bot 3 · 1ST · TURN" in the seat strip. Never "something is happening." |
| **U2** | **FAIL** | Partially implemented and inconsistently. `ChoiceDialog.tsx:114` disables illegal options; `TopBar.tsx` carries `§` citations in `hint`. But the mechanism is the **native `title` attribute** (`parts.tsx:126-128,131,137,200,240`; `Seats.tsx:52,67,70`), which is a browser tooltip — ~500ms delay, OS-styled, unstyleable, and a direct V1-adjacent regression. More seriously, the two disabled controls actually on screen — MOVE and END TURN (`match-1920x1080.png` x≈1543-1660) — carry **no explanation at all** and sit at 1.90:1 contrast. The player cannot see that they are disabled, let alone why. |
| **U3** | **FAIL** | No evidence of a die/threshold preview in any of the five frames. `match-1920x1080.png`'s YOUR TURN panel shows three action dice and the instruction "Pick one of your survivors, then a die." — a *procedure*, not a preview. Nothing shows which unused die satisfies which threshold, what a food token would raise it to, or what the action consumes, prior to commitment. |
| **U4** | **PASS** | Controls are desktop-proportioned throughout. Nothing is inflated for touch; badges, pills and buttons sit in the 20-32px band. If anything the error is in the opposite direction (see U13). |
| **U5** | **FAIL** | Private and public zones are distinguished by *label*, not by *treatment* — which is the exact thing the criterion forbids. In `match-1920x1080.png` the "YOUR HAND" panel (private) and "THE COLONY" panel (public) share an identical surface, identical border, identical corner radius, identical header treatment. The only differentiator is the word "YOUR." Hand *counts* in the seat strip use the same grey glyph as every other count. Nothing signals "the table can see this" versus "only you can see this." |
| **U6** | **FAIL** | The dialog half is genuinely done: `packages/ui/src/components/Modal.tsx:53-95` moves focus in, traps Tab/Shift-Tab, closes on Escape and restores focus on unmount; `ChoiceDialog.tsx:17` uses it. A global `:focus-visible` ring exists. But I have **no evidence** for keyboard traversal of the board itself — survivor chips, location cards, dice — and cannot obtain it from stills. FAIL per the scoring rule, with the modal work credited. |
| **U7** | **PASS** | `match-1920x1080.png`, "WHAT HAPPENED" panel: entries name the actor, the movement, the exposure, the frostbite with running count "(1/3)", the crossroads title and the option chosen. Hidden identities are not leaked ("Bot 3 adds 1 card to the crisis" — count only, per §8.2). Colour-coded by severity. This is the strongest single component in the product. |
| **U8** | **FAIL** | The "1ST" badge marks the first player (`Seats.tsx:51-52`, `title="First player token. §5.1"`), so the *token* is shown. **The two directions are not.** Nothing on screen states or depicts that turns pass left/clockwise while the token passes right at round end. The criterion requires both to be *shown, not inferred*; currently both must be inferred, and one of them cannot be inferred at all from a static frame. |
| **U9** | **FAIL** | Per-panel rules text exists and is good — `TopBar.tsx` hints cite §16, §11.1, §11.6, §11.2, §11.3; `ChoiceDialog.tsx:147` cites §7.3; the crisis panel prints "Wants: tool, fuel — anything else counts against it. §11.3" inline. But (a) most of it is buried in native `title` tooltips rather than being visible, and (b) there is **no rules reference reachable at all times** anywhere in the five frames — the only global controls are the join code and a LEAVE button. |
| **U10** | **PARTIAL → FAIL** | Attribution is present at the coarse level ("WAITING ON BOT 3", "TURN" badge). But I have no evidence of an *explicit, attributed* pause point for casualty choice, bite decision, first-player ordering, objective contribution or vote — none appears in any of the five frames, and `ChoiceDialog` is not visible in any capture. Unverifiable → FAIL. |
| **U11** | **FAIL** | Not assessable from stills. Note for the record: `report.json` shows a `WebSocket connection to 'ws://localhost:5173/ws' failed` warning at all five resolutions — that is Vite HMR, not game transport, so it is not itself a defect, but reconnection behaviour is entirely unevidenced. FAIL. |
| **U12** | **FAIL** | Half-met. No "show objective" action appears anywhere, which is correct. But the **no-reveal rule reminder is absent** — the objective text sits in the seat card at `match-1920x1080.png` x≈38,y≈1020 ("Your objective: Fractured Walls — End the game after the colony's morale reaches zero.") with no adjacent reminder, and there are no chat controls on screen to place one near. |
| **U13** | **FAIL** | Capacity is legible as a *number* ("0/4", "1/4") and entrances as `1○○ 2○○ … 6○○`. But the criterion is that topology and capacity be legible **unaided** and **countable by looking** — and there is no topology to read. Six identical rectangles in a row communicate nothing about adjacency, distance, or how the colony relates to the outposts. The entrance strip renders occupancy in three near-identical small glyphs (`●` zombie, `▮` barricade, `○` free) at the same size and near-identical greys; distinguishing a full entrance from a barricaded one requires reading a native tooltip (`parts.tsx:263`). |

**§3 result: 3 PASS / 10 FAIL.**

---

## THE BLIND COMPARISON

### Wingspan reference profile (cited)

Assembled from search synthesis; direct page fetches were blocked by the egress proxy.

- **Art is the hero.** Wingspan's ~170 bird cards are painted by Ana María Martínez Jaramillo and Natalia Rojas (with Beth Sobel), executed "with the rigor required for scientific illustration" in coloured pencil and mixed media. In the digital port "the detailed scientific illustrations from the tabletop version are reproduced in **larger, more brilliantly colored form** and enhanced with charming animations" — the birds have per-card animations "that look fantastic." ([Greenhook Games](https://www.greenhookgames.com/wingspan-artists/), [More Games Please](https://www.moregamesplease.com/art-in-boardgames/2019/2/25/wingspan-art-in-board-games-44), [PC Gamer](https://www.pcgamer.com/wingspan-review/), [Geeks Under Grace](https://www.geeksundergrace.com/tabletop/reviews-tabletop/review-wingspan-digital/))
- **Environment, not boxes.** Habitats are "beautifully painted habitats as backdrops." ([Board Game Quest](https://www.boardgamequest.com/wingspan-digital-review/))
- **Components as objects.** The birdfeeder dice tower is modelled as a physical birdhouse; food tokens are five distinct coloured objects (berries pink, invertebrates orange, fish blue, rodents brown, seeds yellow); egg miniatures in multiple colours. ([Board Games Land](https://boardgamesland.com/wingspan-board-game-review/), [MeepleSource](https://meeplesource.com/proddetail.php?prod=BlueBirdhouse))
- **Diegetic audio.** "Relaxing, soft music with a campfire feel, mixed with bird sounds and trivia narration." ([Geeks Under Grace](https://www.geeksundergrace.com/tabletop/reviews-tabletop/review-wingspan-digital/))
- **Reception.** "A stunning translation in its presentation, visuals, and music"; "rivals or surpasses the best board game adaptations"; **94% positive across 6,528 Steam reviews.** ([Board Game Maniac](https://www.boardgamemaniac.com/wingspan-digital-review-steam-version/), [Steam](https://store.steampowered.com/app/1054490/Wingspan/))
- **Its two documented weaknesses — our intended win condition.** (1) *Tableau outgrows the frame:* "You can't even see your entire tableau at once unless you click an extra button for a 'bird's eye view'"; the game is "chopped up" into pieces; "the bird cards available don't appear unless you are on the water habitat, and the birdfeeder doesn't appear unless you are in the grasslands habitat." ([Meeple Mountain](https://www.meeplemountain.com/reviews/wingspan-digital/), [Big Boss Battle](https://www.bigbossbattle.com/wingspan-is-as-relaxing-as-ever-but-the-digital-interface-clips-its-wings-slightly/)) (2) *Small text:* card text "is quite small," the bird market is "hard to read," a known complaint carried over from the 10pt physical cards — enough that Stonemaier shipped vision-friendly recolours. ([Colorblind Games](https://colorblindgames.com/2024/01/27/from-wingspan-to-wyrmspan-an-accessibility-journey/), [Stonemaier accessibility](https://stonemaiergames.com/about/accessibility/))

### Criterion by criterion

| Criterion | Winner | Why |
|---|---|---|
| **Art quality** | **Wingspan, by an enormous margin** | Hundreds of hand-painted scientific illustrations, animated in-card, shown large. We have thirty 198×236 portraits displayed at **24×28px** and nothing else. This is not a close call; it is a category difference. Not "we need better art" — we have effectively none. |
| **Layout confidence** | **Wingspan** | Wingspan's failure is that it splits the table across views; it is still *composed* within each view. Ours is not composed at any size: at 1280×720 half the game is amputated behind scrollers, at 3840×2160 **67% of the frame is bare background** with a 1560px empty band. A layout with no correct resolution cannot be called confident. |
| **Typography** | **Wingspan** — but this is our closest loss | We have a genuinely good type system: self-hosted Oswald + Inter, a fluid major-third ramp, tracking and leading tokens (`typography.scss`). Wingspan's documented weakness is small, low-contrast card text. **We throw the advantage away**: DoW uses `--tt-font-display` zero times, so every card name is body sans; zero `tabular-nums`, so every count jitters; and our own faint tone measures **4.25:1** on the vitals bar, which is the same class of readability defect Wingspan is criticised for. Wingspan wins because its type is at least applied with intent to an illustrated card. Flipping this to a win is cheap. |
| **Colour discipline** | **Wingspan** | Wingspan holds a warm, few-hue natural palette across painted art. Ours: **0.49% of the frame carries any saturation**; the loudest pixels on screen are **(243,179,12)** and **(255,81,25)** emitted by a 12px emoji from the OS font, not from our palette; five seat colours that **collapse in greyscale to a 13-level band** and lose frost/violet under deuteranopia. Discipline requires colours that are chosen, held, and distinguishable. Ours are none of the three. |
| **Iconographic clarity** | **Wingspan** | One drawn vocabulary of food/habitat/nest symbols, drawn to survive being small. Ours is Unicode: `⚔ ⛽ 🎓 🥫 ✚ 🔧 🧍` mixing monochrome dingbats with colour emoji in one row, plus a *second* conflicting vocabulary where `⚔` means "attack threshold" instead of "weapon," rendering differently on every OS. |
| **Information density** | **Wingspan** — and this one should hurt | This was one of our two designated win conditions. At 1920×1080 we hide the 5th hand card, the used dice and 254px of rail; at 1366×768 we hide the entire hand, three of six locations and 584px of rail; at 3840×2160 we hide 213px of hand *while leaving two-thirds of the frame empty*. Wingspan makes you press a "bird's eye view" button — an annoying but complete solution. **We make you scroll and give you nothing in return for a 4K monitor.** We lose to the thing we set out to beat. |
| **Desktop-appropriateness** | **Wingspan** | Wingspan is a native desktop app with resolution-aware presentation. Our layout is resolution-*indifferent*: identical pixel sizes at 720p and 4K, an 8px seat pip and a 24px portrait at every DPI, and 67% dead space at 4K. This reads as a web page that happens to be open on a large monitor. |

**Overall winner: Wingspan, 7–0.** A blind reviewer shown `match-1920x1080.png` beside any Wingspan Steam screenshot would identify ours as a management dashboard or an admin tool and Wingspan as the game, in under two seconds, without reading a word.

The honest framing: **the engineering underneath is good and the information architecture is thoughtful** — the log (U7) is genuinely better than most shipped board game adaptations, the phase/step labelling (U1) is excellent, the rule citations are diligent, the type tokens are well built, the console is clean at all five resolutions, and the state model is clearly sound. None of that is visible in a screenshot. **We have built the half of the product that a blind comparison cannot see, and not started the half it can.**

---

## PRIORITIZED FIX LIST

Ordered by how much each moves a blind side-by-side, most valuable first.

### P0 — the product is not a game until these land

**1. Make the board a painted winter environment. (V3, V13, U13, layout confidence, art quality)**
`packages/client/src/games/dead-of-winter/game/Board.tsx:48-60` and `dead-of-winter.scss` `.dow-board` / `.dow-place`.
Replace the flat CSS grid of `LocationCard` rectangles with a single authored scene — one SVG or high-resolution WebP of a snowbound town with the colony at centre and six outposts placed around it, each a rendered building with boarded windows, snow accumulation and cold rim light. Locations become hit regions on that scene, not boxes. This one change fixes the largest single visual gap, absorbs most of the dead space at ≥1920px, and gives topology (U13) for free. **Nothing else on this list matters as much.**

**2. Give every card real art and a real card frame. (V2, V8, art quality)**
`packages/client/public/games/dead-of-winter/` currently holds only `survivors/`. Add `items/`, `crisis/`, `crossroads/`, `objectives/`. Render the hand as illustrated cards with a painted top third, a die-cut frame, paper grain and a drop shadow — not `.dow-card` text boxes (`dead-of-winter.scss:651-700`). Re-master the survivor portraits above 198×236 and render them at **≥96px in the rail and ≥240px in the inspect view**, not 24×28 (`dead-of-winter.scss:294-297`).

**3. Fix the two-state layout: clipped below, void above. (V13, V14, V15, information density, desktop-appropriateness)**
- `.dow-hand` hides **213px at every resolution including 4K** — this is the flagship failure and the one the quality bar explicitly told us to beat. Make the hand a horizontal fanned row that scales card size to fit the seat count, never an inner vertical scroller.
- `.dow-match__rail` hides 632px @720p / 584px @768p / 254px @1080p. Below 1440px the rail must reflow into the bottom strip rather than scroll.
- `.dow-match__board` hides 185px/137px at 720p/768p.
- Above 1920px the layout must *use* the space: **67.0% of the 4K frame is bare background with a 1560px empty band**, 45.4% at 1440p, 24.5% at 1080p. Scale the board scene and the components with viewport, don't leave fixed-px content floating in a void.

**4. Build a motion system. (M1–M8)**
DoW has **0** `transition`, **0** `@keyframes`, **0** `animation:`, **0** `prefers-reduced-motion` and **0** `framer-motion` imports, while `framer-motion@11` is already installed and Power Grid already uses it (`power-grid/board/useBoardMotion.ts` is the working pattern to copy). Minimum viable: spring transitions on every state change (M1/M2); a real 3D-ish die that tumbles and settles on its face (M5) — the current die is the character `⚀`; step-paced zombie placement and bite chains (M6); and a `prefers-reduced-motion` branch (M7).

### P1 — cheap, high-leverage, fixes measurable defects

**5. Replace all Unicode iconography with a drawn set. (V11, V7, colour discipline)**
`content.ts:64-72` (`SYMBOL_GLYPH`) and `parts.tsx:126-128` (`⚔ 🔍 ✦`) and `parts.tsx:266-280` (`● ▮ ○`). Ship one SVG sprite sheet: seven item symbols, three threshold symbols, zombie, barricade, free-slot, wound, frostbite. Currently the most saturated pixels on the entire screen — **(243,179,12)** and **(255,81,25)** — come from the OS emoji font, and `⚔` carries two different meanings in two places.

**6. Re-pick the five seat colours so they survive greyscale and CVD. (V4, V5)**
`packages/games/dead-of-winter/src/descriptor.ts`. Current greyscale luminances: rust 106, violet 137, ember 140, moss 149, frost 169 — **ember and violet differ by 3 of 255**, and four of five sit in a 13-level band. Spread them to ≥25 luminance steps apart *and* re-check the Viénot deuteranopia collapse of frost/violet (distance 67). Then carry seat identity on more than an 8px dot (`dead-of-winter.scss:322-327`): tint the dice, the standees and the hand-count chips.

**7. Fix the contrast failures. (V6)**
`--tt-text-faint` `#74879c` scores 4.14:1 on `--tt-surface-elevated` and 3.88:1 on `--tt-surface-overlay`; the vitals labels measure **4.25:1** in situ. Lighten `--tt-text-faint` to clear 4.5:1 against `--tt-surface-overlay` (the darkest legitimate backdrop it lands on), or forbid it above `--tt-surface-panel`. Separately, disabled MOVE / END TURN measure **1.90:1** — raise disabled contrast to ≥3:1 and add the reason (U2).

**8. Apply the type system we already built. (V9, V10)**
`dead-of-winter.scss` uses `--tt-font-display` zero times. Put it on `.dow-card__name` and every panel heading. Add `font-variant-numeric: tabular-nums` to every numeric readout (currently **0** occurrences). Make the Starvation `Stat` always-mounted (`TopBar.tsx:45-53`) so the vitals row stops reflowing.

**9. Express depth with elevation, not borders. (V8)**
Seven `box-shadow`s in 1,016 lines, three of them `0 0 0 1px` outlines. Build a real elevation ramp (panel / raised card / floating card / modal) with layered shadow, inner light and edge highlight, and apply it to cards, dice and standees.

### P2 — completes the section, lower visual leverage

**10. Distinguish private from public by treatment, not label. (U5)** Give private zones (hand, secret objective, search results, held crossroads) a distinct surface — warmer ground, a torn/hand-held edge, a "for your eyes" rim — so "YOUR HAND" and "THE COLONY" are not the same rectangle.
**11. Replace native `title` tooltips with the authored `Tooltip` component throughout** (`parts.tsx:126-137,200,240`, `Seats.tsx:52,67,70`) — instant, styled, and legible. **(U2, U9, V1)**
**12. Add an always-available rules reference** and a die/threshold **preview on hover** before commitment. **(U9, U3)**
**13. Show both directions of play** — turn order and the opposing first-player-token pass — as an explicit indicator, not an inference. **(U8)**
**14. Add diegetic audio** (`howler@2` is already a dependency, imported 0 times; there are 0 audio files in `public/`). Wind, snow, wood, bone, dice. **(M9)**
**15. Rename one of the two panels both titled "THE TABLE"** — visible simultaneously at 2560×1440 and 3840×2160 (right rail, and bottom strip) with different contents.
**16. Add the no-reveal reminder** adjacent to the objective. **(U12)**
**17. Capture portal and lobby frames** in the next run so V7 (cross-surface art direction consistency) can be scored at all; it is currently an evidence gap, not a judgement.

---

## SECTION SCORES

| Section | Result |
|---|---|
| §1 Visual (V1–V15) | **FAIL** — 1 pass, 14 fail |
| §2 Motion (M1–M9) | **FAIL** — 0 pass, 9 fail |
| §3 UX (U1–U13) | **FAIL** — 3 pass, 10 fail |
| Blind comparison | **FAIL** — Wingspan wins 7–0 |

The loop does not terminate.
