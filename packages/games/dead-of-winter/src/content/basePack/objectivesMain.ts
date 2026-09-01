/**
 * Original dual-sided main-objective catalog for the Dead of Winter base pack.
 *
 * The two §18.2 named objectives are retained verbatim from the engine fixture
 * because the requirements document makes their definitions part of the
 * executable authoring contract. Every other card in this file is new content.
 */

import type { MainObjectiveDefinition } from '../schema.js';

export const BASE_MAIN_OBJECTIVES: MainObjectiveDefinition[] = [
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
    id: 'mo-ashen-gates',
    name: 'Ashen Gates',
    standard: {
      text: 'Hold two barricades at the colony and reduce the outside horde to four zombies or fewer.',
      startingMorale: 8,
      startingRounds: 7,
      setup: [
        { kind: 'addZombies', count: 1, location: { kind: 'eachNonColony' } },
        { kind: 'addBarricade', count: 1, location: { kind: 'colony' } },
      ],
      completion: {
        kind: 'all',
        of: [
          { kind: 'barricadesAt', location: { kind: 'colony' }, atLeast: 2 },
          { kind: 'zombiesAt', location: { kind: 'eachNonColony' }, atMost: 4 },
        ],
      },
    },
    hardcore: {
      text: 'Hold three barricades at the colony and reduce the outside horde to three zombies or fewer.',
      startingMorale: 7,
      startingRounds: 6,
      setup: [
        { kind: 'addZombies', count: 1, location: { kind: 'eachNonColony' } },
        { kind: 'addBarricade', count: 1, location: { kind: 'colony' } },
      ],
      completion: {
        kind: 'all',
        of: [
          { kind: 'barricadesAt', location: { kind: 'colony' }, atLeast: 3 },
          { kind: 'zombiesAt', location: { kind: 'eachNonColony' }, atMost: 3 },
        ],
      },
    },
  },
  {
    id: 'mo-ration-wardens',
    name: 'Ration Wardens',
    standard: {
      text: 'At the colony-phase check, keep at least seven food in the stores and no starvation tokens.',
      startingMorale: 8,
      startingRounds: 7,
      setup: [{ kind: 'adjustFood', amount: 2 }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'food', atLeast: 7 },
          { kind: 'not', of: { kind: 'starvationTokens', atLeast: 1 } },
        ],
      },
    },
    hardcore: {
      text: 'At the colony-phase check, keep at least eight food in the stores and no starvation tokens.',
      startingMorale: 7,
      startingRounds: 6,
      setup: [{ kind: 'adjustFood', amount: 1 }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'food', atLeast: 8 },
          { kind: 'not', of: { kind: 'starvationTokens', atLeast: 1 } },
        ],
      },
    },
  },
  {
    id: 'mo-cold-storage',
    name: 'Cold Storage',
    standard: {
      text: 'Place four non-starter food or medicine cards face up here, adding no more than three in one turn.',
      startingMorale: 9,
      startingRounds: 8,
      setup: [],
      completion: {
        kind: 'objectiveContributions',
        requirement: { symbols: ['food', 'medicine'], excludeStarter: true },
        atLeast: 4,
      },
      contribution: {
        requirement: { symbols: ['food', 'medicine'], excludeStarter: true },
        maxPerTurn: 3,
      },
    },
    hardcore: {
      text: 'Place six non-starter food or medicine cards face up here, adding no more than two in one turn.',
      startingMorale: 7,
      startingRounds: 7,
      setup: [],
      completion: {
        kind: 'objectiveContributions',
        requirement: { symbols: ['food', 'medicine'], excludeStarter: true },
        atLeast: 6,
      },
      contribution: {
        requirement: { symbols: ['food', 'medicine'], excludeStarter: true },
        maxPerTurn: 2,
      },
    },
  },
  {
    id: 'mo-last-lantern',
    name: 'Last Lantern',
    standard: {
      text: 'Clear the library and leave at least one survivor there at the colony-phase check.',
      startingMorale: 8,
      startingRounds: 6,
      setup: [{ kind: 'addZombies', count: 1, location: { kind: 'fixed', location: 'library' } }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'survivorsAt', location: { kind: 'fixed', location: 'library' }, atLeast: 1 },
          { kind: 'zombiesAt', location: { kind: 'fixed', location: 'library' }, atMost: 0 },
        ],
      },
    },
    hardcore: {
      text: 'Clear the library and leave at least two survivors there at the colony-phase check.',
      startingMorale: 7,
      startingRounds: 6,
      setup: [{ kind: 'addZombies', count: 2, location: { kind: 'fixed', location: 'library' } }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'survivorsAt', location: { kind: 'fixed', location: 'library' }, atLeast: 2 },
          { kind: 'zombiesAt', location: { kind: 'fixed', location: 'library' }, atMost: 0 },
        ],
      },
    },
  },
  {
    id: 'mo-embers-of-knowledge',
    name: 'Embers of Knowledge',
    standard: {
      text: 'Station at least one survivor at the school and contribute three education cards, adding no more than three in one turn.',
      startingMorale: 9,
      startingRounds: 7,
      setup: [{ kind: 'addZombies', count: 1, location: { kind: 'fixed', location: 'school' } }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'survivorsAt', location: { kind: 'fixed', location: 'school' }, atLeast: 1 },
          { kind: 'objectiveContributions', requirement: { symbols: ['education'] }, atLeast: 3 },
        ],
      },
      contribution: { requirement: { symbols: ['education'] }, maxPerTurn: 3 },
    },
    hardcore: {
      text: 'Station at least two survivors at the school and contribute five education cards, adding no more than two in one turn.',
      startingMorale: 7,
      startingRounds: 6,
      setup: [{ kind: 'addZombies', count: 2, location: { kind: 'fixed', location: 'school' } }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'survivorsAt', location: { kind: 'fixed', location: 'school' }, atLeast: 2 },
          { kind: 'objectiveContributions', requirement: { symbols: ['education'] }, atLeast: 5 },
        ],
      },
      contribution: { requirement: { symbols: ['education'] }, maxPerTurn: 2 },
    },
  },
  {
    id: 'mo-watch-the-walls',
    name: 'Watch the Walls',
    standard: {
      text: 'At the colony-phase check, keep at least one survivor at the colony, one beyond the walls, and one barricade beyond the walls.',
      startingMorale: 8,
      startingRounds: 7,
      setup: [{ kind: 'addZombies', count: 1, location: { kind: 'colony' } }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'survivorsAt', location: { kind: 'colony' }, atLeast: 1 },
          { kind: 'survivorsAt', location: { kind: 'eachNonColony' }, atLeast: 1 },
          { kind: 'barricadesAt', location: { kind: 'eachNonColony' }, atLeast: 1 },
        ],
      },
    },
    hardcore: {
      text: 'At the colony-phase check, keep at least one survivor at the colony, two beyond the walls, and two barricades beyond the walls.',
      startingMorale: 7,
      startingRounds: 6,
      setup: [{ kind: 'addZombies', count: 2, location: { kind: 'colony' } }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'survivorsAt', location: { kind: 'colony' }, atLeast: 1 },
          { kind: 'survivorsAt', location: { kind: 'eachNonColony' }, atLeast: 2 },
          { kind: 'barricadesAt', location: { kind: 'eachNonColony' }, atLeast: 2 },
        ],
      },
    },
  },
  {
    id: 'mo-raiding-party',
    name: 'Raiding Party',
    standard: {
      text: 'Resolve the applicable Bev Russell option.',
      startingMorale: 8,
      startingRounds: 8,
      setup: [],
      counters: [{ id: 'bevRussellOptions', label: 'Bev Russell options', start: 0 }],
      completion: { kind: 'counter', counter: 'bevRussellOptions', atLeast: 1 },
    },
    hardcore: {
      text: 'Resolve the applicable Bev Russell option.',
      startingMorale: 6,
      startingRounds: 7,
      setup: [],
      counters: [{ id: 'bevRussellOptions', label: 'Bev Russell options', start: 0 }],
      completion: { kind: 'counter', counter: 'bevRussellOptions', atLeast: 1 },
    },
  },
  {
    id: 'mo-winter-ward',
    name: 'Winter Ward',
    standard: {
      text: 'Protect at least one helpless survivor, keep two barricades at the colony, and finish with morale at least five.',
      startingMorale: 8,
      startingRounds: 7,
      setup: [{ kind: 'addHelpless', count: 1 }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'helplessSurvivors', atLeast: 1 },
          { kind: 'barricadesAt', location: { kind: 'colony' }, atLeast: 2 },
          { kind: 'morale', atLeast: 5 },
        ],
      },
    },
    hardcore: {
      text: 'Protect at least two helpless survivors, keep three barricades at the colony, and finish with morale at least four.',
      startingMorale: 7,
      startingRounds: 6,
      setup: [{ kind: 'addHelpless', count: 2 }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'helplessSurvivors', atLeast: 2 },
          { kind: 'barricadesAt', location: { kind: 'colony' }, atLeast: 3 },
          { kind: 'morale', atLeast: 4 },
        ],
      },
    },
  },
];
