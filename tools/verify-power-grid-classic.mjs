/** Compare classic rules to the pre-Industry commit, including full logs and RNG.
 * Run: node --import tsx --conditions=development tools/verify-power-grid-classic.mjs
 * Writes only a disposable reference source copy under ignored .shots/.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const industryVersion = process.argv.includes('--industry-v7') ? 7 : process.argv.includes('--industry-v6') ? 6 : process.argv.includes('--industry-v5') ? 5 : 4;
const legacyIndustry = process.argv.includes('--legacy-industry') || industryVersion >= 5;
const reference = industryVersion === 7 ? '6484659a464c4e70b05cc322417c5a7719feb584' : industryVersion === 6 ? 'b9080a1500dbeae481cae2a76daaf806d5bd9460' : industryVersion === 5 ? 'f375e74518afb6a4a807d08ae28b8f181e7d462c' : legacyIndustry ? 'a64be9b39302a5ef8d5bc5085a1d864c94b4fc3b' : '4cc87a660c0afb173af007ca52697e8aad98d5fb';
const prefix = 'packages/games/power-grid/';
const root = resolve(legacyIndustry ? `.shots/industry-v${industryVersion}-reference` : '.shots/industry-classic-reference');
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', reference, `${prefix}src`, `${prefix}package.json`], { encoding: 'utf8' }).trim().split('\n');
for (const file of files) {
  const target = resolve(root, file.slice(prefix.length));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, execFileSync('git', ['show', `${reference}:${file}`]));
}
const { powerGrid: before } = await import(pathToFileURL(resolve(root, 'src/index.ts')).href);
const { powerGrid: after } = await import('../packages/games/power-grid/src/index.ts');
for (const version of legacyIndustry ? [industryVersion] : [1, 2, 3]) {
  for (const count of [2, 4]) {
    const seats = Array.from({ length: count }, (_, i) => ({ playerId: `p${i + 1}`, name: `P${i + 1}`, color: before.descriptor.seatColors[i], isBot: true }));
    const settings = { ...before.defaultSettings(), playerCount: count, seed: 'classic-preservation', ...(legacyIndustry ? { rulesMode: 'industry' } : {}) };
    const ctx = { gameId: 'classic-check', code: 'REF001', hostId: 'p1', seed: 'classic-preservation', now: 1000, replayVersion: version };
    let oldState = before.createGame(ctx, settings, seats);
    let newState = after.createGame(ctx, settings, seats);
    assert.deepEqual(newState, oldState);
    let actions = 0;
    for (; actions < (legacyIndustry ? 2200 : 160) && oldState.phase !== 'gameOver'; actions++) {
      const actor = oldState.activePlayerId;
      const action = before.defaultActionFor(oldState, actor);
      assert.deepEqual(after.defaultActionFor(newState, actor), action, `classic bot changed v${version}, ${count} seats, action ${actions}`);
      oldState = before.applyAction(oldState, actor, action, 1001 + actions);
      newState = after.applyAction(newState, actor, action, 1001 + actions);
      assert.deepEqual(newState, oldState, `classic state changed v${version}, ${count} seats, action ${actions}`);
    }
    if (legacyIndustry) assert.equal(oldState.phase, 'gameOver');
    console.log(JSON.stringify({ version, players: count, actions, identical: true, hash: createHash('sha256').update(JSON.stringify(newState)).digest('hex') }));
  }
}
