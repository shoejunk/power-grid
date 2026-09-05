/**
 * Regression guard for the §10 crossroads *chooser* contract.
 *
 * The defect this file exists to prevent, recorded as a known debt by run 22
 * and fixed in run 24: `CrossroadsCardDefinition.chooser` used to admit
 * `'activePlayer' | 'vote' | 'firstPlayer'`, while `triggerCrossroads` only ever
 * special-cased `'firstPlayer'` and mapped **everything else** to the active
 * player. A card declaring `chooser: 'vote'` with two or more options would
 * therefore have silently let the active player decide alone — no vote, no
 * electorate, no error, and nothing in the log to show it had happened.
 *
 * `xr-outbreak` declared exactly that and was unaffected only by luck: it has a
 * single option whose outcome *is* a `vote` effect, so the vote happened anyway.
 *
 * The resolution was to narrow the union rather than to build a second, N-ary
 * voting path alongside the binary one. §10's "unless the card specifies a vote"
 * is served by the `vote` **effect**, which is the only place an electorate can
 * be expressed at all — §15 and §18.4 require `Outbreak` to be voted on only by
 * players holding a survivor at the colony, and a bare `chooser` string cannot
 * carry that. So a vote is not a chooser, and the type no longer pretends it is.
 *
 * TypeScript now rejects `chooser: 'vote'` at the call site. These tests cover
 * what the compiler cannot: that the *shipping content* honours the contract,
 * and that a content pack reaching the engine as data (a future authored or
 * downloaded pack, where the compiler is not in the loop) cannot reintroduce the
 * trap unnoticed.
 */

import { describe, expect, it } from 'vitest';

import { BASE_PACK } from '../../content/basePack/index.js';
import { TEST_PACK } from '../../content/testPack.js';
import type { ContentPack, CrossroadsCardDefinition } from '../../content/schema.js';
import type { Effect } from '../../content/effects.js';

/** The only values `triggerCrossroads` actually honours. */
const HONOURED_CHOOSERS = new Set(['activePlayer', 'firstPlayer']);

const PACKS: ReadonlyArray<readonly [string, ContentPack]> = [
  ['BASE_PACK', BASE_PACK],
  ['TEST_PACK', TEST_PACK],
];

/** Walks an effect tree and reports whether any node is a `vote`. */
function containsVote(effect: Effect | undefined): boolean {
  if (!effect || typeof effect !== 'object') return false;
  if ((effect as { kind?: string }).kind === 'vote') return true;
  return Object.values(effect as Record<string, unknown>).some((value) => {
    if (Array.isArray(value)) return value.some((v) => containsVote(v as Effect));
    return typeof value === 'object' && value !== null
      ? containsVote(value as Effect)
      : false;
  });
}

describe('§10 crossroads chooser — the narrowed contract', () => {
  for (const [packName, pack] of PACKS) {
    const cards: readonly CrossroadsCardDefinition[] = pack.crossroads ?? [];

    it(`${packName} declares at least one crossroads card, so these assertions are not vacuous`, () => {
      expect(cards.length).toBeGreaterThan(0);
    });

    it(`${packName} declares no chooser the engine would silently reroute`, () => {
      // The failure mode was silent, so assert on the whole set at once and name
      // every offender — a card-by-card loop would stop at the first.
      const offenders = cards
        .filter((card) => card.chooser !== undefined && !HONOURED_CHOOSERS.has(card.chooser))
        .map((card) => `${card.id} (chooser: ${String(card.chooser)})`);

      expect(offenders).toEqual([]);
    });

    it(`${packName} expresses every table decision as a vote effect, never as a chooser`, () => {
      // §15/§18.4: the electorate lives on the effect. A card that wants the
      // table to decide must say so where an electorate can be carried.
      for (const card of cards) {
        const putsItToTheTable = card.options.some((option) => containsVote(option.outcome));
        if (!putsItToTheTable) continue;

        expect(
          card.chooser,
          `${card.id} holds a vote effect; its electorate must come from that effect, ` +
            'not from a card-level chooser',
        ).not.toBe('vote');
      }
    });
  }

  it('xr-outbreak still puts its decision to a vote with the colony electorate (§15, §18.4)', () => {
    // The card that used to carry `chooser: 'vote'`. Removing the redundant
    // declaration must not have removed the vote itself.
    const outbreak = (BASE_PACK.crossroads ?? []).find((card) => card.id === 'xr-outbreak');
    expect(outbreak, 'xr-outbreak is shipping content and must exist').toBeDefined();
    expect(outbreak!.chooser).toBeUndefined();

    const voteOptions = outbreak!.options.filter((option) => containsVote(option.outcome));
    expect(voteOptions.length).toBeGreaterThan(0);

    for (const option of voteOptions) {
      const outcome = option.outcome as { kind: string; electorate?: string };
      expect(outcome.kind).toBe('vote');
      expect(outcome.electorate).toBe('colonySurvivors');
    }
  });

  it('a multi-option card never carries a chooser that would decide it alone', () => {
    // The precise shape of the original trap: two-plus options plus a chooser
    // the engine does not honour. If a pack ever ships one, this fails loudly
    // instead of the active player quietly deciding for the table.
    for (const [packName, pack] of PACKS) {
      for (const card of pack.crossroads ?? []) {
        if (card.options.length < 2) continue;
        expect(
          card.chooser === undefined || HONOURED_CHOOSERS.has(card.chooser),
          `${packName}/${card.id} has ${card.options.length} options and an unhonoured chooser`,
        ).toBe(true);
      }
    }
  });
});
