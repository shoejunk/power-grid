import { describe, expect, it } from 'vitest';

import type { Condition } from '../effects.js';
import { TEST_PACK } from '../testPack.js';
import type { ContentPack, SecretObjectiveDefinition } from '../schema.js';
import { validateContentPack, validateManifest } from '../validate.js';
import { BASE_SECRET_OBJECTIVES } from './objectivesSecret.js';

const authoredPack = (): ContentPack => ({ ...TEST_PACK, secretObjectives: BASE_SECRET_OBJECTIVES });

const conditionKinds = new Set<Condition['kind']>([
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

function inspectCondition(condition: Condition, path: string): void {
  expect(conditionKinds.has(condition.kind), `${path}.kind`).toBe(true);

  switch (condition.kind) {
    case 'not':
      inspectCondition(condition.of, `${path}.of`);
      return;
    case 'all':
    case 'any':
      expect(condition.of.length, `${path}.of`).toBeGreaterThan(0);
      condition.of.forEach((child, index) => inspectCondition(child, `${path}.of[${index}]`));
      return;
    case 'roundsSurvived':
      expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
      return;
    case 'barricadesAt':
      expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
      return;
    case 'holdsCards':
      expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
      return;
    case 'objectiveContributions':
      expect(condition.atLeast, `${path}.atLeast`).toBeGreaterThan(0);
      return;
    case 'always':
    case 'never':
    case 'morale':
    case 'roundsRemaining':
    case 'food':
    case 'wasteCount':
    case 'starvationTokens':
    case 'zombiesAt':
    case 'survivorsAt':
    case 'helplessSurvivors':
    case 'colonyHasEmptySurvivorSpace':
    case 'playerExiled':
    case 'handCount':
    case 'strictlyMostCardsInHand':
    case 'controlsSurvivors':
    case 'counter':
    case 'counterPerStartingPlayer':
    case 'variable':
      return;
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
}

const families = (kind: SecretObjectiveDefinition['kind']): SecretObjectiveDefinition[] =>
  BASE_SECRET_OBJECTIVES.filter((objective) => objective.kind === kind);

describe('dow-base secret-objective catalog', () => {
  it('contains exactly 24 non-betrayal, 10 betrayal, and 10 exiled cards', () => {
    expect(families('nonBetrayal')).toHaveLength(24);
    expect(families('betrayal')).toHaveLength(10);
    expect(families('exiled')).toHaveLength(10);
  });

  it('uses stable semantic ids and unique authored names and copy', () => {
    const ids = BASE_SECRET_OBJECTIVES.map((objective) => objective.id);
    const names = BASE_SECRET_OBJECTIVES.map((objective) => objective.name);
    const copy = BASE_SECRET_OBJECTIVES.flatMap((objective) => [objective.name, objective.text]);

    expect(new Set(ids).size).toBe(BASE_SECRET_OBJECTIVES.length);
    expect(new Set(names).size).toBe(BASE_SECRET_OBJECTIVES.length);
    expect(new Set(copy).size).toBe(copy.length);

    for (const objective of BASE_SECRET_OBJECTIVES) {
      expect(objective.id).toMatch(/^so-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(objective.name.trim()).not.toBe('');
      expect(objective.text.trim()).not.toBe('');
      expect(objective.name).not.toMatch(/(?:loyalist|betrayer|cast out)\s*\d/i);
      expect(objective.text).not.toMatch(/placeholder|fixture|nothing happens|endure\.|the colony must fail/i);
    }
  });

  it('gives every card a varied, executable completion condition', () => {
    const kinds = new Set(BASE_SECRET_OBJECTIVES.map((objective) => objective.completion.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(15);

    for (const objective of BASE_SECRET_OBJECTIVES) {
      inspectCondition(objective.completion, `${objective.id}.completion`);
      expect(objective.completion.kind).not.toBe('never');
    }
  });

  it('sets cooperative and mature-content filters deliberately by family', () => {
    expect(families('nonBetrayal').every((objective) => objective.nonCooperative === false)).toBe(true);
    expect(families('betrayal').every((objective) => objective.nonCooperative === true)).toBe(true);
    expect(families('exiled').every((objective) => objective.nonCooperative === false)).toBe(true);
    const matureObjectives = BASE_SECRET_OBJECTIVES.filter((objective) => objective.matureContent);
    expect(matureObjectives.map((objective) => objective.id)).toEqual([
      'so-fractured-walls',
      'so-open-gate',
      'so-no-safe-haven',
    ]);
    expect(matureObjectives.every((objective) => objective.kind === 'betrayal')).toBe(true);
    expect(matureObjectives.every((objective) => objective.nonCooperative)).toBe(true);
    expect(families('nonBetrayal').some((objective) => objective.matureContent)).toBe(false);
    expect(families('exiled').some((objective) => objective.matureContent)).toBe(false);
  });

  it('models exiled reveal and replacement semantics, including betrayer-safe reveal text', () => {
    const exiledObjectives = families('exiled');
    expect(exiledObjectives.every((objective) => objective.revealsOriginalObjective === true)).toBe(true);
    expect(exiledObjectives.filter((objective) => objective.replacesOriginalObjective)).toHaveLength(3);
    expect(exiledObjectives.filter((objective) => !objective.replacesOriginalObjective)).toHaveLength(7);

    for (const objective of exiledObjectives) {
      expect(objective.text).toMatch(/non-betrayal original objective/i);
      if (objective.replacesOriginalObjective) {
        expect(objective.text).toMatch(/replace it with this task/i);
      }
    }

    expect(BASE_SECRET_OBJECTIVES.find((objective) => objective.id === 'so-exile-outpost')).toMatchObject({
      completion: {
        kind: 'survivorsAt',
        location: { kind: 'eachNonColony' },
        controlledBy: { kind: 'effectController' },
        atLeast: 1,
      },
    });
  });

  it('preserves the §18.2 named objective interpretations', () => {
    const fixtureHoarder = TEST_PACK.secretObjectives.find(
      (objective) => objective.completion.kind === 'strictlyMostCardsInHand',
    );
    const hoarder = BASE_SECRET_OBJECTIVES.find((objective) => objective.id === 'so-hoarder');
    expect(fixtureHoarder).toBeDefined();
    expect(hoarder).toMatchObject({
      id: 'so-hoarder',
      name: 'Hoarder',
      text: fixtureHoarder!.text,
      kind: fixtureHoarder!.kind,
      completion: fixtureHoarder!.completion,
      nonCooperative: fixtureHoarder!.nonCooperative,
      matureContent: fixtureHoarder!.matureContent,
    });

    expect(BASE_SECRET_OBJECTIVES.find((objective) => objective.id === 'so-hunger')).toEqual({
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
    });
  });

  it('passes structural and manifest validation for the secret-objective family', () => {
    expect(validateContentPack(authoredPack()).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validateManifest(authoredPack()).filter((issue) => issue.path.startsWith('secretObjectives'))).toEqual([]);
  });
});
