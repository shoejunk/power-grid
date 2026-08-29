import { describe, expect, it } from 'vitest';

import type { Effect } from '../effects.js';
import { TEST_PACK } from '../testPack.js';
import { validateContentPack, validateManifest } from '../validate.js';
import type { ContentPack } from '../schema.js';
import { BASE_CRISES } from './crises.js';

const authoredPack = (): ContentPack => ({ ...TEST_PACK, crises: BASE_CRISES });

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

describe('dow-base crisis catalog', () => {
  it('contains exactly 20 stable, uniquely named crisis cards', () => {
    expect(BASE_CRISES).toHaveLength(20);
    expect(BASE_CRISES.map((crisis) => crisis.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `cr-${index + 1}`),
    );
    expect(new Set(BASE_CRISES.map((crisis) => crisis.id)).size).toBe(20);
    expect(new Set(BASE_CRISES.map((crisis) => crisis.name)).size).toBe(20);

    for (const crisis of BASE_CRISES) {
      expect(crisis.id).toMatch(/^cr-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(crisis.name.trim()).not.toBe('');
      expect(crisis.text.trim()).not.toBe('');
      expect(crisis.acceptedSymbols.length).toBeGreaterThan(0);
      expect(typeof crisis.nonCooperative).toBe('boolean');
      expect(typeof crisis.matureContent).toBe('boolean');
    }
  });

  it('preserves the crisis ids and the cr-1/cr-2 regression semantics', () => {
    expect(BASE_CRISES.map((crisis) => crisis.id)).toEqual(TEST_PACK.crises.map((crisis) => crisis.id));

    expect(BASE_CRISES.find((crisis) => crisis.id === 'cr-1')).toMatchObject({
      acceptedSymbols: ['weapon'],
      failure: { kind: 'adjustMorale', amount: -2 },
    });
    expect(BASE_CRISES.find((crisis) => crisis.id === 'cr-2')).toMatchObject({
      acceptedSymbols: ['fuel'],
      failure: { kind: 'addZombies', count: 2, location: { kind: 'colony' } },
    });
  });

  it('uses distinct public copy and executable non-noop outcomes throughout', () => {
    const publicCopy = BASE_CRISES.flatMap((crisis) => [
      crisis.name,
      crisis.text,
      ...(crisis.overContribution ? [crisis.overContribution.text] : []),
    ]);
    expect(new Set(publicCopy).size).toBe(publicCopy.length);
    expect(publicCopy.every((text) => text.trim().length > 0)).toBe(true);
    expect(publicCopy.join('\n')).not.toMatch(/placeholder|fixture|nothing happens|quiet moment|crisis \d+/i);

    for (const crisis of BASE_CRISES) {
      inspectEffect(crisis.failure, `${crisis.id}.failure`);
      if (crisis.overContribution) inspectEffect(crisis.overContribution.effect, `${crisis.id}.overContribution`);
    }
  });

  it('passes structural and manifest validation for the crisis family', () => {
    const pack = authoredPack();
    expect(validateContentPack(pack).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validateManifest(pack).filter((issue) => issue.path === 'crises')).toEqual([]);
  });
});
