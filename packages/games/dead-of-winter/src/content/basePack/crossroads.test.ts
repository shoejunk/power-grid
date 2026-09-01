import { describe, expect, it } from 'vitest';

import type { Effect } from '../effects.js';
import { TEST_PACK } from '../testPack.js';
import { validateContentPack, validateManifest } from '../validate.js';
import type { ContentPack } from '../schema.js';
import { BASE_CROSSROADS } from './crossroads.js';

const authoredPack = (): ContentPack => ({ ...TEST_PACK, crossroads: BASE_CROSSROADS });

const namedRegressionIds = [
  'xr-move-test',
  'xr-old-divisions',
  'xr-outbreak',
  'xr-this-taste-funny',
] as const;

const retainedNamedIds = [
  ...namedRegressionIds,
  'xr-mature-sample',
  'xr-exile-dependent',
  'xr-impossible',
] as const;

const fixtureCrossroads = new Map(TEST_PACK.crossroads.map((card) => [card.id, card]));

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
    expect(effect.options.length, `${path}.options`).toBeGreaterThan(0);
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

describe('dow-base crossroads catalog', () => {
  it('contains exactly 80 stable cards with unique ids and names', () => {
    expect(BASE_CROSSROADS).toHaveLength(80);
    const expectedIds = [
      ...namedRegressionIds,
      'xr-mature-sample',
      'xr-exile-dependent',
      'xr-impossible',
      ...Array.from({ length: 73 }, (_, index) => `xr-f${index + 1}`),
    ];
    expect(BASE_CROSSROADS.map((card) => card.id)).toEqual(expectedIds);
    expect(new Set(BASE_CROSSROADS.map((card) => card.id)).size).toBe(80);
    expect(new Set(BASE_CROSSROADS.map((card) => card.name)).size).toBe(80);
  });

  it('preserves all existing ids and named §18/regression identities', () => {
    expect(BASE_CROSSROADS.map((card) => card.id).sort()).toEqual(
      TEST_PACK.crossroads.map((card) => card.id).sort(),
    );

    for (const id of namedRegressionIds) {
      expect(BASE_CROSSROADS.find((card) => card.id === id)).toEqual(fixtureCrossroads.get(id));
    }

    for (const id of retainedNamedIds) {
      const authored = BASE_CROSSROADS.find((card) => card.id === id);
      const fixture = fixtureCrossroads.get(id);
      expect(authored).toBeDefined();
      expect(fixture).toBeDefined();
      expect(authored).toMatchObject({ id, name: fixture!.name });
    }
  });

  it('retains the Bev Russell option used by the authored Raiding Party objective', () => {
    expect(BASE_CROSSROADS.find((card) => card.name === 'Bev Russell')).toMatchObject({
      id: 'xr-f73',
      trigger: { event: 'moveCompleted', destination: 'any' },
      options: [
        expect.objectContaining({
          id: 'raiding-party',
          outcome: { kind: 'adjustCounter', counter: 'bevRussellOptions', amount: 1 },
        }),
      ],
    });
  });

  it('has varied executable triggers, public choices, and non-placeholder copy', () => {
    const triggerEvents = new Set([
      'turnStart',
      'turnEnd',
      'actionPerformed',
      'moveCompleted',
      'zombieKilled',
      'survivorKilled',
      'searchPerformed',
      'crisisResolved',
      'moraleChanged',
      'roundEnd',
    ]);
    const actions = new Set([
      'attackZombie',
      'attackSurvivor',
      'search',
      'barricade',
      'cleanWaste',
      'attract',
      'ability',
      'playItem',
      'playFoodForDie',
      'move',
      'contributeCrisis',
      'contributeObjective',
      'any',
    ]);
    const publicCopy = BASE_CROSSROADS.flatMap((card) => [
      card.name,
      card.story,
      ...card.options.map((option) => option.text),
    ]);

    expect(new Set(publicCopy).size).toBe(publicCopy.length);
    expect(publicCopy.every((text) => text.trim().length > 0)).toBe(true);
    expect(publicCopy.join('\n')).not.toMatch(/placeholder|fixture|nothing happens|quiet moment|carry on|do the impossible/i);
    expect(new Set(BASE_CROSSROADS.map((card) => card.trigger.event)).size).toBeGreaterThanOrEqual(9);

    for (const card of BASE_CROSSROADS) {
      expect(triggerEvents.has(card.trigger.event), `${card.id}.trigger.event`).toBe(true);
      if (card.trigger.action) expect(actions.has(card.trigger.action), `${card.id}.trigger.action`).toBe(true);
      expect(card.trigger.event).not.toBe('never');
      expect(card.options.length).toBeGreaterThan(0);
      expect(card.options.some((option) => option.requires?.kind !== 'never')).toBe(true);
      expect(new Set(card.options.map((option) => option.id)).size).toBe(card.options.length);
      for (const option of card.options) {
        expect(option.id.trim()).not.toBe('');
        expect(option.text.trim()).not.toBe('');
        inspectEffect(option.outcome, `${card.id}.${option.id}`);
      }
    }
  });

  it('sets filter metadata deliberately and passes structural validation', () => {
    expect(BASE_CROSSROADS.some((card) => card.matureContent)).toBe(true);
    expect(BASE_CROSSROADS.some((card) => card.nonCooperative)).toBe(true);
    expect(BASE_CROSSROADS.some((card) => card.dependsOnExile === true)).toBe(true);

    for (const card of BASE_CROSSROADS) {
      expect(typeof card.matureContent).toBe('boolean');
      expect(typeof card.nonCooperative).toBe('boolean');
      if (card.dependsOnExile !== undefined) expect(typeof card.dependsOnExile).toBe('boolean');
    }
    expect(BASE_CROSSROADS.find((card) => card.id === 'xr-mature-sample')).toMatchObject({
      matureContent: true,
    });
    expect(BASE_CROSSROADS.find((card) => card.id === 'xr-exile-dependent')).toMatchObject({
      nonCooperative: true,
      dependsOnExile: true,
    });

    const pack = authoredPack();
    expect(validateContentPack(pack).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validateManifest(pack).filter((issue) => issue.path === 'crossroads')).toEqual([]);
  });
});
