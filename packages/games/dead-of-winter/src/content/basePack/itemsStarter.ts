/**
 * The starter item deck — 25 cards (§2.0), dealt five to a player at setup
 * (§4.8).
 *
 * Three constraints shape everything below.
 *
 *  1. **Nothing here may be `nonCooperative`.** §19.1 removes every card
 *     carrying the non-cooperative symbol, and at the five-seat ceiling §4.8
 *     deals 5 x 5 = 25 out of exactly 25 cards. Pulling one starter card would
 *     leave the last player short, so the §19.1 filter is exercised by a
 *     *location* item instead.
 *  2. **The §18.5 named items are copied verbatim from the engine fixture.**
 *     Baseball Bat, Megaphone, Switchblade, First Aid Kit, Canned Food and
 *     Hostage Situation keep their fixture ids, names, text, effects and
 *     comments, because the §18 regression suite asserts against them.
 *  3. **Symbols are spread deliberately.** The crisis economy (§11.3) scores a
 *     contributed card by symbol and objectives (§8.3) read the same field, so
 *     a deck that leaned on one symbol would make both systems dull. The
 *     distribution across the 25 cards is:
 *
 *       weapon 6 · tool 6 · food 5 · medicine 4 · fuel 4 · education 4 · survivor 4
 *
 *     (33 symbol instances: 17 single-symbol cards and 8 dual-symbol ones.)
 *     Weapons and tools are commonest because that is what a colony scrapes
 *     together first; `survivor` is rarest because another pair of hands is the
 *     scarcest thing in a winter.
 *
 * 8 of the 25 are `equip` and 17 are `oneShot`. §8.1 makes that a real
 * decision: an equipped card is a standing ability but cannot be unequipped
 * voluntarily, so committing one is giving up a crisis contribution.
 *
 * Names and text are original to this pack (AUTHORING.md rule 1).
 */

import type { ItemCardDefinition } from '../schema.js';

export const BASE_STARTER_ITEMS: ItemCardDefinition[] = [
  /* ------------------------------------------------------------------ *
   * §18.5 named items — verbatim from the fixture. Do not "improve".
   * ------------------------------------------------------------------ */

  {
    id: 'it-baseball-bat',
    name: 'Baseball Bat',
    text: 'Kill two zombies at your location.',
    symbols: ['weapon'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    // §18.5: killing two zombies causes *two* exposure rolls. The runner rolls
    // once per zombie, so `count: 2` with `rollExposure` is the whole ruling.
    equippedAbilities: [
      {
        id: 'bat-swing',
        text: 'Kill two zombies at this location.',
        location: 'ANYWHERE',
        dieThreshold: null,
        usage: 'oncePerRound',
        effect: {
          kind: 'killZombies',
          count: 2,
          location: { kind: 'sourceLocation' },
          isAttack: false,
          rollExposure: true,
          killer: { kind: 'source' },
        },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-megaphone',
    name: 'Megaphone',
    text: 'Attract up to two zombies to your location.',
    symbols: ['tool'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    // §18.5: Megaphone "uses Attract capacity rules and cannot move zombies
    // into a full destination or cause an overrun". Modelled as `removeZombies`
    // plus `addZombies` would be wrong — it must go through Attract, so the
    // card carries no effect tree and the action handler owns it.
    onPlay: { kind: 'noop' },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-switchblade',
    name: 'Switchblade',
    text: 'Your attacks may use a die one lower than your attack threshold.',
    symbols: ['weapon'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    // §18.5: "Switchblade modifies the required attack die and does not itself
    // replace the attack" — so it has no ability of its own; the attack action
    // reads the modifier off the equipment.
    attackDieModifier: 1,
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-first-aid',
    name: 'First Aid Kit',
    text: 'Heal one wound.',
    symbols: ['medicine'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    onPlay: {
      kind: 'heal',
      target: {
        kind: 'chosen',
        by: { kind: 'effectController' },
        among: { kind: 'allControlledBy', player: { kind: 'effectController' } },
      },
      amount: 1,
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-canned-food',
    name: 'Canned Food',
    text: 'Add two food to the colony.',
    symbols: ['food'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    onPlay: { kind: 'adjustFood', amount: 2 },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-hostage',
    name: 'Hostage Situation',
    text: 'Take a random card from another player.',
    symbols: ['weapon'],
    deck: 'starter',
    textKind: 'event',
    kind: 'oneShot',
    // §2.4/§18.5: an EVENT card drawn from a starter deck is still an item card.
    onPlay: {
      kind: 'stealRandomCard',
      from: { kind: 'chosen', by: { kind: 'effectController' }, among: 'otherPlayers' },
      to: { kind: 'effectController' },
    },
    // Steals from another player, so thematically non-cooperative — but it is a
    // starter card, and §2.0's 25-card starter deck has no slack at five seats.
    // The §19.1 filter is exercised by a location item instead.
    nonCooperative: false,
    matureContent: false,
  },

  /* ------------------------------------------------------------------ *
   * Weapons and tools — what the colony had in its hands on day one.
   * ------------------------------------------------------------------ */

  {
    id: 'it-crowbar',
    name: 'Bent Crowbar',
    text: 'Equipped survivor: once per round, kill one zombie at this location. Do not roll exposure for that kill.',
    // A crowbar is genuinely both: it opens doors and it caves heads in.
    symbols: ['weapon', 'tool'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    equippedAbilities: [
      {
        id: 'crowbar-lever',
        text: 'Kill one zombie at this location. Do not roll exposure for that kill.',
        location: 'ANYWHERE',
        dieThreshold: null,
        // §7.1: a kill that is not an attack, and the one starter effect that
        // explicitly cancels the exposure roll — the reason to hold this card
        // rather than spend it on a crisis.
        usage: 'oncePerRound',
        effect: {
          kind: 'killZombies',
          count: 1,
          location: { kind: 'sourceLocation' },
          isAttack: false,
          rollExposure: false,
          killer: { kind: 'source' },
        },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-hand-axe',
    name: 'Splitting Axe',
    text: 'Equipped survivor: spend a die showing 4 or higher to kill one zombie at this location. Roll exposure for that kill.',
    symbols: ['weapon', 'tool'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    equippedAbilities: [
      {
        id: 'axe-swing',
        text: 'Kill one zombie at this location. Roll exposure for that kill.',
        location: 'ANYWHERE',
        // §7.7: a numbered ability spends a die meeting or exceeding it, and an
        // unlimited usage may be repeated all turn — the axe is the repeatable
        // counterpart to the crowbar's one free swing.
        dieThreshold: 4,
        usage: 'unlimited',
        effect: {
          kind: 'killZombies',
          count: 1,
          location: { kind: 'sourceLocation' },
          isAttack: false,
          rollExposure: true,
          killer: { kind: 'source' },
        },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-chainsaw',
    name: 'Sputtering Chainsaw',
    text: 'Equipped survivor: once per game, spend a die showing 3 or higher to kill three zombies at this location. Roll exposure once for each zombie killed.',
    symbols: ['weapon', 'fuel'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    equippedAbilities: [
      {
        id: 'chainsaw-pull',
        text: 'Kill three zombies at this location. Roll exposure once for each zombie killed.',
        location: 'ANYWHERE',
        dieThreshold: 3,
        // §18.5: once-per-* state lives on the card instance, so handing the
        // saw off after firing it does not launder a fresh tank of fuel.
        usage: 'oncePerGame',
        effect: {
          kind: 'killZombies',
          count: 3,
          location: { kind: 'sourceLocation' },
          isAttack: false,
          rollExposure: true,
          killer: { kind: 'source' },
        },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-toolbox',
    name: 'Battered Toolbox',
    text: 'Equipped survivor: once per round, either place one barricade in an empty entrance space at this location, or remove one zombie from this location. Removing a zombie is not a kill.',
    symbols: ['tool'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    equippedAbilities: [
      {
        id: 'toolbox-work',
        text: 'Place one barricade in an empty entrance space here, or remove one zombie from this location.',
        location: 'ANYWHERE',
        dieThreshold: null,
        usage: 'oncePerRound',
        effect: {
          kind: 'choice',
          prompt: 'Battered Toolbox',
          chooser: { kind: 'effectController' },
          options: [
            {
              id: 'toolbox-barricade',
              text: 'Place one barricade in an empty entrance space at this location.',
              outcome: { kind: 'addBarricade', count: 1, location: { kind: 'sourceLocation' } },
            },
            {
              id: 'toolbox-clear',
              // §7.1: remove is not kill — no exposure roll, and no credit
              // towards a kill-counting objective. The card says so out loud.
              text: 'Remove one zombie from this location. This is not a kill.',
              outcome: { kind: 'removeZombies', count: 1, location: { kind: 'sourceLocation' } },
            },
          ],
        },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-duct-tape',
    name: 'Half a Roll of Duct Tape',
    text: 'Place two barricades in empty entrance spaces at your location.',
    symbols: ['tool'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    // §7.4/§12: barricades and zombies are mutually exclusive occupants, so the
    // runner places as many of the two as there are empty spaces and stops.
    onPlay: { kind: 'addBarricade', count: 2, location: { kind: 'sourceLocation' } },
    nonCooperative: false,
    matureContent: false,
  },

  /* ------------------------------------------------------------------ *
   * Fuel — the generator, the truck, and the light that draws them in.
   * ------------------------------------------------------------------ */

  {
    id: 'it-siphon-hose',
    name: 'Siphon Hose',
    text: 'Move one survivor you control to any location. Do not roll exposure for that move, and it does not use that survivor’s move for the turn.',
    symbols: ['fuel', 'tool'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    onPlay: {
      kind: 'moveSurvivor',
      target: {
        kind: 'chosen',
        by: { kind: 'effectController' },
        among: { kind: 'allControlledBy', player: { kind: 'effectController' } },
      },
      to: { kind: 'chosen', by: { kind: 'effectController' }, among: 'all' },
      rollExposure: false,
      // §14.1: a move made by card text does not spend the once-per-turn
      // allowance unless the card says it does.
      consumesMoveAllowance: false,
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-road-flare',
    name: 'Road Flare',
    text: 'Remove all noise tokens from your location, then place two noise tokens at a non-colony location of your choice.',
    symbols: ['fuel'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    // §2.1 prints four noise spaces at every non-colony location, so `count: 4`
    // is exactly "all of them"; the colony has none and is unaffected.
    onPlay: {
      kind: 'sequence',
      effects: [
        { kind: 'removeNoise', count: 4, location: { kind: 'sourceLocation' } },
        {
          kind: 'addNoise',
          count: 2,
          location: { kind: 'chosen', by: { kind: 'effectController' }, among: 'nonColony' },
        },
      ],
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-generator-fuel',
    name: 'Jerrycan of Gas',
    text: 'Add one round to the round tracker, then remove one food from the colony.',
    symbols: ['fuel'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    // The one starter card that buys time rather than spends it. Deliberately
    // painful: a round of heat costs a meal.
    onPlay: {
      kind: 'sequence',
      effects: [
        { kind: 'adjustRounds', amount: 1 },
        { kind: 'adjustFood', amount: -1 },
      ],
    },
    nonCooperative: false,
    matureContent: false,
  },

  /* ------------------------------------------------------------------ *
   * Food — the counter §13 starves against.
   * ------------------------------------------------------------------ */

  {
    id: 'it-soup-pot',
    name: 'Pot of Thin Soup',
    text: 'Add one food to the colony and raise morale by one.',
    symbols: ['food'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    onPlay: {
      kind: 'sequence',
      effects: [
        { kind: 'adjustFood', amount: 1 },
        { kind: 'adjustMorale', amount: 1 },
      ],
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-dog-food',
    name: 'Sack of Dog Food',
    text: 'Add three food to the colony, then lower morale by one.',
    symbols: ['food'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    // The largest single food swing in the starter deck, and the only one that
    // costs morale to play — nobody enjoys the meal.
    onPlay: {
      kind: 'sequence',
      effects: [
        { kind: 'adjustFood', amount: 3 },
        { kind: 'adjustMorale', amount: -1 },
      ],
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-seed-packets',
    name: 'Packet of Winter Seed',
    text: 'If the colony has four or more rounds remaining, add three food to the colony. Otherwise add one food to the colony.',
    symbols: ['food', 'education'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    // Worth holding early and nearly worthless late, which is the point.
    onPlay: {
      kind: 'branch',
      test: { kind: 'roundsRemaining', atLeast: 4 },
      then: { kind: 'adjustFood', amount: 3 },
      otherwise: { kind: 'adjustFood', amount: 1 },
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-baby-formula',
    name: 'Tin of Baby Formula',
    text: 'Add one food to the colony and raise morale by two.',
    symbols: ['food', 'medicine'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    onPlay: {
      kind: 'sequence',
      effects: [
        { kind: 'adjustFood', amount: 1 },
        { kind: 'adjustMorale', amount: 2 },
      ],
    },
    nonCooperative: false,
    matureContent: false,
  },

  /* ------------------------------------------------------------------ *
   * Medicine — wounds, and the cold that makes them.
   * ------------------------------------------------------------------ */

  {
    id: 'it-thermal-blanket',
    name: 'Foil Thermal Blanket',
    text: 'Equipped survivor: once per round, heal one wound from a survivor at this location, removing frostbite first.',
    symbols: ['medicine'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    equippedAbilities: [
      {
        id: 'blanket-wrap',
        text: 'Heal one wound from a survivor at this location, removing frostbite first.',
        location: 'ANYWHERE',
        dieThreshold: null,
        usage: 'oncePerRound',
        effect: {
          kind: 'heal',
          target: {
            kind: 'chosen',
            by: { kind: 'effectController' },
            among: { kind: 'allAt', location: { kind: 'sourceLocation' } },
          },
          amount: 1,
          // §9.1: frostbite and ordinary wounds share the track, so which one
          // comes off first is a real choice the card makes for you.
          frostbiteFirst: true,
        },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-pill-bottle',
    name: 'Half-Empty Pill Bottle',
    text: 'Heal two wounds from one survivor you control.',
    symbols: ['medicine'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    // §8.1: a healing effect targeting a legal survivor cannot be refused.
    onPlay: {
      kind: 'heal',
      target: {
        kind: 'chosen',
        by: { kind: 'effectController' },
        among: { kind: 'allControlledBy', player: { kind: 'effectController' } },
      },
      amount: 2,
    },
    nonCooperative: false,
    matureContent: false,
  },

  /* ------------------------------------------------------------------ *
   * Education — the things somebody thought to read.
   * ------------------------------------------------------------------ */

  {
    id: 'it-paperback',
    name: 'Swollen Paperback',
    text: 'If the colony’s morale is 3 or lower, raise morale by two. Otherwise raise morale by one.',
    symbols: ['education'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    onPlay: {
      kind: 'branch',
      test: { kind: 'morale', atMost: 3 },
      then: { kind: 'adjustMorale', amount: 2 },
      otherwise: { kind: 'adjustMorale', amount: 1 },
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-floor-plans',
    name: 'Stolen Floor Plans',
    text: 'Equipped survivor: once per round, after a search is performed, remove one noise token from this location.',
    symbols: ['education'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    equippedAbilities: [
      {
        id: 'plans-quiet-route',
        text: 'Remove one noise token from this location.',
        location: 'ANYWHERE',
        dieThreshold: null,
        usage: 'oncePerRound',
        // A triggered ability rather than an activated one (§7.7): it fires at
        // its printed timing and spends no die. Noise at the colony is a no-op
        // by §2.1, so the card is only ever worth equipping to a scavenger.
        trigger: { event: 'searchPerformed' },
        effect: { kind: 'removeNoise', count: 1, location: { kind: 'sourceLocation' } },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },

  /* ------------------------------------------------------------------ *
   * Survivors — the rarest symbol, and the hardest calls.
   * ------------------------------------------------------------------ */

  {
    id: 'it-shift-roster',
    name: 'Night Watch Roster',
    text: 'Remove two noise tokens from your location, then place one barricade in an empty entrance space there.',
    symbols: ['survivor', 'education'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'oneShot',
    onPlay: {
      kind: 'sequence',
      effects: [
        { kind: 'removeNoise', count: 2, location: { kind: 'sourceLocation' } },
        { kind: 'addBarricade', count: 1, location: { kind: 'sourceLocation' } },
      ],
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-baseball-bat-2',
    name: 'Baseball Bat',
    text: 'Kill two zombies at your location.',
    symbols: ['weapon'],
    deck: 'starter',
    textKind: 'normal',
    kind: 'equip',
    equippedAbilities: [
      {
        id: 'bat-swing',
        text: 'Kill two zombies at this location.',
        location: 'ANYWHERE',
        dieThreshold: null,
        usage: 'oncePerRound',
        effect: {
          kind: 'killZombies',
          count: 2,
          location: { kind: 'sourceLocation' },
          isAttack: false,
          rollExposure: true,
          killer: { kind: 'source' },
        },
      },
    ],
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'it-wanderer',
    name: 'The Wanderer at the Gate',
    text: 'Add one survivor to your control if able, then remove one food from the colony.',
    symbols: ['survivor'],
    deck: 'starter',
    textKind: 'outsider',
    // §2.4/§18.5: an OUTSIDER card from a starter deck is still an item card,
    // and may be contributed to a crisis like any other.
    kind: 'oneShot',
    onPlay: {
      kind: 'sequence',
      effects: [
        // §10: "if able" is explicit, because §13 refuses the addition outright
        // when there is no space rather than half-resolving it.
        { kind: 'ifAble', effect: { kind: 'addSurvivor', to: { kind: 'effectController' }, count: 1 } },
        { kind: 'adjustFood', amount: -1 },
      ],
    },
    nonCooperative: false,
    matureContent: false,
  },
];
