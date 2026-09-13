/**
 * Exact catalog retained for matches created before the Crossroads timing fix.
 *
 * Persisted matches pin `dow-base@0.5.0-dev`, and their audit hashes were made
 * with these definitions. Keeping the historical pack registered lets those
 * matches continue without silently changing their rules mid-game.
 */

import type { ContentPack, CrossroadsCardDefinition } from '../schema.js';
import { BASE_PACK } from './index.js';

const LEGACY_CROSSROADS = {
  'xr-f53': {
    name: 'After the Count',
    story: 'The crisis count is finished, but one contributor keeps a hand on the table.',
    trigger: { event: 'crisisResolved', crisisOutcome: 'any' },
  },
  'xr-f54': {
    name: 'The Failed Alarm',
    story: 'The crisis alarm fails after the resolution, leaving the colony to choose its own warning.',
    trigger: { event: 'crisisResolved', crisisOutcome: 'failed' },
  },
  'xr-f55': {
    name: 'A Narrow Success',
    story: 'The crisis is prevented by one card, and the colony argues about whether that was enough.',
    trigger: { event: 'crisisResolved', crisisOutcome: 'prevented' },
  },
  'xr-f56': {
    story: 'The resolved crisis leaves a scatter of cards on the floor and a draft under the door.',
    trigger: { event: 'crisisResolved', crisisOutcome: 'any' },
  },
  'xr-f57': {
    story: 'The crisis relief arrives with a cost written in a language nobody can translate.',
    trigger: { event: 'crisisResolved', crisisOutcome: 'failed' },
  },
  'xr-f58': {
    story: 'The crisis stores are divided, and one player quietly receives a larger share than the others.',
    trigger: { event: 'crisisResolved', crisisOutcome: 'prevented' },
  },
  'xr-f59': {
    story: 'The crisis ledger closes with no signature, only a thumbprint in the margin.',
    trigger: { event: 'crisisResolved', crisisOutcome: 'any' },
  },
  'xr-f67': {
    name: 'Round-End Frost',
    story: 'At the end of the round, frost closes the outside latch before anyone reaches it.',
    trigger: { event: 'roundEnd' },
  },
  'xr-f68': {
    name: 'The Round-End Inventory',
    story: 'The round-end inventory finds one crate listed twice and another crate not listed at all.',
    trigger: { event: 'roundEnd' },
  },
  'xr-f69': {
    story: 'The round ends with footprints around the colony, but none cross the threshold.',
    trigger: { event: 'roundEnd' },
  },
  'xr-f70': {
    story: 'Dawn refuses to arrive at the end of the round, leaving the colony lit by blue snow.',
    trigger: { event: 'roundEnd' },
  },
  'xr-f71': {
    story: 'The snowbank beside the colony collapses at round end, revealing a path that was not there before.',
    trigger: { event: 'roundEnd' },
  },
  'xr-f72': {
    story: 'An unsent letter is found in the round-end post box, addressed to someone beyond the fence.',
    trigger: { event: 'roundEnd' },
  },
} satisfies Record<
  string,
  Partial<Pick<CrossroadsCardDefinition, 'name' | 'story' | 'trigger'>>
>;

export const LEGACY_BASE_PACK: ContentPack = {
  ...BASE_PACK,
  version: '0.5.0-dev',
  crossroads: BASE_PACK.crossroads.map((card) => ({
    ...card,
    ...(LEGACY_CROSSROADS[card.id as keyof typeof LEGACY_CROSSROADS] ?? {}),
  })),
};
