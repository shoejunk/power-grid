/**
 * The authored Dead of Winter base catalog.
 *
 * Content is assembled here so the plugin has one stable, versioned pack to
 * register. The authored item decks are already in this directory; the
 * remaining card families continue to be replaced from the fixture as the
 * catalog is completed, and are deliberately visible in the manifest checks.
 */

import { TEST_PACK } from '../testPack.js';
import type { ContentPack, MainObjectiveDefinition, SecretObjectiveDefinition } from '../schema.js';
import { BASE_LOCATION_ITEMS } from './itemsLocations.js';
import { BASE_STARTER_ITEMS } from './itemsStarter.js';

export const BASE_PACK: ContentPack = {
  ...TEST_PACK,
  id: 'dow-base',
  version: '0.2.0',
  name: 'Dead of Winter Base Catalog',
  items: [...BASE_STARTER_ITEMS, ...BASE_LOCATION_ITEMS],
  // These authored entries replace fixture placeholders while keeping the
  // manifest count stable. They make the named public-boundary rulings
  // playable without arranging hidden state inside a test.
  mainObjectives: TEST_PACK.mainObjectives.map((objective): MainObjectiveDefinition =>
    objective.id === 'mo-f7'
      ? {
          id: 'mo-old-divisions-public',
          name: 'A Place for Everyone',
          standard: {
            text: 'Survive one round after bringing one helpless survivor into the colony.',
            startingMorale: 8,
            startingRounds: 3,
            setup: [{ kind: 'addHelpless', count: 1 }],
            completion: { kind: 'roundsSurvived', atLeast: 1 },
          },
          hardcore: {
            text: 'Survive two rounds after bringing one helpless survivor into the colony.',
            startingMorale: 7,
            startingRounds: 3,
            setup: [{ kind: 'addHelpless', count: 1 }],
            completion: { kind: 'roundsSurvived', atLeast: 2 },
          },
        }
      : objective,
  ),
  secretObjectives: TEST_PACK.secretObjectives.map((objective): SecretObjectiveDefinition =>
    objective.id === 'so-n24'
      ? {
          id: 'so-hunger',
          name: 'Hunger',
          text: 'End the game with at least three food cards in your hand or equipped.',
          kind: 'nonBetrayal',
          completion: {
            kind: 'holdsCards',
            player: { kind: 'effectController' },
            requirement: { symbols: ['food'] },
            atLeast: 3,
            includeEquipped: true,
          },
          nonCooperative: false,
          matureContent: false,
        }
      : objective,
  ),
};

export default BASE_PACK;
