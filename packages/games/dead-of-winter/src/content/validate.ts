/**
 * Content-pack validation.
 *
 * Two jobs, deliberately separable:
 *
 *  - *structural* checks, which every pack must pass because the engine would
 *    otherwise fault at runtime on a dangling card id;
 *  - the §2.0 *manifest* count check, which only a pack claiming to be the
 *    complete licensed base game must pass. The built-in `TEST_PACK` is
 *    structurally valid and deliberately fails the manifest, which is the
 *    honest signal that it is a fixture.
 *
 * §22 requires a rules error to "fail closed with the pending state preserved".
 * Validation therefore returns issues rather than throwing; the caller decides
 * whether a warning is fatal. `assertUsableContent` is the fail-closed door the
 * engine actually goes through.
 */

import { NON_COLONY_LOCATIONS, type ItemSymbol, type NonColonyLocationId } from './primitives.js';
import type { ContentPack } from './schema.js';

/* ------------------------------------------------------------------ *
 * The §2.0 base content manifest
 * ------------------------------------------------------------------ */

/**
 * Component counts from the §2.0 table.
 *
 * §2.0 is explicit that these validate "content and art coverage" and must not
 * be read as gameplay caps — the engine never consults this table at runtime,
 * only `validateManifest` does. That is why zombie, wound and token counts are
 * absent: the digital game models zombies as an unbounded count precisely
 * because §2.0 says a standee shortage is not a limit.
 */
export const BASE_MANIFEST = {
  mainObjectives: 10,
  nonBetrayalSecretObjectives: 24,
  betrayalSecretObjectives: 10,
  exiledSecretObjectives: 10,
  survivors: 30,
  starterItems: 25,
  itemsPerLocationDeck: 20,
  locationDecks: 6,
  crises: 20,
  crossroads: 80,
} as const;

export type IssueSeverity = 'error' | 'warning';

export interface ContentIssue {
  severity: IssueSeverity;
  /** Dotted path into the pack, e.g. `items[shovel].deck`. */
  path: string;
  message: string;
}

const error = (path: string, message: string): ContentIssue => ({
  severity: 'error',
  path,
  message,
});
const warn = (path: string, message: string): ContentIssue => ({
  severity: 'warning',
  path,
  message,
});

/* ------------------------------------------------------------------ *
 * Structural validation
 * ------------------------------------------------------------------ */

/**
 * Checks the invariants the engine relies on: unique ids, a location record
 * for each of the six non-colony locations, a six-face exposure die, sane
 * thresholds, and at least one usable main objective.
 */
export function validateContentPack(pack: ContentPack): ContentIssue[] {
  const issues: ContentIssue[] = [];

  const dupes = (path: string, ids: readonly string[]): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push(error(`${path}[${id}]`, 'duplicate card id'));
      seen.add(id);
    }
  };
  dupes('survivors', pack.survivors.map((c) => c.id));
  dupes('items', pack.items.map((c) => c.id));
  dupes('crises', pack.crises.map((c) => c.id));
  dupes('crossroads', pack.crossroads.map((c) => c.id));
  dupes('mainObjectives', pack.mainObjectives.map((c) => c.id));
  dupes('secretObjectives', pack.secretObjectives.map((c) => c.id));

  /* Board ------------------------------------------------------- */

  for (const id of NON_COLONY_LOCATIONS) {
    const loc = pack.locations.find((l) => l.id === id);
    if (!loc) {
      issues.push(error(`locations[${id}]`, 'missing; §2.1 requires all six non-colony locations'));
      continue;
    }
    if (loc.survivorCapacity < 1) {
      issues.push(error(`locations[${id}].survivorCapacity`, 'must be at least 1'));
    }
    if (loc.entranceCapacity < 1) {
      issues.push(error(`locations[${id}].entranceCapacity`, 'must be at least 1'));
    }
    if (loc.noiseSpaces !== 4) {
      issues.push(warn(`locations[${id}].noiseSpaces`, '§2.1 prints four noise spaces'));
    }
  }
  const extra = pack.locations.filter(
    (l) => !(NON_COLONY_LOCATIONS as readonly string[]).includes(l.id),
  );
  for (const l of extra) issues.push(error(`locations[${l.id}]`, 'not a base-game location'));

  const orders = new Set(pack.locations.map((l) => l.order));
  if (orders.size !== pack.locations.length) {
    issues.push(
      error('locations[].order', '§2.1 needs one deterministic location order; orders collide'),
    );
  }

  if (pack.colony.entranceCount !== 6) {
    issues.push(error('colony.entranceCount', '§2.1 prints six numbered entrances'));
  }
  if (pack.colony.survivorSpaces < 1) {
    issues.push(error('colony.survivorSpaces', 'must be at least 1'));
  }
  if (pack.colony.maxMorale < 1) {
    issues.push(error('colony.maxMorale', 'must be at least 1'));
  }

  if (pack.exposureDie.length !== 6) {
    issues.push(error('exposureDie', '§2.5 the exposure die has six faces'));
  }

  /* Cards -------------------------------------------------------- */

  for (const s of pack.survivors) {
    if (s.influence < 0) issues.push(error(`survivors[${s.id}].influence`, 'must be >= 0'));
    if (s.attackThreshold < 1 || s.attackThreshold > 6) {
      issues.push(error(`survivors[${s.id}].attackThreshold`, 'must be a d6 face value'));
    }
    if (s.searchThreshold < 1 || s.searchThreshold > 6) {
      issues.push(error(`survivors[${s.id}].searchThreshold`, 'must be a d6 face value'));
    }
  }

  const symbolOk = (sym: string): sym is ItemSymbol =>
    (['weapon', 'fuel', 'education', 'food', 'medicine', 'tool', 'survivor'] as string[]).includes(
      sym,
    );

  for (const item of pack.items) {
    if (item.symbols.length === 0) {
      issues.push(warn(`items[${item.id}].symbols`, 'no symbols; scores -1 in every crisis (§11.3)'));
    }
    for (const sym of item.symbols) {
      if (!symbolOk(sym)) issues.push(error(`items[${item.id}].symbols`, `unknown symbol '${sym}'`));
    }
    if (
      item.deck !== 'starter' &&
      !(NON_COLONY_LOCATIONS as readonly string[]).includes(item.deck)
    ) {
      issues.push(error(`items[${item.id}].deck`, `unknown deck '${item.deck}'`));
    }
    if (item.kind === 'oneShot' && item.equippedAbilities?.length) {
      issues.push(
        error(`items[${item.id}].equippedAbilities`, 'a one-shot card is never equipped (§8.1)'),
      );
    }
  }

  for (const c of pack.crises) {
    if (c.acceptedSymbols.length === 0) {
      issues.push(error(`crises[${c.id}].acceptedSymbols`, 'a crisis must accept some symbol'));
    }
  }

  for (const x of pack.crossroads) {
    if (x.options.length === 0) {
      issues.push(
        error(`crossroads[${x.id}].options`, '§10: a card with no legal result is a rules error'),
      );
    }
  }

  for (const o of pack.mainObjectives) {
    for (const side of ['standard', 'hardcore'] as const) {
      const s = o[side];
      if (s.startingRounds < 1) {
        issues.push(error(`mainObjectives[${o.id}].${side}.startingRounds`, 'must be at least 1'));
      }
      if (s.startingMorale < 1 || s.startingMorale > pack.colony.maxMorale) {
        issues.push(
          error(
            `mainObjectives[${o.id}].${side}.startingMorale`,
            `must be within 1..${pack.colony.maxMorale}`,
          ),
        );
      }
    }
  }
  if (pack.mainObjectives.length === 0) {
    issues.push(error('mainObjectives', 'a pack needs at least one main objective'));
  }

  const secretsOf = (kind: string): number =>
    pack.secretObjectives.filter((s) => s.kind === kind).length;
  if (secretsOf('exiled') === 0) {
    issues.push(error('secretObjectives', '§14.1 needs at least one exiled objective'));
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * Manifest validation (§2.0)
 * ------------------------------------------------------------------ */

/**
 * Checks a pack against the §2.0 component table.
 *
 * Deliberately separate from `validateContentPack`: a short pack is perfectly
 * playable, it simply is not the complete licensed base game, and the lobby
 * should be able to say so without refusing to start.
 */
export function validateManifest(pack: ContentPack): ContentIssue[] {
  const issues: ContentIssue[] = [];

  const expect = (path: string, actual: number, expected: number): void => {
    if (actual !== expected) {
      issues.push(warn(path, `§2.0 manifest expects ${expected}, pack has ${actual}`));
    }
  };

  expect('mainObjectives', pack.mainObjectives.length, BASE_MANIFEST.mainObjectives);
  expect(
    'secretObjectives.nonBetrayal',
    pack.secretObjectives.filter((s) => s.kind === 'nonBetrayal').length,
    BASE_MANIFEST.nonBetrayalSecretObjectives,
  );
  expect(
    'secretObjectives.betrayal',
    pack.secretObjectives.filter((s) => s.kind === 'betrayal').length,
    BASE_MANIFEST.betrayalSecretObjectives,
  );
  expect(
    'secretObjectives.exiled',
    pack.secretObjectives.filter((s) => s.kind === 'exiled').length,
    BASE_MANIFEST.exiledSecretObjectives,
  );
  expect('survivors', pack.survivors.length, BASE_MANIFEST.survivors);
  expect(
    'items.starter',
    pack.items.filter((i) => i.deck === 'starter').length,
    BASE_MANIFEST.starterItems,
  );
  for (const loc of NON_COLONY_LOCATIONS) {
    expect(
      `items.${loc}`,
      pack.items.filter((i) => i.deck === (loc as NonColonyLocationId)).length,
      BASE_MANIFEST.itemsPerLocationDeck,
    );
  }
  expect('crises', pack.crises.length, BASE_MANIFEST.crises);
  expect('crossroads', pack.crossroads.length, BASE_MANIFEST.crossroads);

  return issues;
}

/* ------------------------------------------------------------------ *
 * Fail-closed entry point (§22)
 * ------------------------------------------------------------------ */

/**
 * Throws unless the pack is structurally usable.
 *
 * The engine's only sanctioned throw sites are malformed content (§10 "expose a
 * rules error rather than silently skip the card") and internal invariant
 * breaches. Ordinary illegal player input never reaches here — it is refused by
 * `validateAction` with a reason.
 */
export function assertUsableContent(pack: ContentPack): void {
  const errors = validateContentPack(pack).filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Content pack '${pack.id}@${pack.version}' is unusable:\n${lines}`);
  }
}
