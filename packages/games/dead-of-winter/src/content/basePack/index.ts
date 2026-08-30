/**
 * The authored Dead of Winter base catalog.
 *
 * Content is assembled here so the plugin has one stable, versioned pack to
 * register. The card text is original work shaped to the requirements; the
 * published retail card text is not reproduced here.
 */

import { TEST_PACK } from '../testPack.js';
import type { ContentPack } from '../schema.js';
import { BASE_CRISES } from './crises.js';
import { BASE_CROSSROADS } from './crossroads.js';
import { BASE_LOCATION_ITEMS } from './itemsLocations.js';
import { BASE_MAIN_OBJECTIVES } from './objectivesMain.js';
import { BASE_SECRET_OBJECTIVES } from './objectivesSecret.js';
import { BASE_STARTER_ITEMS } from './itemsStarter.js';
import { BASE_SURVIVORS } from './survivors.js';

export const BASE_PACK_STATUS = {
  shipping: true,
  kind: 'authored-development',
  reason: 'All §2.0 card families are authored original content; published retail text is not reproduced.',
  fixtureBackedFamilies: [] as const,
  authoredFamilies: [
    'items',
    'survivors',
    'crises',
    'crossroads',
    'mainObjectives',
    'secretObjectives',
  ] as const,
} as const;

export const BASE_PACK: ContentPack = {
  id: 'dow-base',
  version: '0.5.0-dev',
  name: 'Dead of Winter Development Pack',
  rulesVersion: TEST_PACK.rulesVersion,
  colony: TEST_PACK.colony,
  locations: TEST_PACK.locations,
  exposureDie: TEST_PACK.exposureDie,
  survivors: BASE_SURVIVORS,
  crises: BASE_CRISES,
  crossroads: BASE_CROSSROADS,
  items: [...BASE_STARTER_ITEMS, ...BASE_LOCATION_ITEMS],
  mainObjectives: BASE_MAIN_OBJECTIVES,
  secretObjectives: BASE_SECRET_OBJECTIVES,
};

export default BASE_PACK;
