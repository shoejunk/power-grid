/**
 * The authored Dead of Winter base catalog.
 *
 * Content is assembled here so the plugin has one stable, versioned pack to
 * register. This remains a development pack, not a retail release: the
 * authored families in this directory are original content, while the
 * objectives still awaiting a complete catalog are explicitly sourced from
 * the engine fixture below. The provenance is exported and surfaced by the
 * public plugin so matching §2.0 counts cannot be mistaken for a licensed,
 * shipping catalog.
 */

import { TEST_PACK } from '../testPack.js';
import type { ContentPack, MainObjectiveDefinition, SecretObjectiveDefinition } from '../schema.js';
import { BASE_CRISES } from './crises.js';
import { BASE_CROSSROADS } from './crossroads.js';
import { BASE_LOCATION_ITEMS } from './itemsLocations.js';
import { BASE_STARTER_ITEMS } from './itemsStarter.js';
import { BASE_SURVIVORS } from './survivors.js';

/**
 * This boundary is intentionally non-shipping until the licensed card catalog
 * replaces every fixture-backed family. Keep this explicit even while the
 * fixture happens to satisfy the physical §2.0 count table.
 */
export const BASE_PACK_STATUS = {
  shipping: false,
  kind: 'non-shipping',
  reason:
    'The licensed base-game catalog is incomplete; main and secret objectives remain fixture-backed.',
  fixtureBackedFamilies: [
    'mainObjectives',
    'secretObjectives',
  ],
  authoredFamilies: ['items', 'survivors', 'crises', 'crossroads'],
} as const;

export const BASE_PACK: ContentPack = {
  id: 'dow-base',
  version: '0.4.0-dev',
  name: 'Dead of Winter Development Pack (Non-shipping)',
  rulesVersion: TEST_PACK.rulesVersion,
  colony: TEST_PACK.colony,
  locations: TEST_PACK.locations,
  exposureDie: TEST_PACK.exposureDie,
  survivors: BASE_SURVIVORS,
  crises: BASE_CRISES,
  crossroads: BASE_CROSSROADS,
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
