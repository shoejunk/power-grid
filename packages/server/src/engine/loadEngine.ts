/**
 * Resolves the real rules engine at runtime, with a graceful fallback.
 *
 * The engine is authored in a sibling package and may not exist yet, may only
 * exist as TypeScript source, or may only be reachable through the package
 * `exports` map once it lands. Rather than hard-failing (which would take the
 * whole multiplayer server down), we probe a list of specifiers in order of
 * preference and fall back to the placeholder engine.
 *
 * The import is dynamic and the specifier is held in a variable on purpose:
 * that keeps TypeScript from trying to statically resolve a module that does
 * not exist yet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVER_ROOT } from '../config.js';
import type { Logger } from '../logger.js';
import { fallbackEngine } from './fallbackEngine.js';
import type { RulesEngine } from './types.js';

const SHARED_ROOT = path.resolve(SERVER_ROOT, '..', 'shared');

/**
 * Ordered candidates. First one exposing the full trio wins.
 *
 * The package specifiers come first so that, when the engine is reachable
 * through `@pg/shared`, the server shares a single module graph with it rather
 * than loading a second copy through a file URL. The raw paths are a safety
 * net for the window where the engine exists on disk but is not yet re-exported.
 */
function candidateSpecifiers(): string[] {
  const local = [
    path.join(SHARED_ROOT, 'src', 'engine', 'index.ts'),
    path.join(SHARED_ROOT, 'dist', 'engine', 'index.js'),
  ]
    .filter((p) => fs.existsSync(p))
    .map((p) => pathToFileURL(p).href);

  return ['@pg/shared/engine', '@pg/shared', ...local];
}

function isEngineModule(mod: unknown): mod is Record<string, unknown> {
  if (typeof mod !== 'object' || mod === null) return false;
  const m = mod as Record<string, unknown>;
  return (
    typeof m.createGame === 'function' &&
    typeof m.validateAction === 'function' &&
    typeof m.applyAction === 'function'
  );
}

export interface LoadedEngine {
  engine: RulesEngine;
  /** Which specifier satisfied the contract, or 'fallback'. */
  source: string;
  /** True when the real engine could not be found. */
  isFallback: boolean;
}

export async function loadEngine(logger: Logger): Promise<LoadedEngine> {
  for (const specifier of candidateSpecifiers()) {
    try {
      const mod: unknown = await import(/* @vite-ignore */ specifier);
      const candidate =
        isEngineModule(mod) ? mod
        : isEngineModule((mod as { default?: unknown })?.default) ? ((mod as { default: unknown }).default as Record<string, unknown>)
        : null;
      if (!candidate) continue;

      const engine: RulesEngine = {
        name: typeof candidate.name === 'string' ? candidate.name : specifier,
        createGame: candidate.createGame as RulesEngine['createGame'],
        validateAction: candidate.validateAction as RulesEngine['validateAction'],
        applyAction: candidate.applyAction as RulesEngine['applyAction'],
        ...(typeof candidate.defaultActionFor === 'function'
          ? { defaultActionFor: candidate.defaultActionFor as RulesEngine['defaultActionFor'] }
          : {}),
      };
      logger.info('Rules engine loaded', { source: specifier });
      return { engine, source: specifier, isFallback: false };
    } catch (err) {
      logger.debug('Engine candidate unavailable', {
        specifier,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.warn(
    'No rules engine found at @pg/shared/engine — running the PLACEHOLDER engine. ' +
      'Lobbies, persistence and reconnection are fully functional; game rules are not.',
  );
  return { engine: fallbackEngine, source: 'fallback', isFallback: true };
}
