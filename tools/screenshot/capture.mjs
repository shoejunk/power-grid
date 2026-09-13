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

import {
  launch,
  instrument,
  sleep,
  hostMatch,
  hostMatchEvidence,
  resolveSetup,
  assertLiveMatch,
  describe,
  overflowReport,
  outDir,
} from './harness.mjs';

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

if (!Number.isInteger(players) || players < 3 || players > 5) {
  throw new Error(`--players must be an integer from 3 through 5 for the standard Dead of Winter setup (got ${players})`);
}

const targets = only ? RESOLUTIONS.filter((r) => r.name === only) : RESOLUTIONS;
const report = {
  capturedAt: new Date().toISOString(),
  requestedPlayerCount: players,
  seed,
  resolutions: {},
};
const failures = [];

for (const res of targets) {
  console.log(`\n=== ${res.name} ===`);
  const browser = await launch(res);
  let page = null;
  try {
    page = await browser.newPage();
    const log = instrument(page);

    const code = await hostMatch(page, { players, seed });
    console.log('join code:', code);

    // Clear the setup decisions so the shot is of a live board, not a modal.
    const setupSteps = await resolveSetup(page);
    console.log('setup steps:', setupSteps);

    // Let any entry animation settle before proving the state that the
    // screenshot and report will actually represent.
    await sleep(2500);

    // Do not treat resolveSetup returning as proof: the server may still be in
    // setup while another required seat is unresolved. Require the visible
    // server-backed phase and all rendered seats before capturing evidence.
    const setupLiveAssertion = await assertLiveMatch(page, { expectedPlayers: players });
    console.log('setup/live assertion:', setupLiveAssertion);

    const file = path.join(dir, `match-${res.name}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);

    const shape = await describe(page);
    const overflow = await overflowReport(page);

    report.resolutions[res.name] = {
      screenshot: path.basename(file),
      joinCode: code,
      requestedPlayerCount: players,
      ...hostMatchEvidence(page),
      actualPlayerCount: setupLiveAssertion.actualPlayerCount,
      actualSeats: setupLiveAssertion.seats,
      setupSteps,
      setupLiveAssertion,
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
    failures.push({ resolution: res.name, error: err.message });
    const evidence = page ? hostMatchEvidence(page) : null;
    report.resolutions[res.name] = {
      requestedPlayerCount: players,
      ...(evidence ?? {}),
      setupLiveAssertion: { passed: false, error: err.message },
      error: err.message,
    };
  } finally {
    await browser.close();
  }
}

fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
console.log('\nreport:', path.join(dir, 'report.json'));

if (failures.length > 0) {
  console.error(`\nCapture failed evidence gate for ${failures.length} resolution(s):`);
  for (const failure of failures) console.error(`- ${failure.resolution}: ${failure.error}`);
  process.exitCode = 1;
}
