/**
 * Captures a Dead of Winter match at every resolution the quality bar names,
 * plus an overflow and console report for each.
 *
 * Prerequisites — both dev servers must already be running:
 *   npm run dev:server &
 *   npm run dev:client &
 *
 * Then:
 *   node tools/screenshot/capture.mjs
 *   node tools/screenshot/capture.mjs --players 5 --out .shots/run22
 *
 * Every image lands in the output directory alongside `report.json`, which
 * records the console output, page errors and overflow measurements that
 * V6/V12/V13/V15 are scored against. Read the images; do not infer from
 * the fact that the script exited zero.
 */
import fs from 'node:fs';
import path from 'node:path';

import { launch, instrument, sleep, hostMatch, resolveSetup, describe, overflowReport, outDir } from './harness.mjs';

/** The five resolutions `docs/QUALITY-BAR-DOW.md` V13 requires. */
const RESOLUTIONS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3840x2160', width: 3840, height: 2160 },
];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (process.argv.includes('--help')) {
  console.log('Usage: node tools/screenshot/capture.mjs [--players N] [--seed S] [--out DIR] [--only WxH]');
  process.exit(0);
}

const players = Number(arg('--players', '4'));
const seed = arg('--seed', 'dow-shot-1');
const only = arg('--only', null);
const dir = arg('--out', null) ?? outDir('match');
fs.mkdirSync(dir, { recursive: true });

const targets = only ? RESOLUTIONS.filter((r) => r.name === only) : RESOLUTIONS;
const report = { capturedAt: new Date().toISOString(), players, seed, resolutions: {} };

for (const res of targets) {
  console.log(`\n=== ${res.name} ===`);
  const browser = await launch(res);
  try {
    const page = await browser.newPage();
    const log = instrument(page);

    const code = await hostMatch(page, { players, seed });
    console.log('join code:', code);

    // Clear the setup decisions so the shot is of a live board, not a modal.
    const setupSteps = await resolveSetup(page);
    console.log('setup steps:', setupSteps);

    // Let any entry animation settle so the shot is of the resting state.
    await sleep(2500);

    const file = path.join(dir, `match-${res.name}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);

    const shape = await describe(page);
    const overflow = await overflowReport(page);

    report.resolutions[res.name] = {
      screenshot: path.basename(file),
      joinCode: code,
      setupSteps,
      url: shape.url,
      headings: shape.headings,
      controlCount: shape.controls.length,
      overflow,
      console: log.console,
      pageErrors: log.errors,
      failedRequests: log.failedRequests,
    };

    if (overflow.documentScrollsX) console.log('!! horizontal document scrollbar');
    if (log.errors.length) console.log('!! page errors:', log.errors);
  } catch (err) {
    console.error(`FAILED at ${res.name}:`, err.message);
    report.resolutions[res.name] = { error: err.message };
  } finally {
    await browser.close();
  }
}

fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
console.log('\nreport:', path.join(dir, 'report.json'));
