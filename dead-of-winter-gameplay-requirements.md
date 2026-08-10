# Dead of Winter Gameplay Requirements

## Source, purpose, and scope

This document translates the supplied [Dead of Winter rulebook](./dead-of-winter-rules.pdf) and [rulings/errata](./dead-of-winter-rulings.pdf) into implementation requirements for a computer game version of the base game. It covers the standard hidden-objective game, exile, all core actions and timing rules, the rulebook variants, and the optional two-player Prisoner's Dilemma variant described in the rulings document.

The requirements use this precedence order:

1. A card's explicit text overrides the general rulebook.
2. The errata and later rulings override the printed rulebook and any older ruling that they explicitly replace.
3. Otherwise, the printed rulebook controls.

The supplied PDFs do not contain the complete face text for every survivor, item, crisis, crossroads, secret-objective, exiled-objective, and main-objective card. A shipping game therefore also needs a licensed, versioned content catalog for every card. The engine requirements below are complete for the mechanics described by the PDFs, but they are not a substitute for that card-content dataset. Flavor stories on rulebook pages 16-19 have no additional gameplay effect.

The `Dead of Winter: The Long Night` and `Dead of Winter: Warring Colonies` rulings at the end of the rulings PDF concern expansions and are outside the base-game implementation. They must not be applied to a base-game match.

## 1. Product modes and player counts

- Support 3-5 players for the standard hidden-objective game.
- Support 2 players through the cooperative two-player variant.
- Make the following rulebook variants selectable at setup:
  - Cooperative.
  - Two-player cooperative.
  - Betrayer.
  - Hardcore.
  - Player elimination.
- The rulings document also describes a separate two-player Prisoner's Dilemma variant. Treat it as an optional advanced mode, clearly distinguished from the official two-player cooperative mode.
- Mode selection must happen before decks, objectives, and starting hands are prepared because several modes change those operations.
- Card filters such as the non-cooperative symbol and the mature-content symbol must be data fields, not image recognition performed at runtime.

## 2. Core game model

### 2.0 Base content manifest

Use the component counts as a completeness check for the licensed base-game dataset:

| Content/component | Count |
| --- | ---: |
| Dual-sided main-objective cards | 10 |
| Non-betrayal secret-objective cards | 24 |
| Betrayal secret-objective cards | 10 |
| Exiled secret-objective cards | 10 |
| Survivor cards and matching standees | 30 |
| Starter item cards | 25 |
| Item cards per non-colony location | 20 |
| Non-colony item decks | 6 |
| Crisis cards | 20 |
| Crossroads cards | 80 |
| Action dice | 30 |
| Exposure dice | 1 |
| Zombie standees | 30 |
| Additional zombie tokens | 30 |
| Wound tokens | 25 |
| Helpless-survivor tokens | 20 |
| Food, noise, and barricade tokens | 20 each |
| Starvation tokens | 6 |

These physical quantities validate content and art coverage. Do not infer a digital gameplay cap from a token shortage unless the rules or a card explicitly impose one. The rulebook expressly supplies zombie tokens when standees run out, demonstrating that standee count alone is not a zombie limit.

### 2.1 Board and locations

The game board consists of seven locations:

- The colony.
- Police Station.
- Grocery Store.
- School.
- Gas Station.
- Library.
- Hospital.

The colony state must include:

- Six numbered entrances in a fixed cycle from 1 through 6.
- The entrance spaces at each entrance, each holding one zombie or one barricade.
- Colony survivor spaces, each holding one survivor or one helpless survivor.
- Morale, on a track from 0 through 10.
- Remaining rounds.
- Food-supply tokens.
- Starvation tokens.
- The ordered waste pile.
- The crisis deck and current crisis.
- Face-down crisis contributions.
- The current main objective and its contributed cards, counters, and scenario-specific state.

Each non-colony location must define, as content data:

- Its survivor-space capacity.
- Its entrance-space capacity.
- Its item deck.
- Four noise spaces.
- The item-symbol likelihood order shown to players.
- Its stable position in the non-colony location order used by automatic effects.

The source calls for resolving several effects in "location order" but does not enumerate that order in text. The digital board must establish one deterministic, visible order from the physical layout/content data and use it consistently for zombie placement, noise, and logs.

### 2.2 Players

Each player has:

- An exiled/non-exiled status.
- A group leader.
- Zero or more follower survivors.
- A private hand of item cards.
- A private secret objective and, after exile, an exiled-objective modifier.
- An unused action-dice pool and a used action-dice pool.
- Per-turn movement state for each survivor.
- Per-turn and per-round usage state for abilities and equipped items.

There is no general upper limit on the number of survivors a player may control. A player normally cannot remain with zero survivors: losing the last survivor triggers replacement unless the player-elimination variant is active.

Group leader status grants no general action bonus. It determines the initial first player, is referenced by some objectives/effects, and identifies which survivor must be replaced as leader if lost.

### 2.3 Survivors and helpless survivors

Every survivor definition needs:

- Name and occupation.
- Influence value.
- Attack threshold.
- Search threshold.
- Ability location, such as `ANYWHERE`, the colony, or a named location.
- Ability text represented by executable effect data or a tested scripted effect.
- Any timing and usage limits, including once-per-round state.

Occupation is descriptive only and has no general gameplay effect.

A normal survivor instance needs:

- Controller.
- Current location.
- Wound tokens, distinguishing regular wounds from frostbite wounds.
- Equipped item instances.
- Whether it has moved during the current turn.
- Whether it is the controller's group leader.

Helpless survivors:

- Occupy colony survivor spaces.
- Count as colony survivors for food consumption and zombie generation.
- Have no controller actions, influence, attack, search, or equipment.
- Cannot be attacked.
- Do not receive spreading bites.
- Do not leave with an exiled player.
- Can be killed by effects or an overrun when only helpless survivors are available.

### 2.4 Cards and zones

Support these card families:

- Standard and hardcore main objectives.
- Non-betrayal, betrayal, and exiled secret objectives.
- Survivors.
- Starter and location item cards.
- Crisis cards.
- Crossroads cards.

Item cards use one or more gameplay symbols from weapon, fuel, education, food, medicine, tool, and survivor. Cards with `EVENT` or `OUTSIDER` effects in starter or location decks are still item cards. A named non-item attachment or crossroads result is not converted into an item merely because its fiction resembles one; for example, `Welcome Home` is not a gun item.

Track cards in explicit zones:

- Draw deck.
- Player hand.
- Equipped to a survivor.
- Waste pile.
- Face-down crisis contribution.
- Face-up main-objective contribution.
- Bottom of a deck.
- Returned to the box during setup.
- Removed from the game.

"Returned to the box" during setup is not the same as "removed from the game" for card effects. The engine must preserve that distinction.

### 2.5 Tokens, dice, and randomization

- Action dice are standard six-sided dice. Each die retains its rolled value until spent or the next roll-action-dice step.
- The exposure die has blank, wound, frostbite, and bitten faces in the distribution printed on the physical die/content data.
- Zombie standees and zombie tokens represent the same entity. The digital implementation should use a count/entity model large enough to handle all required zombies rather than fail when standee art is exhausted.
- Barricades and zombies are mutually exclusive occupants of entrance spaces.
- Noise is represented individually because each token is removed and rolled separately.
- All shuffles, random draws, random hand thefts, action-die rolls, and exposure rolls must use an authoritative, replayable random stream.

## 3. Information visibility and communication

The implementation must enforce these visibility rules:

- Card counts in every deck and player hand are public.
- The number of cards each player contributes to the crisis is public.
- Card identities in a player's hand are private.
- Search results are private to the searching player.
- Crisis-contribution identities and symbols remain hidden until the crisis is resolved.
- Main-objective contributions are face up and public.
- The crossroads card drawn for a turn is visible only to the player who drew it until it triggers.
- A player's secret-objective card is private.

Players may discuss a secret objective, refuse to discuss it, or lie, but they may not reveal the card, name it, read its text, or give details so exact that the hidden text is effectively disclosed. The UI must not provide a "show objective" action. Free-form voice or text chat cannot be perfectly policed, so the rules reminder must be visible near the objective/chat controls.

When a non-betrayer is exiled, the applicable exiled-objective card requires the original secret objective to be revealed. A betrayer does not reveal the betrayal objective merely because of exile.

Public logs must not leak hidden card identities. Private audit data may record them for reconnection and replay authorization.

## 4. Standard setup

Set up a standard game in this order:

1. Create the colony and six non-colony locations with their printed capacities and ordered item decks.
2. Give each player a reference area.
3. Select a standard main objective, place it at the colony, initialize its morale and round values, and execute its setup instructions. Scenario setup may add zombies before survivors are placed.
4. Prepare standard secret objectives:
   - Randomly set aside two non-betrayal objectives per player.
   - Add one random betrayal objective.
   - Shuffle those cards and deal one face down to each player.
   - Return all unused objectives to the box unseen.
   - The errata permits omitting the betrayal card for an easier game.
5. Shuffle the crisis deck.
6. Independently shuffle the survivor, exiled-objective, and crossroads decks.
7. If players enabled the content filter, remove crossroads cards marked for mature themes before shuffling/playing.
8. Deal five starter item cards to each player. Return unused starter cards to the box.
9. Shuffle each location's item deck and place it at that location.
10. Deal four survivors to each player. Each player privately keeps two and returns two; reshuffle the returned survivors into the survivor deck.
11. Each player designates one kept survivor as group leader and the other as a follower.
12. Place every starting survivor in an empty colony survivor space.
13. Give the first-player token to the player whose group leader has the highest influence.

The source does not state how to break an initial tie between equally influential group leaders. The implementation must use a documented deterministic or seeded-random tie-breaker for that one setup case. Once assigned, the first player breaks all later ties unless a card says otherwise.

The complete card identities selected, returned to the box, and dealt must be retained in authoritative hidden state so a match can reconnect or replay without changing setup.

## 5. Round state machine

Every round has exactly two phases in this order:

1. Player Turns Phase.
2. Colony Phase.

### 5.1 Player Turns Phase

Resolve these steps in order:

1. Reveal the top crisis card. It remains active until the colony's Resolve Crisis step.
2. Roll action dice for all players.
3. Starting with the first player and proceeding clockwise to the player on the left, give each player one turn.

### 5.2 Colony Phase

Resolve these steps in order:

1. Pay Food.
2. Check Waste.
3. Resolve Crisis.
4. Add Zombies.
5. Check Main Objective.
6. Move the round tracker down one.
7. Pass the first-player token to the player on the current first player's right.

No phase or step may advance while it has an unresolved choice, die roll, death, bite chain, crossroads result, overrun, or card effect.

## 6. Action dice and individual turn start

At the Roll Action Dice step:

- Clear every player's used and unused pools.
- Give each player one die plus one die for every survivor they currently control.
- Roll all those dice and place them in the player's unused pool.
- Dice belong to the player's group, not to specific survivors.
- Any survivor may use multiple dice and perform multiple actions.

A survivor that will die from frostbite at the start of its controller's turn still contributed an action die because dice were rolled before individual turns begin.

At the beginning of an individual player turn:

1. The player on the active player's right privately draws the top crossroads card and begins monitoring its trigger.
2. Resolve beginning-of-turn effects, including adding one regular wound to every controlled survivor that has at least one frostbite wound.
3. Kill any survivor that reaches three wounds before the active player may perform actions.

If multiple effects are truly simultaneous, the current first player chooses their resolution order. Crossroads monitoring must already be active before other beginning-of-turn events that could satisfy a trigger.

The active player may then perform legal actions in any order and may stop voluntarily. Play passes left after all chosen actions and pending effects resolve.

## 7. Actions that require an action die

To spend an action die, move it from the unused pool to the used pool. A threshold action requires a die value greater than or equal to the printed threshold. An "any result" action accepts any unused die.

### 7.1 Attack a zombie

- Choose a controlled survivor and spend a die meeting its attack threshold.
- Choose a zombie at the survivor's current location. At the colony, the player may choose a zombie from any entrance.
- Kill and remove that zombie.
- Immediately resolve any mandatory on-kill objective/effect rolls.
- Then roll exposure for the attacking survivor.
- The survivor may attack again by spending another qualifying die.

Whenever an attack or card effect says it kills a zombie, the controlling survivor responsible for that kill rolls exposure once per zombie killed unless an effect explicitly cancels those rolls. An effect that says it removes a zombie, rather than kills it, is not a kill and does not satisfy kill-based objectives.

An ability that kills zombies is not automatically an attack, but it is still a kill. An effect that replaces "kill one zombie" can be chosen only once for a given attack; two replacement effects cannot be stacked. Effects that trigger when an attack is performed may combine with an effect that attacks without using the normal attack action. A modifier that only changes the required die, such as Switchblade, does not replace the attack and may combine with one replacement effect.

### 7.2 Attack a survivor

- Choose a controlled survivor and spend a die meeting the attacker's attack threshold.
- Target another player's normal survivor at the same location.
- A player cannot target another survivor they control or a helpless survivor.
- Reroll the spent action die as a new d6 result.
- If the reroll is less than or equal to the target survivor's numeric attack value, give the target one wound and take one random card from the target controller's hand.
- If the test fails, neither result occurs.
- Do not roll exposure for a survivor attack.
- Multiple survivor attacks are allowed if the attacker can spend a qualifying die each time.

The random card selection must be authoritative and reveal the stolen card only to its new owner and the former owner.

### 7.3 Search

- A survivor may search only at a non-colony location.
- Spend a die meeting that survivor's search threshold.
- Privately draw the top item card and inspect it without adding it to the hand yet.
- The player may keep that card and end the search, or place one noise token in an empty noise space to draw another card.
- Repeat the noise-and-draw choice while empty noise spaces and cards remain.
- Keep exactly one of the cards drawn by that search and place the others on the bottom of that location's item deck.
- A survivor may search again by spending another qualifying die. A new search does not require noise left over from the earlier search.

Search results are not revealed to other players. Card effects that modify a search may combine, including one effect that increases cards viewed initially and another that increases cards viewed when noise is made.

When a location deck is empty, it is not replenished and nothing automatic happens. The source does not specify the order in which multiple unkept cards are placed on the bottom; the implementation must choose and document a deterministic policy, preferably allowing the searching player to order them if the licensed card text does not say otherwise.

### 7.4 Barricade

- Choose a controlled survivor.
- Spend any unused action die.
- Place one barricade in an empty entrance space at that survivor's current location.
- The action is illegal if no empty entrance space exists.

### 7.5 Clean Waste

- The player must control at least one survivor at the colony.
- Spend any unused action die.
- Remove the top three cards of the ordered waste pile from the game, or all remaining cards if fewer than three remain.

### 7.6 Attract

Apply the printed rule with its errata:

- Choose a controlled survivor and spend any unused action die.
- Choose one other source location.
- Move zero, one, or two zombies from that single source location to empty entrance spaces at the survivor's location.
- Zombies taken from the colony may come from different colony entrances.
- Attracted zombies arriving at the colony may be distributed among its entrances in any way; the normal 1-through-6 placement cycle does not apply.
- Attract cannot move a zombie merely from one colony entrance to another.
- Attracted zombies can occupy only currently empty entrance spaces. They never destroy a barricade and never cause an overrun.
- The action cannot take zombies from two different source locations.

### 7.7 Survivor ability

- The survivor must be at the ability's required location.
- If the ability shows a number, spend a die meeting or exceeding it.
- If it has no die requirement, treat it as a no-die action/effect at its printed timing.
- Unless its text limits usage, the ability may be used multiple times during its controller's turn.
- A once-per-round ability may be used only on its controller's turn and must retain its used state for the entire round.
- A survivor cannot use another survivor's ability or equipped cards unless an effect explicitly grants that access.

## 8. Actions that do not require an action die

### 8.1 Play an item card

- A player may play any number of cards from hand, but normally only during that player's turn.
- Fully resolve the current effect before another item is played. Item cards cannot interrupt an effect already in progress.
- Place a played card on top of the waste pile unless it is equipped, contributed, or removed by a rule/effect.
- Card effects are mandatory once played unless the card itself offers a choice.
- A healing card effect cannot be refused when it targets a legal survivor.
- A medicine card cannot interrupt a third wound to save a survivor; the survivor dies before another card can be played.

For an `EQUIP` card:

- Equip it to any survivor the active player controls, subject to card restrictions.
- There is no general limit on duplicate equipped items, including two copies of the same item.
- An equipped card cannot be unequipped voluntarily. It leaves the survivor only when handed off, contributed to the crisis, or moved by death/card text.
- If an equipped once-per-round effect has been used, handing the item off, returning it to a hand, or re-equipping it does not reset that usage state.

### 8.2 Add cards to the crisis

- A non-exiled active player may contribute any number of item cards from hand and/or equipped cards to the current crisis.
- Place each contribution face down.
- Other players may know the number contributed but not the identities.
- Each card is one contribution regardless of how many tokens its normal effect would produce.
- An equipped card ceases to be equipped when contributed.
- Contributions cannot be withdrawn.

### 8.3 Add cards to the main objective

- During a player's turn, add eligible cards face up to the main objective.
- Only cards required by that objective may be added.
- Unless the objective limits the rate, a player may add any number in one turn.
- A requirement for non-starter cards excludes starter cards.
- Exiled players may contribute to the main objective.
- A card received through Request cannot be placed directly on the main objective.

### 8.4 Move a survivor

- Each controlled survivor may move at most once during its controller's turn.
- Move to any location with an empty survivor space.
- Immediately roll exposure after arrival unless an effect cancels the roll.
- If the roll is bitten, the bite spreads among eligible survivors at the destination, not the origin.
- Mark the survivor as having moved only after the move is committed; forced exile relocation does not consume this allowance.
- An exiled survivor cannot move to the colony.

### 8.5 Spend food tokens

- A non-exiled player may remove one or more food tokens from the colony supply during their turn.
- Each removed token increases one selected unused action die by one.
- A die cannot be increased above six.
- Food cannot be spent if the player has no unused die to increase.
- The player may repeat the action for other unused dice while food remains.

### 8.6 Request

- During the active player's turn, that player may request one or more item cards from any other player.
- No co-location is required.
- Giving a requested card is voluntary.
- A given card is revealed and must be played immediately by the requester.
- It may be played for its own effect, equipped, or used immediately as the required input to another ability. Request is a permitted nested action for this purpose.
- It cannot be contributed directly to the crisis or main objective.
- A requested equip card may be equipped, used, and later contributed from equipment to the crisis during the same turn if each individual step is legal.
- Exiled players may request cards and may give requested cards.

### 8.7 Hand off

- Choose an item equipped to a controlled survivor and another survivor at the same location.
- Both controllers must consent when the recipient belongs to another player.
- Unequip from the giver and immediately equip to the receiver.
- Used once-per-round state remains used.
- Exiled and non-exiled survivors may hand items to each other if they legally share a non-colony location.

### 8.8 Initiate a vote to exile

- Once during their turn, a player, including an already exiled player, may nominate another player for exile.
- A player cannot nominate themselves.
- All players currently allowed to vote cast yes/no simultaneously; the nominated player may vote.
- Exiled players cannot cast votes even though they may initiate the vote.
- The first player breaks a tie.
- If yes wins, resolve exile immediately.

## 9. Exposure, wounds, bites, and death

### 9.1 Exposure results

Roll exposure immediately after a survivor moves to a new location and after each zombie it kills, unless an effect cancels that specific roll.

- Blank: no effect.
- Wound: add one regular wound.
- Frostbite: add one frostbite wound. It counts as a wound for every rule and effect.
- Bitten: kill the survivor and begin a bite-spread chain.

A survivor is killed immediately upon reaching three total wound tokens of any mix. Frostbite also causes one additional regular wound at the start of each of that survivor's controller's turns while at least one frostbite token remains.

### 9.2 Bite spread

After a bitten survivor dies:

1. Find the eligible normal survivor at the same location with the lowest influence. Do not select a helpless survivor.
2. That survivor's controller chooses one of these options:
   - Kill the survivor immediately and stop the chain.
   - Roll exposure. A blank lets the survivor live and stops the chain. Any non-blank kills the survivor and continues the chain to the next lowest-influence eligible survivor.
3. Stop when a controller chooses the automatic kill, a blank is rolled, or no eligible survivors remain.

If equally low influence values require a tie-break, use the first player's general tie authority unless card text provides another rule.

If a bite kills a player's last survivor, the replacement survivor is added only after the current location has no eligible survivors and the bite effect ends. The new survivor never joins that bite chain.

### 9.3 Survivor death and removal

On a normal survivor death:

- Remove its standee from the board.
- Move its survivor card to the removed-from-game pile.
- Reduce morale by one unless the survivor belongs to an exiled player.
- If it died at the colony, return its equipped cards to its controller's hand.
- If it died at a non-colony location, shuffle its equipped cards into that location's item deck.
- If it was group leader and the player still has followers, the player immediately chooses one as the new group leader.

On a helpless-survivor death:

- Remove one helpless-survivor token.
- Reduce morale by one.

If an effect removes a survivor rather than killing it, do not reduce morale unless that effect explicitly says to do so.

### 9.4 Losing the last survivor

Unless player elimination is active, when a player's last survivor would be killed or otherwise lost:

- Complete the loss/death cleanup for that survivor.
- Remove every card in that player's hand from the game.
- Draw a random new survivor.
- Add it to the game as the player's group leader.
- A non-exiled player's replacement enters the colony.
- An exiled player's replacement enters an eligible non-colony location of that player's choice.
- During Add Zombies, this replacement interrupts the current placement sequence before the next zombie/noise token resolves. An exiled player may choose a location whose scheduled zombies have not yet been added.

The rulebook does not specify what to do if a non-exiled last-survivor replacement must enter while every colony survivor space is occupied. The implementation needs a licensed-content ruling or an explicit house-rule policy for that exceptional state.

With the player-elimination variant, remove the player's hand and eliminate the player instead of drawing a replacement.

## 10. Crossroads system

At the beginning of each player's turn, the player on the right draws one crossroads card and keeps it secret. The card applies only to the active player.

- Continuously evaluate its trigger against authoritative events during that turn.
- For action-based triggers, first finish the entire triggering action, including movement exposure, deaths, and other mandatory consequences.
- If a survivor dies while moving, a movement-triggered crossroads card does not trigger from that failed/survivor-ending sequence.
- When the trigger is satisfied, reveal and read the entire card, including every option and all outcomes.
- The active player makes the choice unless the card specifies a vote or another chooser.
- Resolve the selected option immediately, then remove the card from the game.
- If the trigger never occurs, put the card on the bottom of the crossroads deck at turn end.
- If a crossroads effect searches a deck for a named card, reshuffle that deck afterward.

Option validation:

- If the active player cannot meet an option's conditions, that option is illegal and another legal option must be chosen.
- A clause qualified by "if able" may fail without cancelling unqualified parts of the same effect.
- A requirement to affect "all" members of an empty set is satisfied; for example, moving all zero dice is legal.
- If no legal result exists due to malformed content, stop and expose a rules error rather than silently skip the card.

Crossroads effects that would add survivors or helpless survivors cannot trigger if the colony has no survivor spaces for the addition. Item cards that would add a survivor likewise cannot be played in that state.

## 11. Colony Phase step details

### 11.1 Pay Food

Count normal and helpless survivors at the colony. Survivors at non-colony locations feed themselves and do not count.

- Required food is `ceil(colony occupants / 2)`.
- If the food supply contains at least that much, payment is mandatory and exactly that many tokens are removed.
- If food is insufficient:
  - Remove no food.
  - Add one starvation token to the food supply area.
  - Reduce morale by the total number of starvation tokens now present.
- Starvation tokens persist through later successful feedings.
- They are removed only by an explicit effect.

### 11.2 Check Waste

- Count all cards in the waste pile without removing them.
- Reduce morale by `floor(waste card count / 10)`.
- Because the waste pile is ordered, later Clean Waste actions always remove its most recently played cards first.

### 11.3 Resolve Crisis

1. Shuffle all face-down contributions so contributors cannot be inferred from reveal order.
2. Reveal them one at a time.
3. Score each card:
   - Plus one if it has any symbol accepted by the crisis's prevention requirement.
   - Minus one if it has no accepted symbol.
4. Compare the total with the number of non-exiled players.
5. If total is lower, execute the crisis failure effect immediately.
6. If total is equal or higher, prevent the crisis.
7. If total is at least two higher, also raise morale by one, subject to the morale-track maximum.
8. Resolve any optional over-contribution effect printed on the crisis.
9. Remove all contribution cards from the game.

Each contributed card counts once. A food card that would normally add several food tokens still contributes only one point.

### 11.4 Add Zombies

This step has three ordered batches:

1. Colony population batch: add one zombie to the colony for every two colony occupants, rounded up.
2. Non-colony population batch: in stable location order, add one zombie to a location for every normal survivor there.
3. Noise batch: in stable location order, remove each noise token one at a time, roll a d6, and add one zombie at that location on a result of three or lower.

Check for morale-zero game end after the complete colony batch, after the complete non-colony batch, and after the complete noise batch. This is the specific exception to immediate morale-zero termination when overrun deaths occur during zombie placement. If morale reaches zero from another effect outside this sequence, end immediately.

When a separate effect starts a new add-zombies sequence, colony entrance cycling restarts at entrance 1. Zombie placement during Resolve Crisis does not advance the entrance pointer used by the later Add Zombies step.

### 11.5 Check Main Objective

- Evaluate the objective only at this colony-phase step unless its card explicitly supplies different timing.
- Completing its conditions earlier in the round does not end the game immediately.
- If complete, end the game now.
- A "survive X rounds" objective completes after the specified rounds have been survived if morale remains above zero when checked.

### 11.6 Round tracker and first player

- If the main objective did not end the game, reduce the round tracker by one.
- If it reaches zero, end immediately without another main-objective check.
- Otherwise pass the first-player token to the player on the current first player's right and begin the next round.

## 12. Zombie placement and overruns

Add zombies one at a time.

At the colony:

- Start each placement batch at entrance 1 and cycle through 2, 3, 4, 5, 6, then 1 again.
- At the selected entrance, use any empty entrance space.
- If no space is empty but a barricade exists, destroy one barricade and discard the incoming zombie; do not place it in the newly emptied space.
- If the entrance is full and has no barricade, discard the incoming zombie and overrun the entrance.
- After a barricade destruction or overrun, the next incoming zombie advances to the next entrance in the cycle.

At a non-colony location, use the same empty-space, barricade, and overrun rules, but that location has only one entrance.

On overrun:

- Kill the normal survivor at that location with the lowest influence.
- If there are no normal survivors but there are helpless survivors, kill one helpless survivor.
- If there are no survivors of either kind, discard the incoming zombie with no further effect.
- Resolve death cleanup and last-survivor replacement before processing the next incoming zombie.

Attract and effects governed by Attract are not zombie-addition effects: they can use empty spaces only and cannot destroy barricades or overrun.

## 13. Adding survivors

When an effect adds a survivor:

- Draw/select the survivor as directed.
- Give control to the specified player.
- Place its standee in an empty colony survivor space, unless the player is exiled or the effect says otherwise.
- An exiled player's newly added survivor enters an eligible non-colony location chosen by that player.
- The new survivor may act later in the current controller's turn.
- It does not grant an additional action die until the next Roll Action Dice step.
- There is no per-player survivor cap.

If the colony has no empty survivor space, players cannot trigger crossroads cards that add normal or helpless survivors and cannot play item cards that add them. Mandatory replacement of a last survivor is addressed separately because the source leaves its full-colony edge case unresolved.

## 14. Exile

### 14.1 Becoming exiled

When an exile vote succeeds:

1. Mark the player exiled.
2. Immediately draw one exiled secret-objective card and attach its instructions to the original secret objective.
3. Reveal the original objective only when the exiled-objective instructions require it; non-betrayers reveal, betrayers do not.
4. Move every survivor that player controls at the colony to chosen non-colony locations.
5. These forced relocations do not consume the survivors' once-per-turn move allowance.
6. A normal forced relocation follows movement rules and rolls exposure.

If there are not enough empty non-colony survivor spaces for all forced relocations, repeat this exception for each stranded exiled survivor:

- Choose a non-exiled survivor at a non-colony location and return it to an empty colony survivor space.
- Put the exiled survivor in the space that survivor vacated.
- Neither relocation counts as a move and neither survivor rolls exposure for this swap.

Helpless survivors stay at the colony.

### 14.2 Rules for an exiled player

An exiled player:

- Cannot add cards to a crisis.
- Does not add helpless survivors when instructed to do so.
- Adds newly gained survivors at non-colony locations.
- Cannot spend colony food tokens to modify action dice.
- May instead play a food card to raise an unused action die by one per food card, rather than use that card's normal effect.
- That food-card die modification still requires an unused die and cannot raise it above six.
- May also play a food card normally to add food to the colony.
- Cannot cast votes.
- Does not reduce colony morale when one of their survivors dies.
- Removes played cards from the game instead of adding them to the waste pile.
- Cannot move survivors into the colony.

An exiled player may still:

- Initiate an exile vote.
- Request cards or give requested cards.
- Hand off an item to/from a non-exiled survivor at the same non-colony location.
- Add eligible cards to the main objective.
- Perform all other legal actions not expressly prohibited.

If at any time two players are exiled and neither has a betrayal secret objective, set morale to zero immediately and end the game. This test uses authoritative hidden objective state even if other players cannot see the objectives.

## 15. Voting, ties, and simultaneous effects

- Votes are simultaneous yes/no choices with no changes after reveal.
- Allow discussion before vote commitment.
- The nominated player participates unless already exiled.
- A crossroads card may define a narrower electorate; for `Outbreak`, only players who currently have a survivor at the colony vote.
- The first player breaks every tied group decision even if the first player did not otherwise participate in that decision.
- If two game effects trigger simultaneously, the first player chooses their resolution order.
- Simultaneous resolution required by specific card text still takes precedence over the general ordering choice.

The first-player token passes right at round end, while turns proceed left/clockwise. Preserve both directions explicitly in the UI and state machine.

## 16. Game end and winners

The game can end in three core ways:

- Morale reaches zero. End immediately, except for the defined Add Zombies morale checkpoints. Do not check main-objective completion.
- The round tracker reaches zero. End immediately. Do not check main-objective completion again.
- The main objective is complete at the Check Main Objective step.

At game end in a standard hidden-objective game:

- Evaluate each player's complete objective state independently, including betrayal and exiled-objective modifications.
- A player who completed that objective wins; a player who did not loses.
- Multiple players may win.
- Everyone may lose.

Secret objectives are not early win triggers. A player must wait for a global game-end condition.

In cooperative modes, there are no secret objectives. All players win only by completing the main objective before morale or rounds cause a loss.

## 17. Card-effect execution rules

The content engine must support:

- Typed triggers such as turn start, action performed, move completed, zombie killed, survivor killed, crisis resolution, morale change, and round end.
- Conditions over player status, locations, survivors, card zones, item symbols, counters, dice, and objectives.
- Choices with legality predicates.
- Nested requested-card use.
- Ordered atomic effects that cannot be interrupted by ordinary item play.
- Explicit kill versus remove semantics.
- Explicit attack versus non-attack kill semantics.
- Explicit card ownership, control, and current zone.
- Persistent once-per-round usage state on the card/ability instance rather than on its current owner.
- Search-and-shuffle operations.
- Simultaneous operations when card text demands them.

Card text overrides the rulebook, but the override must be narrow: only the contradictory rule is replaced. The rest of the normal action/effect procedure still applies.

When two objective requirements can be satisfied by the same cards, the same card may count for both unless the objective text consumes or assigns it. For example, a hand of three qualifying cards can satisfy separate "have two" and "have three" checks.

## 18. Required errata and named-card rulings

The licensed content implementation and regression suite must encode all of these base-game rulings.

### 18.1 Errata

- Loretta Clay's ability threshold is `4+`, not `4`.
- `Old Divisions` triggers only if a survivor controlled by the active player is at the colony and at least one helpless survivor is at the colony.
- Attract may move fewer than two zombies, including zero.
- Standard setup may omit the betrayal secret objective, with the understood reduction in difficulty.

### 18.2 Main and secret objectives

- Cards contributed to a main objective are face up; any number may be added during a turn unless limited by that objective.
- Main-objective completion waits for the colony-phase check.
- Starter cards do not qualify where an objective requests non-starter cards.
- `Stockpile` accepts multiple contributions in one turn.
- For `We Need More Samples`, after a zombie is killed, roll its sample check before rolling exposure. The sample check is mandatory. Effects that say "kill" count; effects that say "remove" do not.
- In the printed introductory `We Need More Samples` scenario, initialize morale and rounds to 6, add one zombie to every non-colony location, and require three successful samples per player who started the game. Each zombie kill makes a sample d6 roll; a 4-6 result adds a sample/zombie to the objective.
- `Raiding Party` counts the applicable option from `Bev Russell` toward its objective.
- `Hunger` refers to food cards, not food tokens.
- `Hoarder` requires strictly the most cards in hand; tying for most is insufficient.

### 18.3 Survivors

- Edward White uses one die for a normal attack and a second qualifying die plus a medicine-symbol card for his ability to kill two additional zombies. All three exposure rolls are skipped. The ability is not a standalone no-attack action.
- John Price gains applicable abilities only after completing a move to a non-colony location and loses them after completing a move away.
- John Price may combine multiple abilities present at his location.
- He may copy a once-per-round ability even if the original survivor used it, but John may use his copied version only once that round.
- A copied self-naming ability treats John Price as the named survivor. Copying Forest Plum therefore removes John, not Forest.
- If John is kept alive by Buddy Davis's effect and moves away with three wounds, John dies after the move completes.
- A survivor added during the active player's turn may act immediately but grants no die until the next round's dice step.
- A survivor card is the authoritative game entity. If a malformed card effect removes the card but leaves its standee, the orphan standee does not remain controllable; reconciliation must remove or disable it and report the content error.

### 18.4 Crossroads cards

- Resolve movement and its exposure before checking a movement trigger.
- `Bev Russell` counts as a survivor for zombie-generation totals while present, but cannot be selected as an overrun casualty because she cannot be killed and has no influence.
- If `Old Divisions` resolves its thumbs-up option, remove existing crisis contributions without revealing them.
- `Outbreak` is voted on only by players with at least one survivor at the colony.
- The player holding/drawing `This Taste Funny` is not intended to trigger it themselves.
- Read all option outcomes before the affected player chooses.

### 18.5 Items

- An item with `EVENT` or `OUTSIDER` text is still an item card if it came from a starter/location item deck.
- Two copies of the same item may be equipped to one survivor unless that card says otherwise.
- Baseball Bat killing two zombies causes two exposure rolls.
- Megaphone uses Attract capacity rules and cannot move zombies into a full destination or cause an overrun.
- Switchblade modifies the required attack die and does not itself replace the attack.
- Once-per-round item state does not reset when its survivor dies and it returns to hand, when it is re-equipped, or when it is handed off.

## 19. Gameplay variants

### 19.1 Cooperative variant

- Use the hardcore side of the chosen main objective.
- Do not deal secret objectives.
- Remove every card marked with the non-cooperative symbol.
- Disable exile votes.
- Every player's sole objective is completion of the main objective.

### 19.2 Two-player cooperative variant

Use all cooperative rules, plus:

- Deal seven starter items to each player instead of five.
- Deal four survivors to each player and keep three instead of two.

### 19.3 Betrayer variant

During secret-objective setup, set aside only one non-betrayal objective per player before adding one betrayal objective. This increases the chance that the betrayal objective is dealt. All other standard rules remain unchanged.

### 19.4 Hardcore variant

Use the hardcore side of the selected main objective while otherwise using normal mode rules, including secret objectives unless another selected variant removes them.

### 19.5 Player-elimination variant

When a player's last survivor is killed or otherwise lost:

- Remove all cards in that player's hand from the game.
- Do not draw a replacement survivor.
- Remove that player from turn order and future participation.

The source does not define special handling if elimination leaves no active players; treat that state as an immediate loss for all unless licensed card text supplies a different result.

### 19.6 Optional Prisoner's Dilemma two-player variant

This variant comes from the rulings document and includes designer/community guidance rather than the core rulebook. Present it as experimental.

- Begin from the two-player cooperative setup, but deal each player one regular secret objective and one betrayal secret objective.
- If the main objective completes, a player wins only if their regular secret objective is complete.
- If morale reaches zero, exactly one player who completed their betrayal objective wins; if both or neither did, both lose.

The document additionally recommends:

- Treat round-track zero the same as morale-track zero.
- Do not remove cards carrying the non-cooperative symbol.
- Remove crossroads cards and other content that depends on exiled survivors.

Because those three points are presented as personal suggestions, expose them as the variant's documented defaults or separate toggles rather than silently treating them as immutable base rules.

## 20. Authoritative digital state and effect architecture

At minimum, the authoritative match state must retain:

- Rules/content version, selected modes, mature-content filter, and RNG seed/position.
- Current round, phase, step, active player, first player, and ordered locations.
- Morale, rounds, food, starvation, waste, crisis, and main-objective state.
- Every entrance space, barricade, zombie, survivor space, and noise token.
- Every player, survivor, wound, item, hand, objective, exile state, die, move allowance, and usage flag.
- Exact order of every deck and discard/bottom/removed/returned zone.
- Pending effect stack/queue, choices, rolls, trigger windows, and deferred morale checkpoint.
- Public and private event-log projections.

Use a single authoritative rules engine. Clients may preview legal actions, but the server/host must revalidate them against current state.

Every mutation should be an explicit event, including:

- Die rolled/spent/modified.
- Card drawn, moved between zones, revealed, or removed.
- Action begun and fully resolved.
- Exposure and bite propagation.
- Wound and death cleanup.
- Zombie placement, barricade destruction, and overrun.
- Morale checkpoint and game-end evaluation.
- Crossroads trigger and option resolution.
- Vote commitment/reveal/result.

Atomic effect resolution is essential. Do not let network latency or another client's card play interrupt a death, bite chain, overrun, or card transaction.

## 21. User-interface and online-play requirements

The UI must:

- Show the exact phase/step and current chooser.
- Show legal die assignments and why a die/action is illegal.
- Show every survivor's thresholds, wounds, frostbite, move availability, equipment, and ability usage.
- Keep hands, searches, secret objectives, and untriggered crossroads private.
- Show public hand/deck/contribution counts without showing identities.
- Present crisis contributions face down and main-objective contributions face up.
- Present crossroads cards privately to the player on the right, then reveal all option text when triggered.
- Require simultaneous secret vote commitments before revealing votes.
- Explain automatic zombie placement entrance by entrance.
- Pause for casualty choices, bite decisions, first-player ordering choices, objective contributions, and legal card-effect choices.
- Prevent moving an exiled survivor to the colony.
- Prevent over-capacity survivor, zombie, barricade, and noise placement.
- Prevent ordinary item play while another effect is resolving.
- Make the direction of player turns and first-player passing unambiguous.

For disconnection/reconnection, preserve private hand/objective/crossroads information for the same authenticated player without exposing it to replacements or spectators. A timed game may automate only choices covered by an explicit product rule; the board game itself provides no turn timer.

## 22. Determinism, logs, and testability

- Record a match seed or replayable random stream.
- Record the before/after state and public explanation for every automatic rule transition.
- Keep a secure full audit log and a redacted player-visible log.
- Replaying the initial state and full event stream must reproduce deck orders, dice, random thefts, effects, and final winners.
- Card scripts must be versioned with the match so a later content patch does not change an in-progress or replayed game.
- A rules error must fail closed with the pending state preserved for recovery; it must not discard hidden choices or silently skip effects.

## 23. Acceptance criteria

A complete implementation must demonstrate all of the following:

1. A standard game can be set up for every supported player count with the correct objective, betrayal probability, starting hand, survivors, colony placement, and first player.
2. Cooperative, two-player, betrayer, hardcore, player-elimination, and Prisoner's Dilemma setup changes are isolated and reproducible.
3. Dice are group resources, new survivors do not grant mid-round dice, and frostbite deaths occur after dice are rolled but before that player's actions.
4. Every die and no-die action enforces thresholds, locations, capacities, move limits, exile restrictions, and card timing.
5. Search privacy/noise, crisis secrecy/scoring, waste ordering, food/starvation persistence, and objective contribution visibility work exactly as specified.
6. Zombie attacks, survivor attacks, kill-versus-remove semantics, exposure, frostbite, bite chains, and last-survivor replacement pass deterministic tests.
7. Colony entrance cycling, barricade destruction, overruns, casualty choice, non-colony placement, and noise-generated zombies resolve in the correct order.
8. Morale-zero termination is immediate except at the three defined Add Zombies checkpoints.
9. Crossroads cards are drawn by the right-hand player, trigger only for the active player after a triggering action fully resolves, and preserve option legality.
10. Exile relocation, exposure, no-space swapping, objective adjustment, action restrictions, allowed interactions, and the two-non-betrayer-exiles loss condition all work.
11. Card effects cannot interrupt active effects, card text overrides only conflicting general rules, and once-per-round state survives item transfers.
12. Main-objective completion is checked only at the correct phase boundary, while morale and round failures suppress a final objective check.
13. Winner evaluation supports multiple winners and an all-lose result without exposing hidden objectives before required.
14. All named errata and card rulings in section 18 have targeted regression tests.
15. Reconnection and replay preserve authorized hidden information and reproduce every random result.

## 24. Explicit implementation decisions still needed

The supplied PDFs leave a few low-frequency details unstated. Resolve these before declaring rules parity, document the chosen policy, and add tests:

- Initial first-player tie between equal-influence group leaders.
- Exact canonical non-colony "location order" if the licensed component data does not already define it.
- Ordering of multiple unkept search cards placed on the bottom of a location deck.
- Mandatory last-survivor replacement when a non-exiled player's replacement must enter a completely full colony.
- Any behavior beyond the physical morale maximum of 10 when an effect gains morale at 10.
- All card-specific choices and edge cases found only in the complete licensed card catalog, not in the supplied PDFs.

These decisions should be isolated as rules-policy functions or content metadata so an authoritative later ruling can replace them without rewriting phase logic.
