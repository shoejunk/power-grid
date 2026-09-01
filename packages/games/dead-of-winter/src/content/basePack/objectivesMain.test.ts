import { describe, expect, it } from 'vitest';

import type { Condition, Effect } from '../effects.js';
import { TEST_PACK } from '../testPack.js';
import { validateContentPack, validateManifest } from '../validate.js';
import type { ContentPack, MainObjectiveDefinition, MainObjectiveSide } from '../schema.js';
import { BASE_MAIN_OBJECTIVES } from './objectivesMain.js';

const authoredPack = (): ContentPack => ({ ...TEST_PACK, mainObjectives: BASE_MAIN_OBJECTIVES });

const knownConditionKinds = new Set<Condition['kind']>([
  'always',
  'never',
  'not',
  'all',
  'any',
  'morale',
  'roundsRemaining',
  'food',
  'wasteCount',
  'starvationTokens',
  'roundsSurvived',
  'zombiesAt',
  'survivorsAt',
  'helplessSurvivors',
  'colonyHasEmptySurvivorSpace',
  'barricadesAt',
  'playerExiled',
  'handCount',
  'strictlyMostCardsInHand',
  'holdsCards',
  'controlsSurvivors',
  'objectiveContributions',
  'counter',
  'counterPerStartingPlayer',
  'variable',
]);

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

function inspectCondition(condition: Condition, path: string): void {
  expect(knownConditionKinds.has(condition.kind), `${path}.kind`).toBe(true);

  if (condition.kind === 'not') inspectCondition(condition.of, `${path}.of`);
  if (condition.kind === 'all' || condition.kind === 'any') {
    expect(condition.of.length, `${path}.of`).toBeGreaterThan(0);
    condition.of.forEach((child, index) => inspectCondition(child, `${path}.of[${index}]`));
  }
  if (condition.kind === 'zombiesAt' || condition.kind === 'survivorsAt') {
    expect(condition.location.kind, `${path}.location.kind`).toMatch(
      /^(fixed|colony|sourceLocation|eachNonColony|chosen)$/,
    );
  }
  if (condition.kind === 'barricadesAt') {
    expect(condition.location.kind, `${path}.location.kind`).toMatch(
      /^(fixed|colony|sourceLocation|eachNonColony|chosen)$/,
    );
    expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
  }
  if (
    condition.kind === 'morale' ||
    condition.kind === 'roundsRemaining' ||
    condition.kind === 'food' ||
    condition.kind === 'wasteCount' ||
    condition.kind === 'helplessSurvivors' ||
    condition.kind === 'handCount'
  ) {
    const bounds = [condition.atLeast, condition.atMost].filter(
      (bound): bound is number => bound !== undefined,
    );
    expect(bounds.length, `${path}.bounds`).toBeGreaterThan(0);
    expect(bounds.every((bound) => Number.isFinite(bound)), `${path}.bounds`).toBe(true);
  }
  if (condition.kind === 'starvationTokens') {
    expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
  }
  if (condition.kind === 'roundsSurvived') {
    expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
  }
  if (condition.kind === 'objectiveContributions') {
    expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
  }
  if (condition.kind === 'counter' || condition.kind === 'counterPerStartingPlayer') {
    expect(condition.counter.trim(), `${path}.counter`).not.toBe('');
    expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
  }
  if (condition.kind === 'variable') {
    expect(condition.name.trim(), `${path}.name`).not.toBe('');
    expect(
      [condition.atLeast, condition.atMost].some((bound) => bound !== undefined),
      `${path}.bounds`,
    ).toBe(true);
  }
}

function inspectEffect(effect: Effect, path: string): void {
  expect(knownEffectKinds.has(effect.kind), `${path}.kind`).toBe(true);
  expect(effect.kind, `${path}.kind`).not.toBe('noop');

  if (effect.kind === 'sequence' || effect.kind === 'simultaneous') {
    expect(effect.effects.length, `${path}.effects`).toBeGreaterThan(0);
    effect.effects.forEach((child, index) => inspectEffect(child, `${path}.effects[${index}]`));
  }
  if (effect.kind === 'ifAble') inspectEffect(effect.effect, `${path}.effect`);
  if (effect.kind === 'branch') {
    inspectCondition(effect.test, `${path}.test`);
    inspectEffect(effect.then, `${path}.then`);
    if (effect.otherwise) inspectEffect(effect.otherwise, `${path}.otherwise`);
  }
  if (effect.kind === 'repeat') {
    expect(effect.times, `${path}.times`).toBeGreaterThan(0);
    inspectEffect(effect.effect, `${path}.effect`);
  }
}

function inspectSide(side: MainObjectiveSide, path: string): void {
  expect(side.text.trim(), `${path}.text`).not.toBe('');
  expect(side.startingMorale, `${path}.startingMorale`).toBeGreaterThanOrEqual(1);
  expect(side.startingMorale, `${path}.startingMorale`).toBeLessThanOrEqual(10);
  expect(side.startingRounds, `${path}.startingRounds`).toBeGreaterThan(0);
  expect(Array.isArray(side.setup), `${path}.setup`).toBe(true);
  side.setup.forEach((effect, index) => inspectEffect(effect, `${path}.setup[${index}]`));
  inspectCondition(side.completion, `${path}.completion`);
  expect(['always', 'never']).not.toContain(side.completion.kind);
  if (side.onZombieKilled) inspectEffect(side.onZombieKilled, `${path}.onZombieKilled`);

  if (side.contribution) {
    expect(side.contribution.requirement).toBeDefined();
    if (side.contribution.maxPerTurn !== undefined) {
      expect(side.contribution.maxPerTurn, `${path}.contribution.maxPerTurn`).toBeGreaterThan(0);
    }
  }
  if (side.counters) {
    expect(side.counters.length, `${path}.counters`).toBeGreaterThan(0);
    for (const counter of side.counters) {
      expect(counter.id.trim(), `${path}.counter.id`).not.toBe('');
      expect(counter.label.trim(), `${path}.counter.label`).not.toBe('');
      expect(Number.isFinite(counter.start), `${path}.counter.start`).toBe(true);
    }
  }
}

describe('dow-base main-objective catalog', () => {
  it('contains exactly ten stable, unique, authored objective records', () => {
    expect(BASE_MAIN_OBJECTIVES).toHaveLength(10);
    expect(BASE_MAIN_OBJECTIVES.map((objective) => objective.id)).toEqual([
      'mo-we-need-more-samples',
      'mo-stockpile',
      'mo-ashen-gates',
      'mo-ration-wardens',
      'mo-cold-storage',
      'mo-last-lantern',
      'mo-embers-of-knowledge',
      'mo-watch-the-walls',
      'mo-raiding-party',
      'mo-winter-ward',
    ]);
    expect(new Set(BASE_MAIN_OBJECTIVES.map((objective) => objective.id)).size).toBe(10);
    expect(new Set(BASE_MAIN_OBJECTIVES.map((objective) => objective.name)).size).toBe(10);

    const publicCopy = BASE_MAIN_OBJECTIVES.flatMap((objective) => [
      objective.name,
      objective.standard.text,
      objective.hardcore.text,
    ]);
    expect(publicCopy.every((text) => text.trim().length > 0)).toBe(true);
    expect(publicCopy.join('\n')).not.toMatch(
      /placeholder|fixture|generated|nothing happens|objective \d+|quiet moment/i,
    );
    for (const objective of BASE_MAIN_OBJECTIVES) {
      expect(objective.id).toMatch(/^mo-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(objective.name).not.toMatch(/\d/);
      inspectSide(objective.standard, `${objective.id}.standard`);
      inspectSide(objective.hardcore, `${objective.id}.hardcore`);
      expect(objective.standard).not.toEqual(objective.hardcore);
    }
  });

  it('preserves the §18.2 named definitions exactly', () => {
    const fixtureById = new Map(TEST_PACK.mainObjectives.map((objective) => [objective.id, objective]));
    for (const id of ['mo-we-need-more-samples', 'mo-stockpile']) {
      expect(BASE_MAIN_OBJECTIVES.find((objective) => objective.id === id)).toEqual(
        fixtureById.get(id),
      );
    }
  });

  it('keeps contribution and counter bookkeeping aligned with completion tests', () => {
    for (const objective of BASE_MAIN_OBJECTIVES) {
      for (const sideName of ['standard', 'hardcore'] as const) {
        const side = objective[sideName];
        const contributionConditions: Condition[] = [];
        const collect = (condition: Condition): void => {
          if (condition.kind === 'all' || condition.kind === 'any') {
            condition.of.forEach(collect);
          } else if (condition.kind === 'objectiveContributions') {
            contributionConditions.push(condition);
          }
        };
        collect(side.completion);

        if (side.contribution) {
          expect(contributionConditions.length, `${objective.id}.${sideName}`).toBeGreaterThan(0);
          expect(contributionConditions).toContainEqual(
            expect.objectContaining({ requirement: side.contribution.requirement }),
          );
        }
        if (side.counters) {
          for (const counter of side.counters) {
            expect(JSON.stringify(side.completion)).toContain(`"${counter.id}"`);
          }
        }
      }
    }
  });

  it('passes structural and manifest validation as a complete main-objective family', () => {
    expect(validateContentPack(authoredPack()).filter((issue) => issue.severity === 'error')).toEqual(
      [],
    );
    expect(validateManifest(authoredPack()).filter((issue) => issue.path === 'mainObjectives')).toEqual(
      [],
    );
  });
});
