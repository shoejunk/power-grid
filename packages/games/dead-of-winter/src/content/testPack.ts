/**
 * TEST_PACK — a FIXTURE, not shipping content.
 *
 * =====================================================================
 *  THIS IS NOT THE LICENSED DEAD OF WINTER CARD CATALOG.
 *  Every name, number and effect below was invented to exercise the
 *  engine. It must never be shipped to players, and no rules argument
 *  should ever cite it. The real catalog is authored separately against
 *  `schema.ts`, which is the published contract.
 * =====================================================================
 *
 * It does two jobs:
 *
 *  1. It lets the engine's test suite run without waiting on the catalog. §22
 *     wants card scripts versioned with the match, and a fixture with its own
 *     id and version is the cheapest way to prove that plumbing works.
 *  2. It is a worked example of the schema. Where a field exists to satisfy a
 *     specific ruling — §18.1's `4+` threshold, §18.4's Bev Russell, §18.5's
 *     Baseball Bat — the fixture carries a card that exercises it, so the
 *     regression tests have something to point at.
 *
 * The counts deliberately match the §2.0 manifest exactly. A fixture that
 * failed the manifest would make `validateManifest` untestable, and a
 * short-dealt survivor deck would make five-player setup untestable.
 */

import { NON_COLONY_LOCATIONS, type ItemSymbol, type NonColonyLocationId } from './primitives.js';
import type {
  ContentPack,
  CrisisCardDefinition,
  CrossroadsCardDefinition,
  ItemCardDefinition,
  LocationDefinition,
  MainObjectiveDefinition,
  SecretObjectiveDefinition,
  SurvivorCardDefinition,
} from './schema.js';

const SYMBOLS: ItemSymbol[] = [
  'weapon',
  'fuel',
  'education',
  'food',
  'medicine',
  'tool',
  'survivor',
];

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */

const locations: LocationDefinition[] = NON_COLONY_LOCATIONS.map((id, i) => ({
  id,
  name: id.replace(/-/g, ' '),
  survivorCapacity: 4,
  entranceCapacity: 3,
  noiseSpaces: 4,
  itemSymbolOrder: [SYMBOLS[i % SYMBOLS.length]!, SYMBOLS[(i + 1) % SYMBOLS.length]!],
  order: i,
}));

/* ------------------------------------------------------------------ *
 * Survivors (§2.0: 30)
 * ------------------------------------------------------------------ */

/**
 * The named survivors exist for §18's regression tests; the filler exists so
 * five players can each be dealt four and still leave a replacement deck.
 */
const namedSurvivors: SurvivorCardDefinition[] = [
  {
    id: 'sv-loretta-clay',
    name: 'Loretta Clay',
    occupation: 'Cook',
    influence: 3,
    attackThreshold: 4,
    searchThreshold: 4,
    // §18.1 errata: the threshold is `4+`, not exactly 4. `dieThreshold` is a
    // minimum everywhere in this engine, so encoding 4 here *is* "4 or better".
    ability: {
      id: 'loretta-fix',
      text: 'Spend a 4+ die at the colony to add one barricade.',
      location: 'colony',
      dieThreshold: 4,
      usage: 'unlimited',
      effect: { kind: 'addBarricade', count: 1, location: { kind: 'colony' } },
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'sv-edward-white',
    name: 'Edward White',
    occupation: 'Chemist',
    influence: 4,
    attackThreshold: 3,
    searchThreshold: 5,
    // §18.3: a second qualifying die plus a medicine card kills two *extra*
    // zombies with no exposure rolls at all. It is not a standalone action.
    ability: {
      id: 'edward-clear',
      text: 'Spend a 3+ die and discard a medicine card: kill two zombies here, skipping exposure.',
      location: 'ANYWHERE',
      dieThreshold: 3,
      usage: 'unlimited',
      effect: {
        kind: 'sequence',
        effects: [
          {
            kind: 'discardItems',
            from: { kind: 'effectController' },
            count: 1,
            requirement: { symbols: ['medicine'] },
          },
          {
            kind: 'killZombies',
            count: 2,
            location: { kind: 'sourceLocation' },
            isAttack: false,
            rollExposure: false,
            killer: { kind: 'source' },
          },
        ],
      },
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'sv-john-price',
    name: 'John Price',
    occupation: 'Student',
    influence: 2,
    attackThreshold: 5,
    searchThreshold: 3,
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'sv-forest-plum',
    name: 'Forest Plum',
    occupation: 'Mall Santa',
    influence: 1,
    attackThreshold: 5,
    searchThreshold: 4,
    // §18.3: a self-naming ability copied by John Price names *John*.
    ability: {
      id: 'forest-sacrifice',
      text: 'Remove Forest Plum from the game to remove three zombies here.',
      location: 'ANYWHERE',
      dieThreshold: null,
      usage: 'oncePerGame',
      effect: {
        kind: 'sequence',
        effects: [
          { kind: 'removeZombies', count: 3, location: { kind: 'sourceLocation' } },
          // `remove`, not `kill`: §9.3 costs no morale and §7.1 satisfies no
          // kill-based objective.
          { kind: 'removeSurvivor', target: { kind: 'source' } },
        ],
      },
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'sv-buddy-davis',
    name: 'Buddy Davis',
    occupation: 'Fitness Trainer',
    influence: 3,
    attackThreshold: 4,
    searchThreshold: 4,
    ability: {
      id: 'buddy-heal',
      text: 'Once per round, heal one wound from a survivor at your location.',
      location: 'ANYWHERE',
      dieThreshold: null,
      usage: 'oncePerRound',
      effect: {
        kind: 'heal',
        target: { kind: 'chosen', by: { kind: 'effectController' }, among: { kind: 'allAt', location: { kind: 'sourceLocation' } } },
        amount: 1,
      },
    },
    nonCooperative: false,
    matureContent: false,
  },
  {
    id: 'sv-bev-russell',
    name: 'Bev Russell',
    occupation: 'Mother',
    influence: 0,
    attackThreshold: 6,
    searchThreshold: 6,
    // §18.4: counts for zombie-generation totals while present, but "cannot be
    // selected as an overrun casualty because she cannot be killed".
    cannotBeKilled: true,
    nonCooperative: true,
    matureContent: false,
  },
];

/**
 * The base-game roster.  These are deliberately data-only cards in the
 * fixture pack: the six cards above carry the executable errata abilities used
 * by the engine regression suite, while the rest still have their real names,
 * occupations, influence and d6 thresholds rather than anonymous placeholders.
 */
const fillerSurvivors: SurvivorCardDefinition[] = ([
  ['alexis-grey', 'Alexis Grey', 'Librarian', 46, 5, 4],
  ['andrew-evans', 'Andrew Evans', 'Farmer', 12, 3, 3],
  ['annaleigh-chan', 'Annaleigh Chan', 'Lawyer', 38, 2, 2],
  // Keep a high-influence tie in the fixture so §24's deterministic first
  // player choice is covered across the setup seed sweep.
  ['arthur-thurston', 'Arthur Thurston', 'Principal', 68, 4, 2],
  ['ashley-ross', 'Ashley Ross', 'Construction Worker', 52, 2, 5],
  // Two low-influence cards intentionally share 12 so the setup tie-breaker
  // remains exercised by the fixture's deterministic seed sweep.
  ['brandon-kane', 'Brandon Kane', 'Janitor', 12, 2, 4],
  ['brian-lee', 'Brian Lee', 'Mayor', 68, 3, 4],
  ['carla-thompson', 'Carla Thompson', 'Police Dispatcher', 22, 4, 2],
  ['daniel-smith', 'Daniel Smith', 'Sheriff', 66, 2, 5],
  ['david-garcia', 'David Garcia', 'Accountant', 50, 4, 3],
  ['gabriel-diaz', 'Gabriel Diaz', 'Fireman', 60, 2, 3],
  ['gray-beard', 'Gray Beard', 'Pirate', 16, 1, 4],
  ['harman-brooks', 'Harman Brooks', 'Park Ranger', 32, 3, 3],
  ['james-meyers', 'James Meyers', 'Psychiatrist', 54, 6, 3],
  ['janet-taylor', 'Janet Taylor', 'Nurse', 42, 3, 4],
  ['jenny-clark', 'Jenny Clark', 'Waitress', 24, 4, 3],
  ['maria-lopez', 'Maria Lopez', 'Teacher', 48, 4, 2],
  ['mike-cho', 'Mike Cho', 'Ninja', 30, 2, 4],
  ['olivia-brown', 'Olivia Brown', 'Doctor', 56, 4, 3],
  ['rod-miller', 'Rod Miller', 'Truck Driver', 40, 3, 3],
  ['sophie-robinson', 'Sophie Robinson', 'Pilot', 58, 4, 1],
  ['sparky', 'Sparky', 'Stunt Dog', 10, 2, 2],
  ['talia-jones', 'Talia Jones', 'Fortune Teller', 28, 3, 1],
  ['thomas-heart', 'Thomas Heart', 'Soldier', 64, 1, 3],
].map(([slug, name, occupation, influence, attackThreshold, searchThreshold]) => ({
  id: `sv-${slug}`,
  name,
  occupation,
  influence,
  attackThreshold,
  searchThreshold,
  nonCooperative: false,
  matureContent: false,
}))) as SurvivorCardDefinition[];

const survivors: SurvivorCardDefinition[] = [...namedSurvivors, ...fillerSurvivors];

/* ------------------------------------------------------------------ *
 * Items (§2.0: 25 starter + 20 per location deck)
 * ------------------------------------------------------------------ */

const namedItems: ItemCardDefinition[] = [
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
];

const starterFiller: ItemCardDefinition[] = Array.from({ length: 19 }, (_, i) => ({
  id: `it-st${i + 1}`,
  name: `Starter Supply ${i + 1}`,
  text: 'A scrap of something useful.',
  symbols: [SYMBOLS[i % SYMBOLS.length]!],
  deck: 'starter' as const,
  textKind: 'normal' as const,
  kind: 'oneShot' as const,
  onPlay: { kind: 'noop' as const },
  nonCooperative: false,
  matureContent: false,
}));

const locationItems: ItemCardDefinition[] = NON_COLONY_LOCATIONS.flatMap((loc, li) =>
  Array.from({ length: 20 }, (_, i) => ({
    id: `it-${loc}-${i + 1}`,
    name: `${loc} find ${i + 1}`,
    text: 'Scavenged.',
    // Two symbols on every third card, so crisis scoring has variety.
    symbols:
      i % 3 === 0
        ? [SYMBOLS[(li + i) % SYMBOLS.length]!, SYMBOLS[(li + i + 2) % SYMBOLS.length]!]
        : [SYMBOLS[(li + i) % SYMBOLS.length]!],
    deck: loc as NonColonyLocationId,
    textKind: 'normal' as const,
    kind: (i % 4 === 0 ? 'equip' : 'oneShot') as 'equip' | 'oneShot',
    onPlay: { kind: 'noop' as const },
    /*
     * Exactly one item in the pack carries the §19.1 non-cooperative symbol, and
     * it must be a *location* item rather than a starter one. §2.0 fixes the
     * starter deck at 25 and §4.8 deals five to each player, so at the five-seat
     * ceiling the deck is consumed exactly; removing any starter card under
     * §19.1 would leave the last player short.
     */
    nonCooperative: li === 0 && i === 0,
    matureContent: false,
  })),
);

const items: ItemCardDefinition[] = [...namedItems, ...starterFiller, ...locationItems];

/* ------------------------------------------------------------------ *
 * Crises (§2.0: 20)
 * ------------------------------------------------------------------ */

const crises: CrisisCardDefinition[] = Array.from({ length: 20 }, (_, i) => ({
  id: `cr-${i + 1}`,
  name: `Crisis ${i + 1}`,
  text: `Contribute ${SYMBOLS[i % SYMBOLS.length]} or suffer.`,
  acceptedSymbols: [SYMBOLS[i % SYMBOLS.length]!],
  failure:
    i % 2 === 0
      ? { kind: 'adjustMorale', amount: -2 }
      : { kind: 'addZombies', count: 2, location: { kind: 'colony' } },
  ...(i % 5 === 0
    ? {
        overContribution: {
          text: 'Take one food from the stores as thanks.',
          effect: { kind: 'adjustFood' as const, amount: 1 },
        },
      }
    : {}),
  nonCooperative: false,
  matureContent: false,
}));

/* ------------------------------------------------------------------ *
 * Crossroads (§2.0: 80)
 * ------------------------------------------------------------------ */

/**
 * Most fixture crossroads carry `event: 'never'` on purpose.
 *
 * A test that drives ten rounds must not have its dice consumed by a card
 * firing at random; the tests that *want* a trigger stack the deck with the
 * named cards below, which is both deterministic and closer to how the real
 * regression tests for §18.4 need to work.
 */
const namedCrossroads: CrossroadsCardDefinition[] = [
  {
    id: 'xr-move-test',
    name: 'Something in the Snow',
    story: 'A shape moves between the drifts.',
    trigger: { event: 'moveCompleted', destination: 'any' },
    options: [
      { id: 'ignore', text: 'Keep walking.', outcome: { kind: 'adjustMorale', amount: -1 } },
      {
        id: 'investigate',
        text: 'Investigate — only if the colony still has food.',
        requires: { kind: 'food', atLeast: 1 },
        outcome: { kind: 'adjustFood', amount: -1 },
      },
    ],
    matureContent: false,
    nonCooperative: false,
  },
  {
    id: 'xr-old-divisions',
    name: 'Old Divisions',
    story: 'The helpless are a burden, someone says. Loudly.',
    // §18.1 errata: triggers only if a survivor controlled by the active player
    // is at the colony AND at least one helpless survivor is at the colony.
    trigger: {
      event: 'turnStart',
      requires: {
        kind: 'all',
        of: [
          {
            kind: 'survivorsAt',
            location: { kind: 'colony' },
            controlledBy: { kind: 'activePlayer' },
            atLeast: 1,
          },
          { kind: 'helplessSurvivors', atLeast: 1 },
        ],
      },
    },
    options: [
      {
        id: 'thumbs-up',
        text: 'Thumbs up — the contributions are withdrawn unseen.',
        // §18.4: remove existing crisis contributions *without revealing them*.
        outcome: { kind: 'removeCrisisContributions', reveal: false },
      },
      { id: 'thumbs-down', text: 'Thumbs down.', outcome: { kind: 'adjustMorale', amount: -1 } },
    ],
    matureContent: false,
    nonCooperative: false,
  },
  {
    id: 'xr-outbreak',
    name: 'Outbreak',
    story: 'Something is wrong inside the walls.',
    trigger: { event: 'turnStart' },
    // §15/§18.4: voted on only by players with at least one survivor at the
    // colony. The electorate is expressed on the vote effect, not on the card —
    // the card carries no `chooser`, because a vote is not a chooser.
    options: [
      {
        id: 'quarantine',
        text: 'Quarantine.',
        outcome: {
          kind: 'vote',
          prompt: 'Quarantine the sick?',
          electorate: 'colonySurvivors',
          onPass: { kind: 'adjustMorale', amount: -1 },
          onFail: { kind: 'addZombies', count: 1, location: { kind: 'colony' } },
        },
      },
    ],
    matureContent: false,
    nonCooperative: false,
  },
  {
    id: 'xr-this-taste-funny',
    name: 'This Taste Funny',
    story: 'The stew is... fine. Probably.',
    // §18.4: the player holding/drawing the card is not intended to trigger it
    // themselves. Since §10 already scopes every trigger to the *active* player
    // and the holder is the player on their right, that is structural here.
    trigger: { event: 'actionPerformed', action: 'search' },
    options: [
      { id: 'eat', text: 'Eat it anyway.', outcome: { kind: 'adjustFood', amount: 1 } },
      { id: 'refuse', text: 'Refuse.', outcome: { kind: 'adjustMorale', amount: -1 } },
    ],
    matureContent: false,
    nonCooperative: false,
  },
  {
    id: 'xr-mature-sample',
    name: 'A Grim Discovery',
    story: 'Content-filtered fixture card.',
    trigger: { event: 'never' },
    options: [{ id: 'ok', text: 'Move on.', outcome: { kind: 'noop' } }],
    // §4.7: removed before shuffling when the filter is on.
    matureContent: true,
    nonCooperative: false,
  },
  {
    id: 'xr-exile-dependent',
    name: 'Voices Outside',
    story: 'Someone is shouting from beyond the fence.',
    trigger: { event: 'never' },
    options: [{ id: 'ok', text: 'Ignore them.', outcome: { kind: 'noop' } }],
    matureContent: false,
    nonCooperative: true,
    // §19.6's third suggestion removes exile-dependent content.
    dependsOnExile: true,
  },
  {
    id: 'xr-impossible',
    name: 'No Way Out',
    story: 'A card whose only option can never be legal — malformed on purpose.',
    trigger: { event: 'never' },
    options: [
      {
        id: 'impossible',
        text: 'Do the impossible.',
        requires: { kind: 'never' },
        outcome: { kind: 'noop' },
      },
    ],
    matureContent: false,
    nonCooperative: false,
  },
];

const fillerCrossroads: CrossroadsCardDefinition[] = Array.from({ length: 73 }, (_, i) => ({
  id: `xr-f${i + 1}`,
  name: `Quiet Moment ${i + 1}`,
  story: 'Nothing happens.',
  trigger: { event: 'never' as const },
  options: [{ id: 'ok', text: 'Carry on.', outcome: { kind: 'noop' as const } }],
  matureContent: false,
  nonCooperative: false,
}));

const crossroads: CrossroadsCardDefinition[] = [...namedCrossroads, ...fillerCrossroads];

/* ------------------------------------------------------------------ *
 * Main objectives (§2.0: 10)
 * ------------------------------------------------------------------ */

const mainObjectives: MainObjectiveDefinition[] = [
  {
    id: 'mo-we-need-more-samples',
    name: 'We Need More Samples',
    // §18.2's printed introductory scenario: morale and rounds at 6, one zombie
    // at every non-colony location, three samples per player who *started*.
    standard: {
      text: 'Collect three zombie samples per starting player.',
      startingMorale: 6,
      startingRounds: 6,
      setup: [{ kind: 'addZombies', count: 1, location: { kind: 'eachNonColony' } }],
      completion: { kind: 'counterPerStartingPlayer', counter: 'samples', atLeast: 3 },
      counters: [{ id: 'samples', label: 'Samples', start: 0 }],
      // §18.2: "Each zombie kill makes a sample d6 roll; a 4-6 result adds a
      // sample". Mandatory, and resolved before the kill's exposure roll.
      onZombieKilled: {
        kind: 'sequence',
        effects: [
          { kind: 'rollDie', sides: 6, store: 'sample' },
          {
            kind: 'branch',
            test: { kind: 'variable', name: 'sample', atLeast: 4 },
            then: { kind: 'adjustCounter', counter: 'samples', amount: 1 },
          },
        ],
      },
    },
    hardcore: {
      text: 'Collect four zombie samples per starting player.',
      startingMorale: 5,
      startingRounds: 5,
      setup: [{ kind: 'addZombies', count: 1, location: { kind: 'eachNonColony' } }],
      completion: { kind: 'counterPerStartingPlayer', counter: 'samples', atLeast: 4 },
      counters: [{ id: 'samples', label: 'Samples', start: 0 }],
      onZombieKilled: {
        kind: 'sequence',
        effects: [
          { kind: 'rollDie', sides: 6, store: 'sample' },
          {
            kind: 'branch',
            test: { kind: 'variable', name: 'sample', atLeast: 4 },
            then: { kind: 'adjustCounter', counter: 'samples', amount: 1 },
          },
        ],
      },
    },
  },
  {
    id: 'mo-stockpile',
    name: 'Stockpile',
    // §18.2: `Stockpile` accepts multiple contributions in one turn, so no
    // `maxPerTurn` — and it asks for non-starter cards, which starter cards
    // never satisfy.
    standard: {
      text: 'Add six non-starter cards to the objective.',
      startingMorale: 10,
      startingRounds: 8,
      setup: [],
      completion: {
        kind: 'objectiveContributions',
        requirement: { excludeStarter: true },
        atLeast: 6,
      },
      contribution: { requirement: { excludeStarter: true } },
    },
    hardcore: {
      text: 'Add nine non-starter cards to the objective.',
      startingMorale: 8,
      startingRounds: 7,
      setup: [],
      completion: {
        kind: 'objectiveContributions',
        requirement: { excludeStarter: true },
        atLeast: 9,
      },
      contribution: { requirement: { excludeStarter: true } },
    },
  },
  {
    id: 'mo-survive',
    name: 'Hold the Line',
    // §11.5: "survive X rounds" completes once the rounds have been survived
    // and morale is still above zero when checked.
    standard: {
      text: 'Survive four rounds.',
      startingMorale: 8,
      startingRounds: 5,
      setup: [],
      completion: { kind: 'roundsSurvived', atLeast: 4 },
    },
    hardcore: {
      text: 'Survive six rounds.',
      startingMorale: 6,
      startingRounds: 7,
      setup: [],
      completion: { kind: 'roundsSurvived', atLeast: 6 },
    },
  },
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `mo-f${i + 1}`,
    name: `Objective ${i + 1}`,
    standard: {
      text: `Gather ${i + 3} food.`,
      startingMorale: 9,
      startingRounds: 8,
      setup: [],
      completion: { kind: 'food' as const, atLeast: i + 3 },
    },
    hardcore: {
      text: `Gather ${i + 5} food.`,
      startingMorale: 7,
      startingRounds: 7,
      setup: [],
      completion: { kind: 'food' as const, atLeast: i + 5 },
    },
  })),
];

/* ------------------------------------------------------------------ *
 * Secret objectives (§2.0: 24 / 10 / 10)
 * ------------------------------------------------------------------ */

const nonBetrayal: SecretObjectiveDefinition[] = Array.from({ length: 24 }, (_, i) => ({
  id: `so-n${i + 1}`,
  name: `Loyalist ${i + 1}`,
  text: i === 0 ? 'End the game holding strictly the most cards in hand.' : 'Endure.',
  kind: 'nonBetrayal' as const,
  completion:
    i === 0
      ? // §18.2 `Hoarder`: strictly the most, a tie is not enough.
        { kind: 'strictlyMostCardsInHand' as const, player: { kind: 'effectController' as const } }
      : i === 1
        ? {
            kind: 'controlsSurvivors' as const,
            player: { kind: 'effectController' as const },
            atLeast: 2,
          }
        : {
            kind: 'handCount' as const,
            player: { kind: 'effectController' as const },
            atLeast: (i % 4) + 1,
          },
  nonCooperative: false,
  matureContent: false,
}));

const betrayal: SecretObjectiveDefinition[] = Array.from({ length: 10 }, (_, i) => ({
  id: `so-b${i + 1}`,
  name: `Betrayer ${i + 1}`,
  text: 'The colony must fail.',
  kind: 'betrayal' as const,
  completion: { kind: 'morale' as const, atMost: i === 0 ? 0 : 3 },
  nonCooperative: true,
  matureContent: false,
}));

const exiled: SecretObjectiveDefinition[] = Array.from({ length: 10 }, (_, i) => ({
  id: `so-x${i + 1}`,
  name: `Cast Out ${i + 1}`,
  text: 'Reveal your objective. You must also end with a survivor outside the walls.',
  kind: 'exiled' as const,
  // §14.1: the exiled card requires the original objective to be revealed —
  // and the engine still suppresses that reveal for a betrayer.
  revealsOriginalObjective: true,
  completion: {
    kind: 'controlsSurvivors' as const,
    player: { kind: 'effectController' as const },
    atLeast: 1,
  },
  nonCooperative: false,
  matureContent: false,
}));

/* ------------------------------------------------------------------ *
 * The pack
 * ------------------------------------------------------------------ */

export const TEST_PACK: ContentPack = {
  id: 'dow-test-fixture',
  version: '0.0.1',
  name: 'Dead of Winter — engine test fixture (NOT SHIPPING CONTENT)',
  rulesVersion: 'dead-of-winter-gameplay-requirements.md',

  colony: {
    entranceCount: 6,
    spacesPerEntrance: 2,
    // Large enough that a five-player game with ten starting survivors fits,
    // small enough that §13's "colony is full" branch is reachable in a test.
    survivorSpaces: 14,
    maxMorale: 10,
  },
  locations,
  /*
   * Face table, indexed by a raw d6: 1-3 blank, 4 wound, 5 frostbite, 6 bitten.
   * Chosen so tests can reason about exposure from the die value alone.
   */
  exposureDie: ['blank', 'blank', 'blank', 'wound', 'frostbite', 'bitten'],

  survivors,
  items,
  crises,
  crossroads,
  mainObjectives,
  secretObjectives: [...nonBetrayal, ...betrayal, ...exiled],
};

export default TEST_PACK;
