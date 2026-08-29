import { describe, expect, it } from 'vitest';

import type { Effect } from '../effects.js';
import { TEST_PACK } from '../testPack.js';
import { validateContentPack } from '../validate.js';
import type { ContentPack, SurvivorCardDefinition } from '../schema.js';
import { BASE_SURVIVORS } from './survivors.js';

const namedRegressionIds = [
  'sv-loretta-clay',
  'sv-edward-white',
  'sv-john-price',
  'sv-forest-plum',
  'sv-buddy-davis',
  'sv-bev-russell',
] as const;

const fixtureNamedSurvivors = new Map(
  TEST_PACK.survivors
    .filter((survivor) => namedRegressionIds.includes(survivor.id as (typeof namedRegressionIds)[number]))
    .map((survivor) => [survivor.id, survivor]),
);

const authoredPack = (): ContentPack => ({ ...TEST_PACK, survivors: BASE_SURVIVORS });

const knownEffectKinds = new Set<Effect['kind']>([
  'noop',
  'sequence',
  'simultaneous',
  'ifAble',
  'branch',
  'repeat',
  'adjustMorale',
  'adjustFood',
  'adjustRounds',
  'addStarvation',
  'adjustCounter',
  'addZombies',
  'removeZombies',
  'killZombies',
  'addSurvivor',
  'addHelpless',
  'killSurvivor',
  'removeSurvivor',
  'wound',
  'heal',
  'rollExposure',
  'moveSurvivor',
  'drawItems',
  'discardItems',
  'stealRandomCard',
  'searchDeckForCard',
  'removeCrisisContributions',
  'addBarricade',
  'removeBarricade',
  'addNoise',
  'removeNoise',
  'choice',
  'vote',
  'requestCard',
  'rollDie',
  'endGame',
]);

function inspectEffect(effect: Effect, path: string): void {
  expect(knownEffectKinds.has(effect.kind), path).toBe(true);
  expect(effect).toBeTypeOf('object');
  expect(effect.kind, `${path}.kind`).not.toBe('noop');

  if (effect.kind === 'sequence' || effect.kind === 'simultaneous') {
    expect(effect.effects.length, `${path}.effects`).toBeGreaterThan(0);
    effect.effects.forEach((child, index) => inspectEffect(child, `${path}.effects[${index}]`));
  }
  if (effect.kind === 'ifAble') inspectEffect(effect.effect, `${path}.effect`);
  if (effect.kind === 'branch') {
    inspectEffect(effect.then, `${path}.then`);
    if (effect.otherwise) inspectEffect(effect.otherwise, `${path}.otherwise`);
  }
  if (effect.kind === 'repeat') {
    expect(effect.times, `${path}.times`).toBeGreaterThan(0);
    inspectEffect(effect.effect, `${path}.effect`);
  }
  if (effect.kind === 'drawItems') {
    expect(['locationItems', 'sourceLocationItems']).toContain(effect.deck.kind);
    expect(effect.count, `${path}.count`).toBeGreaterThan(0);
  }
  if (
    effect.kind === 'addZombies' ||
    effect.kind === 'removeZombies' ||
    effect.kind === 'killZombies' ||
    effect.kind === 'addBarricade' ||
    effect.kind === 'removeBarricade' ||
    effect.kind === 'addNoise' ||
    effect.kind === 'removeNoise' ||
    effect.kind === 'addHelpless'
  ) {
    expect(effect.count, `${path}.count`).toBeGreaterThan(0);
  }
  if (effect.kind === 'heal' || effect.kind === 'wound') {
    expect(effect.amount, `${path}.amount`).toBeGreaterThan(0);
  }
  if (effect.kind === 'addSurvivor') {
    expect(effect.count, `${path}.count`).toBeGreaterThan(0);
  }
  if (effect.kind === 'choice') {
    expect(effect.options.length, `${path}.options`).toBeGreaterThan(1);
    effect.options.forEach((option, index) => {
      expect(option.id.trim(), `${path}.options[${index}].id`).not.toBe('');
      expect(option.text.trim(), `${path}.options[${index}].text`).not.toBe('');
      inspectEffect(option.outcome, `${path}.options[${index}].outcome`);
    });
  }
  if (effect.kind === 'vote') {
    inspectEffect(effect.onPass, `${path}.onPass`);
    inspectEffect(effect.onFail, `${path}.onFail`);
  }
  if (effect.kind === 'requestCard' && effect.then) inspectEffect(effect.then, `${path}.then`);
}

describe('dow-base survivor catalog', () => {
  it('contains exactly 30 named cards with unique ids and names', () => {
    expect(BASE_SURVIVORS).toHaveLength(30);

    const ids = BASE_SURVIVORS.map((survivor) => survivor.id);
    const names = BASE_SURVIVORS.map((survivor) => survivor.name);
    expect(new Set(ids).size).toBe(30);
    expect(new Set(names).size).toBe(30);

    for (const survivor of BASE_SURVIVORS) {
      expect(survivor.id).toMatch(/^sv-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(survivor.name.trim()).not.toBe('');
      expect(survivor.name).not.toMatch(/^(?:survivor|character|card)\s*\d+$/i);
      expect(survivor.occupation.trim()).not.toBe('');
      expect(survivor.influence).toBeGreaterThanOrEqual(0);
      expect(survivor.attackThreshold).toBeGreaterThanOrEqual(1);
      expect(survivor.attackThreshold).toBeLessThanOrEqual(6);
      expect(survivor.searchThreshold).toBeGreaterThanOrEqual(1);
      expect(survivor.searchThreshold).toBeLessThanOrEqual(6);
      expect(typeof survivor.nonCooperative).toBe('boolean');
      expect(typeof survivor.matureContent).toBe('boolean');
    }
  });

  it('preserves every named §18 survivor identity and behavior exactly', () => {
    for (const id of namedRegressionIds) {
      const authored = BASE_SURVIVORS.find((survivor) => survivor.id === id);
      expect(authored).toBeDefined();
      expect(authored).toEqual(fixtureNamedSurvivors.get(id));
    }

    expect(BASE_SURVIVORS.find((survivor) => survivor.id === 'sv-loretta-clay')?.ability?.dieThreshold).toBe(4);
    expect(BASE_SURVIVORS.find((survivor) => survivor.id === 'sv-bev-russell')?.cannotBeKilled).toBe(true);
  });

  it('is materially distinct from the fixture family through authored abilities', () => {
    const fixtureAbilityCount = TEST_PACK.survivors.filter((survivor) => survivor.ability).length;
    const authoredAbilities = BASE_SURVIVORS.flatMap((survivor) =>
      survivor.ability ? [survivor.ability] : [],
    );
    const authoredAbilityIds = authoredAbilities.map((ability) => ability.id);
    const authoredAbilityTexts = authoredAbilities.map((ability) => ability.text);

    expect(BASE_SURVIVORS).not.toEqual(TEST_PACK.survivors);
    expect(authoredAbilities.length).toBeGreaterThan(fixtureAbilityCount);
    expect(authoredAbilityIds.length).toBe(new Set(authoredAbilityIds).size);
    expect(authoredAbilityTexts.length).toBe(new Set(authoredAbilityTexts).size);
    expect(new Set(authoredAbilities.map((ability) => JSON.stringify(ability.effect))).size).toBe(
      authoredAbilities.length,
    );
    expect(BASE_SURVIVORS.filter((survivor) => !namedRegressionIds.includes(survivor.id as (typeof namedRegressionIds)[number]))
      .every((survivor) => survivor.ability !== undefined)).toBe(true);
  });

  it('has non-placeholder, location-bound ability data with executable effect trees', () => {
    const abilities = BASE_SURVIVORS.flatMap((survivor) =>
      survivor.ability ? [{ survivor, ability: survivor.ability }] : [],
    );
    const locations = new Set([
      'ANYWHERE',
      'colony',
      'police-station',
      'grocery-store',
      'school',
      'gas-station',
      'library',
      'hospital',
    ]);
    const usages = new Set(['unlimited', 'oncePerTurn', 'oncePerRound', 'oncePerGame']);

    expect(abilities.length).toBe(28);
    for (const { survivor, ability } of abilities) {
      expect(ability.id).toMatch(/^[-a-z0-9]+$/);
      expect(ability.text.trim().length).toBeGreaterThan(20);
      expect(ability.text).not.toMatch(/nothing happens|placeholder|todo/i);
      expect(locations.has(ability.location), `${survivor.id}.ability.location`).toBe(true);
      expect(usages.has(ability.usage), `${survivor.id}.ability.usage`).toBe(true);
      expect(
        ability.dieThreshold === null || (ability.dieThreshold >= 1 && ability.dieThreshold <= 6),
        `${survivor.id}.ability.dieThreshold`,
      ).toBe(true);
      expect(ability.effect.kind).not.toBe('noop');
      inspectEffect(ability.effect, `${survivor.id}.ability.effect`);
    }
  });

  it('passes the content validator with all survivor records present', () => {
    const issues = validateContentPack(authoredPack());
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(authoredPack().survivors).toHaveLength(30);
  });
});
