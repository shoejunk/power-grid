# Power Grid Gameplay Requirements

## Source and scope

This document translates the supplied [Power Grid rulebook](./power-grid-rules.pdf) into requirements for a computer game implementation. It covers the base game on the Germany and USA maps, the optional experienced-player starting-city rule, and the two-player `Against the Trust` variant.

The digital implementation should preserve the rulebook's timing, legal-action restrictions, costs, tie-breakers, resource limits, and endgame evaluation. Map topology, city names, connection costs, plant data, payment data, and resource-refill data should be data-driven rather than hard-coded into phase logic.

## 1. Game model

### Players and inventory

- Support 2-6 players in the base game.
- Each human player has:
  - 22 houses in one color.
  - 50 Elektro at setup.
  - A payment summary card.
  - A connected-city count and score-track position.
  - Up to 3 owned power plants.
  - Resources stored on owned plants.
- The bank provides money. Resource tokens are finite and are divided into a market and a supply.
- A city has three house slots with building costs of 10, 15, and 20 Elektro. The number of usable slots depends on the current game Step.
- A player may have at most one house in each city. A metropolis may contain no more than one house from the same player in each of its two cities.

### Board and map data

- Provide both the Germany and USA maps.
- Each map has 6 areas, each containing 7 cities.
- At setup, all players use one shared playing zone consisting of contiguous areas. The zone size is:

| Players | Areas in playing zone |
| ---: | ---: |
| 2 | 2 |
| 3 | 3 |
| 4 | 4 |
| 5 | 5 |
| 6 | 6 |

- A player may use only cities and connections inside the selected zone for the entire game.
- The selected zone contains the same number of areas as there are human players.
- Map data must include city adjacency, connection costs, city/metropolis relationships, and the three house-slot costs.
- A connection may have cost 0.
- The game must support choosing a contiguous zone, either randomly or through an appropriate player-facing selection flow.

### Resources

Provide finite token supplies for:

| Resource | Tokens | Color in the rulebook |
| --- | ---: | --- |
| Coal | 24 | Brown |
| Oil | 24 | Black |
| Garbage | 24 | Yellow |
| Uranium | 12 | Red |

The initial market occupies these spaces:

| Resource | Initial occupied spaces |
| --- | --- |
| Coal | 1-8 |
| Oil | 3-8 |
| Garbage | 6-8 |
| Uranium | 14-16 |

Each market space has a price. A resource purchase pays the price printed on the space for every token purchased. Refill always starts with the most expensive empty spaces and proceeds toward cheaper spaces.

### Power plants

- Include plant cards numbered `03` through `40`, plus `42`, `44`, `46`, and `50`.
- Include one `Step 3` card.
- Every plant has:
  - A number, which is its minimum bid, market sort key, and tie-break value.
  - A resource type or resource types.
  - A fuel requirement.
  - A number of cities it can supply when operated.
  - A card-back category used during deck preparation: `plug` for the weaker cards and `socket` for the remaining cards.
- The illustration on a plant card has no gameplay effect.
- Standard plants require exactly the printed number of matching resource tokens to operate. A plant cannot be operated with fewer or more fuel tokens than its requirement.
- A plant can store at most twice its operating fuel requirement, and only compatible resource types.
- A hybrid plant accepts coal and/or oil in any combination that totals its fuel requirement. Its storage limit is twice the requirement across both resource types, not twice per type.
- An ecological plant requires no resources, cannot store resources, and supplies up to its printed city capacity.
- A plant's storage capacity does not double its production capacity. A plant can supply at most its printed number of cities per round.
- A plant that produces more electricity than the player needs wastes the surplus. A player cannot spend half the fuel to produce electricity for half of a plant's capacity.

## 2. Setup requirements

1. Place the selected map and choose the contiguous playing zone.
2. Give each player 22 houses, 50 Elektro, and a payment summary card.
3. Put one house from each player on scoring-track space 0.
4. Randomly determine the initial player order and place one house from each player on the top row of the player-order track.
5. Fill the initial resource market using the starting-space table above. Put all remaining resource tokens in the supply.
6. On the USA map, place no coal in the separate coal-storage area at setup; all initial coal is on the resource market.
7. Place the refill-summary card matching the player count next to the resource market. It provides the map- and Step-specific refill values.
8. Build the initial plant market:
   - Shuffle the plug-backed plants numbered `03`-`15`.
   - Draw 8 face-up plants.
   - Sort them by number. Put the four lowest in the current market and the other four in the future market.
   - Set one additional plug-backed plant aside face down.
9. Build the plant supply stack:
   - Set the `Step 3` card aside temporarily.
   - Shuffle the socket-backed plants.
   - Randomly remove the following cards without looking at them, and place them out of play:

| Players | Plug-backed cards removed | Socket-backed cards removed |
| ---: | ---: | ---: |
| 2 | 1 | 5 |
| 3 | 2 | 6 |
| 4 | 1 | 3 |
| 5-6 | 0 | 0 |

   - Shuffle all remaining plant cards together into a face-down supply stack.
   - Put the `Step 3` card face down under that stack.
   - Put the set-aside plug-backed plant face down on top of the stack.
   - The plug on the top card indicates that the top card is from the weaker portion of the deck; it is not otherwise a gameplay modifier.
10. Place the auction hammer, discount token, Step 2 barrier, and Game End barrier in their starting locations.

### Optional experienced-player starting cities

After initial player order and zone selection, let players choose future starting cities in player order and mark each temporarily with a neutral uranium token. The marked cities must be in different areas. The markers form a shared pool: when a player begins building, they may exchange any unoccupied marked city's token for their house and return the token to the supply. A marker must not use the colour of the player who selected it before a house occupies that city. Except when a player is establishing their first city, unoccupied marked starting cities cannot be connected during Step 1.

## 3. Round and phase state machine

The game consists of rounds. Every round uses these phases in order:

1. Determine Player Order
2. Auction Power Plants
3. Buy Resources
4. Build Houses
5. Bureaucracy

Within each phase, players act in the phase-specific order. The game begins in Step 1. Step transitions change city capacity, building costs, refill values, and plant-market behavior.

The implementation must not advance to the next phase until every required player action in the current phase is resolved. All legal-action checks must use the current Step and the current market/resource state.

## 4. Player order

- At the start of every round, rank players by the number of cities in their networks, highest first.
- For a tie, rank the tied player with the highest-numbered owned plant first.
- Continue applying the same rules to determine every position.
- Use random order only for initial setup.
- Phase 2 normally proceeds in player order, starting with the first player.
- Phases 3 and 4 proceed in reverse player order, starting with the last player.
- Phase 5 cash payment starts with the first player.
- The digital player-order state should expose both the computed order and each player's phase status, such as eligible, purchased, passed, or acted.

## 5. Phase 1: Determine Player Order

At the start of the round, recompute player order from connected-city counts and the largest owned plant tie-breaker. Place the order for the round before Phase 2 begins.

In the first round only, the initial random order is used for the plant auctions. After every player has bought a plant, recompute order using the normal connected-city and largest-plant tie-breaker before Phases 3-5. This is the one-time first-round exception.

## 6. Phase 2: Auction Power Plants

### General auction rules

- Each player may acquire at most one plant in a round.
- During the first round, every human player must acquire one plant.
- A player who has acquired a plant cannot bid in another auction or offer another plant during that round.
- A player who passes is permanently out of the current phase and cannot later bid or acquire a plant that round.
- A player may auction only one of the four plants in the current market. Future-market plants are not legal auction choices.
- The minimum opening bid is the plant number, except for the discounted plant, whose minimum is 1 Elektro.
- The auction proceeds clockwise from the auctioning player. A player may raise the current bid or pass. A passed player cannot re-enter.
- The remaining bidder pays the winning bid to the bank and takes the plant.
- After every plant acquisition, draw a replacement from the plant stack and resort all market plants by number. The four lowest plants are the current market; higher plants are the future market, except in Step 3.
- If the auctioning player wins their own auction, the next eligible player in order takes the next turn.
- If another player wins, the auctioning player may offer another current-market plant or pass, provided they have not already acquired a plant.
- The last player to start an auction in the round pays the minimum bid for the plant they choose, because no later eligible player remains to create a higher bid.

### Discount token

At the start of Phase 2, put the discount token on the lowest-numbered plant in the current market. While it remains there, that plant's minimum bid is 1 Elektro.

- If the discounted plant is bought, move the discount token next to the market.
- If nobody buys the discounted plant, remove it from the game at the end of Phase 2, draw a replacement, and leave the discount token next to the market.
- While the discount token remains on a plant, if the first replacement drawn has a printed number lower than the discounted plant's printed number, remove that replacement and the discount token, then draw another replacement immediately.
- There are no discounted plants during Phases 3-5.

### Plant ownership limit

- A player may own at most 3 plants.
- When acquiring a fourth plant, the player must scrap one of their existing plants. The newly acquired plant cannot be scrapped.
- Remove the scrapped plant from the game.
- Move resources from the scrapped plant to the remaining plants if those plants have compatible capacity.
- Return any resources that cannot be stored to the resource supply, never to the market.

After Phase 2, reset all player-order phase-status markers to the normal order row.

## 7. Phase 3: Buy Resources

Resolve players in reverse player order.

- A player may buy any number of resources that their owned plants can use and store.
- A player may not buy resources that no current plant can use.
- A player may not exceed any plant's storage capacity.
- Each token costs the price of its market space and is paid to the bank.
- If a resource type is depleted from the market, that type cannot be purchased again until the next bureaucracy refill.
- A player may rearrange stored tokens among compatible plants at any time, as long as all resulting storage limits are respected.
- Fuel consumed during production is returned to the supply, not placed directly on market spaces.

USA exception:

- Coal has a separate storage area.
- After all market coal is purchased, players may continue buying coal for 8 Elektro per token from that storage.
- When coal is consumed for production, place it in the USA coal-storage area so it can be used in later market refills.

After Phase 3, reset phase-status markers.

## 8. Phase 4: Build Houses

Resolve players in reverse player order. Each player may connect any number of cities during their turn, then the next player acts. The phase ends after the first player in the order completes their turn.

### Starting network

- A player with no network may choose any empty city in the selected zone and place a house in its lowest available slot for 10 Elektro, but their first city must be in an area not used for another human player's first city.
- The player pays the building cost to the bank.
- A player may defer starting their network until a later round.
- In the optional experienced-player mode, a player with no network may choose any unoccupied marked starting city as described in Setup.

### Expanding a network

- Every newly connected city must be reachable from at least one city already in the player's network.
- The player pays the cheapest connection route from one of their connected cities to the new city, plus the lowest-cost empty house slot in the destination city.
- A route may pass through a city without placing a house there.
- A player may use cities connected earlier in the same turn as new route origins.
- A player must pay the connection cost again for the route chosen to each new city, even if an earlier connection traversed or bypassed the same edge or city.
- A player may not connect the same city twice.
- A player may connect only cities and edges inside the selected zone.
- Until Step 2, a player may connect only cities in the area of their first city.
- A player cannot place a second house in a metropolis city if that would put two houses from the same player in the two cities of the metropolis.
- A player places their house in the lowest empty city slot: 10, then 15, then 20 Elektro.
- A player's network count updates immediately after each new city is connected.
- The player may connect no city unless they can pay all connection and building costs.

### Step-specific city capacity and building cost

| Step | Houses allowed per city | House costs |
| --- | ---: | --- |
| 1 | 1 | 10 |
| 2 | 2 | 10, 15 |
| 3 | 3 | 10, 15, 20 |

After Phase 4, reset phase-status markers.

## 9. Phase 5: Bureaucracy

Phase 5 has three subphases: earning cash, resupplying resources, and updating the plant market.

### 9.1 Earning cash and producing electricity

Resolve players from first to last in player order.

- Each player chooses how many network cities to supply, from zero up to the electricity their plants can produce and the number of cities in their network.
- The player chooses which plants operate.
- An operating non-ecological plant consumes exactly its fuel requirement from its storage.
- An ecological plant consumes no fuel.
- A player's total generation above their supplied-city count is wasted.
- A player may supply fewer cities than they own even when enough generation is available.
- Remove consumed resources from the plants and return them to the supply. Do not place them on the market.
- Pay the player according to the payment summary for the number of supplied cities.
- A player who supplies zero cities receives the guaranteed minimum of 10 Elektro.

### 9.2 Resupply the resource market

- Use the refill summary for the current player count, map, and Step.
- For each resource type, add the specified number of tokens from the supply to empty market spaces.
- Start at the highest-priced empty space and fill toward the lowest-priced spaces.
- If the supply has fewer tokens than the required refill amount, place all available tokens and leave the market partially empty.
- Stored resources on plants reduce the number of tokens available in the supply; token counts are finite.

USA exception:

- Take coal markers from the USA coal-storage area when resupplying the coal market.

Germany exception - nuclear phase-out:

- If a player buys plant `39`, stop all future uranium resupply for the rest of the game.
- Do not trigger the phase-out if plant `39` was not bought by a player or was removed during setup.

### 9.3 Update the plant market

During Steps 1 and 2:

- Remove the highest-numbered plant in the future market from the market and place it face down under the plant supply stack.
- Draw a replacement from the stack.
- Resort the market so the four lowest plants are current and the rest are future.
- This gradually moves high-numbered plants below the `Step 3` card for later availability.

During Step 3:

- Remove the smallest-numbered plant in the current market from the game.
- Draw a replacement from the stack.
- Keep the market at six plants with no future row.

If the plant stack is exhausted, do not draw replacements. During each later Phase 5, remove the smallest-numbered plant from the market and continue the game.

## 10. Game Steps and transitions

### Step 1

- The game begins in Step 1.
- Each city may contain only one player's house.
- The first house in a city costs 10 Elektro.
- Use the Step 1 column of the refill summary.
- The Step 1 market has four current plants and four future plants.

### Step 2

Step 2 begins at the start of Phase 5 after at least one player has connected the required number of cities during Phase 4:

| Players | Step 2 threshold |
| ---: | ---: |
| 2-5 | 7 connected cities |
| 6 | 6 connected cities |

When Step 2 begins:

- Place the Step 2 barrier at the matching scoring-track threshold.
- Remove the lowest-numbered plant in the current market and replace it once from the plant stack.
- Allow two different players' houses in each city.
- The second house in a city costs 15 Elektro.
- An empty city still costs 10 Elektro for its first house.
- Use the Step 2 column of the refill summary.

### Step 3

Step 3 begins at the start of the next phase after the `Step 3` card is drawn.

If the card is drawn during Phase 2:

1. Treat the card as the highest plant for the remainder of the current auction phase and place it at the end of the future market.
2. Immediately shuffle the plant stack containing the cards below the Step 3 card and place it face down again.
3. Continue Phase 2 so every eligible player can acquire a plant or pass.
4. At the end of Phase 2, remove the lowest-numbered current-market plant and remove the Step 3 card. Do not draw replacements.
5. Begin Step 3 at Phase 3 of the same round.

If the card is drawn during Phase 5:

1. Remove the Step 3 card and the lowest-numbered current-market plant. Do not draw replacements.
2. Shuffle the plant stack that was below the Step 3 card and place it face down again.
3. Use Step 2 refill values one final time for the current bureaucracy.
4. Begin Step 3 at Phase 1 of the next round.

During Step 3:

- Each city may contain three different players' houses.
- The third house costs 20 Elektro.
- The first and second houses continue to cost 10 and 15 Elektro.
- The plant market contains six current plants, all available for bidding; there is no future market.
- Use the Step 3 column of the refill summary.
- If Step 3 begins before Step 2, apply all Step 2 changes first, then apply the Step 3 changes.

## 11. End of game and winner

The game ends immediately after Phase 4 when at least one human player reaches the connected-city threshold for the player count:

| Players | End-game threshold |
| ---: | ---: |
| 2 | 14* |
| 3-4 | 17 |
| 5 | 15 |
| 6 | 14 |

\* The base two-player threshold is 18, but the two-area zone contains only 14 cities, so the effective threshold is capped at 14.

- A player may connect additional cities during the remainder of the ending Phase 4 if those cities are needed to win.
- The following Phase 5 is a winner-evaluation phase, not a normal cash-production phase.
- Do not pay normal income.
- For each player, determine the number of cities they can supply using their current plants and available resources.
- The player who can supply the most cities wins, even if another player triggered the end of the game by reaching the threshold.
- If tied, the player with the most remaining money wins.

## 12. Map-specific requirements

### Germany

- Apply the German nuclear phase-out rule when plant `39` is bought by a player.
- After activation, uranium is never resupplied for the rest of the game.

### USA

- Provide the separate coal-storage area.
- Start the storage empty.
- Coal may be bought from storage for 8 Elektro after market coal is depleted.
- Coal used for production is placed in storage and is available to future USA refills.

## 13. Two-player variant: Against the Trust

The Trust is an automated third faction. All base-game rules remain in force except where this section overrides them.

### Trust setup

- Use the 2-area playing zone.
- Give the Trust 16 houses plus one extra house used only for the player-order track.
- The Trust does not receive money and does not use the connected-city scoring track.
- Randomly choose which human is first. Place that human at order position 1, the Trust permanently at position 2, and the other human at position 3.
- After the zone is selected, place 6 Trust houses on the 10-Elektro spaces of 6 adjacent cities:
  1. The starting human places one house in any eligible city.
  2. The other human places two houses, one at a time, each adjacent to an existing Trust house.
  3. The starting human places the next two houses by the same adjacency rule.
  4. The other human places the last house.
  5. Put the remaining 10 Trust houses beside the board as its supply.
- In optional experienced-player setup, determine the Trust's six starting cities before the humans choose their two future starting cities. Place a Trust house on the 15-Elektro space of each marked city; the Trust then has 8 houses in supply.

### Trust general rules

- The Trust takes plants and resources for free.
- Trust houses are placed without money or connection costs.
- Trust houses do not trigger Step 2.
- Trust houses block only the first or second city slots; they never occupy a third-slot position.
- The Trust is always second in player order.
- The Trust cannot win.

### Trust Phase 1

Keep the Trust at player-order position 2 every round. Recompute order only between the two human players according to the base-game rules for their positions relative to the Trust.

### Trust Phase 2

- Only the two human players participate in auctions. The Trust never bids.
- The first human chooses a current-market plant to auction or passes, subject to the first-round requirement that human players acquire a plant.
- After the first human has acquired a plant or passed, the Trust takes its turn before the second human's turn.
- The Trust takes the highest-numbered plant in the current market for free; there is no auction.
- If the Trust owns fewer than 3 plants, it takes that plant and adds it to its plant area.
- If the Trust already owns 3 plants, it takes a market plant only when the available higher-numbered plant is higher than the Trust's smallest owned plant. When it does so, scrap and remove the Trust's smallest plant, then take the higher plant.
- Human players follow the base-game one-plant-per-round, bidding, passing, market replacement, and ownership-limit rules.

### Trust Phase 3

- The Trust takes all resources needed for normal production for all of its plants, for free.
- It does not store resources between rounds.
- If the market lacks enough resources, take as many as are available.
- For a hybrid plant, take alternating coal and oil while both are available, starting with coal.

### Trust Phase 4

- During Step 1, the six cities initially occupied by Trust houses cannot be connected by human players.
- Those cities become available when Step 2 begins.
- While the Trust has houses in supply, whenever a human connects a new empty city, immediately place a Trust house on that city's 15-Elektro space.
- This blocks the first 10 newly connected human cities during Step 2; another human may connect those cities only once Step 3 permits the third house slot.
- The Trust's free houses do not count toward the human players' connected-city counts or Step 2 threshold.

### Trust Phase 5

- Return all resource tokens taken by the Trust to the resource supply after production resolution.

### Trust end condition

- The two-player game ends after Phase 4 when either human has connected at least 14 cities in this two-area variant.
- The following Phase 5 uses the normal two-player winner evaluation: the human who can supply the most cities wins, with remaining money breaking ties.

## 14. Digital implementation requirements

### Authoritative state

The game state must retain, at minimum:

- Current map and selected playing zone.
- Current Step and pending Step-transition events.
- Round number and phase.
- Human players' money, houses, network cities, owned plants, stored resources, and order positions.
- Resource market occupancy, prices, finite supply, and USA coal storage when applicable.
- Current and future plant markets, plant supply stack, removed cards, Step 3 card state, discount token, and any pending discounted-replacement rule.
- Auction eligibility, bids, passed players, and acquired-this-round status.
- Trust state in two-player games: houses, blocked cities, plant area, and free-resource production.
- End-game trigger and winner-evaluation data.

### Legal-action validation

The UI must prevent illegal choices, including:

- Bidding on a future-market plant in Steps 1-2.
- Re-entering an auction after passing.
- Buying a second plant in one round.
- Buying resources a player's plants cannot use or store.
- Buying a depleted market resource, except USA coal from storage at 8 Elektro.
- Building outside the playing zone, in a full city, twice in the same city, or without a valid network route.
- Using a city or connection belonging outside the selected zone as a path.
- Scrapping the newly acquired plant when a player exceeds the three-plant limit.
- Triggering Step 2 from Trust houses.
- Paying cash during endgame winner evaluation.

### Determinism and auditability

- Random setup operations must use a recorded seed or replayable random stream.
- Every automatic change should be represented as an explicit state transition so that the UI can explain market refills, Step transitions, discarded cards, Trust actions, and endgame calculations.
- The game should expose a rules/effects log for bids, payments, resource movement, plant operation, building costs, and winner evaluation.

## 15. Acceptance criteria

A complete implementation must be able to demonstrate that:

1. A legal base-game match can be set up for every player count from 2 through 6 on either map.
2. Player order, auction order, reverse resource/build order, and bureaucracy order are all correct.
3. Plant sorting, the discount token, plant ownership limit, resource storage, hybrid plants, ecological plants, and scrapping behave exactly as specified.
4. Network path costs, city-slot costs, Step-specific capacity, zero-cost connections, and metropolis restrictions are enforced.
5. Resource refill is finite, price-ordered, map-aware, and Step-aware.
6. Germany plant `39`, USA coal storage, Step 2, Step 3, and stack exhaustion are handled at the correct phase boundary.
7. Endgame winner evaluation can select a player other than the player who first reached the city threshold.
8. The two-player Trust setup and all Trust phase actions work without giving the Trust money, a score-track position, or a win condition.
9. The replay or rules log can explain every automatic market, resource, Step, and winner-evaluation transition.
