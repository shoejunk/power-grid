/** UI fixture smoke, not a live multiplayer or balance test.
 * Run node tools/screenshot/industry-smoke.mjs; starts its own local Vite server.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5188'],
  { cwd: resolve('packages/client'), windowsHide: true, stdio: 'pipe' });
process.on('exit', () => server.kill());
await new Promise((ready, reject) => {
  const timeout = setTimeout(() => reject(new Error('Vite did not start')), 15000);
  server.on('error', reject);
  server.stdout.on('data', data => { if (data.toString().includes('Local:')) { clearTimeout(timeout); ready(); } });
  server.stderr.on('data', data => process.stderr.write(data));
});
const cache = resolve(homedir(), '.cache/puppeteer/chrome');
const cached = existsSync(cache) ? readdirSync(cache).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  .map(version => resolve(cache, version, 'chrome-win64/chrome.exe')).find(existsSync) : undefined;
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER_EXE ?? cached ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const out = resolve('.shots/industry-ui'); mkdirSync(out, { recursive: true });
const errors = [];
const page = await browser.newPage();
page.on('pageerror', error => errors.push(String(error)));
const base = 'http://127.0.0.1:5188/src/games/power-grid/game/dev/industry-preview.html';
async function open(view) {
  console.log(`Checking ${view}`);
  await page.goto(`${base}?view=${view}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.industryFixture);
}
async function clickText(text) {
  await page.waitForFunction(value => [...document.querySelectorAll('button')].some(b => b.textContent?.trim() === value && !b.disabled), {}, text);
  await page.evaluate(value => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === value && !b.disabled).click(), text);
}
try {
  await page.setViewport({ width: 1600, height: 1000 });
  await open('settings');
  await page.waitForSelector('button[role="switch"]');
  await page.evaluate(() => {
    const input = document.querySelector('button[role="switch"]');
    input.click();
  });
  await page.waitForFunction(() => window.industryFixture.settings.rulesMode === 'industry');
  await page.screenshot({ path: resolve(out, 'settings.png'), fullPage: true });
  await open('auction');
  await page.waitForSelector('button.pg-facility');
  await page.click('button.pg-facility[aria-label="Small Coal Mine"]');
  await clickText('Submit sealed range');
  await page.waitForFunction(() => window.industryFixture.state().auction?.plantId === 101);
  await page.screenshot({ path: resolve(out, 'facility-auction.png') });
  await page.evaluate(() => window.industryFixture.action({ type: 'passBid' }));
  await page.waitForFunction(() => Object.values(window.industryFixture.state().players).some(p => p.facilities?.includes(101)));
  await open('scrap');
  await page.waitForSelector('.pg-gscrap .pg-facility');
  await page.screenshot({ path: resolve(out, 'six-card-scrap.png') });
  await page.click('.pg-gscrap .pg-facility[aria-label="Small Oil Refinery"]');
  await clickText('Scrap Small Oil Refinery');
  await page.waitForFunction(() => window.industryFixture.state().scrappedFacilities?.includes(104));
  await open('end');
  assert.match(await page.$eval('body', el => el.innerText), /All final-round income paid/);
  assert.doesNotMatch(await page.$eval('body', el => el.innerText), /No cash paid|This phase pays nothing/);
  await page.screenshot({ path: resolve(out, 'cash-victory.png') });
  await open('classic');
  assert.equal(await page.$('.pg-facility'), null);
  await page.screenshot({ path: resolve(out, 'classic.png') });
  await page.setViewport({ width: 1280, height: 800 });
  await open('auction');
  await page.screenshot({ path: resolve(out, 'industry-1280.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ passed: true, errors, overflow, checks: ['settings opt-in', 'facility nomination and sealed auction', 'facility ownership', 'six-card scrap', 'cash victory', 'classic mode', '1280px viewport'] }, null, 2));
  console.log(`Industry UI smoke passed. Screenshots: ${out}`);
} catch (error) {
  console.error('Page errors:', errors);
  await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser.close(); server.kill(); }
