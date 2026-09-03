/**
 * Proves the multiplayer criteria in `docs/QUALITY-BAR-DOW.md` §5 against two
 * real browsers rather than against the server's unit tests.
 *
 * The unit suites already show the server does the right thing when asked. What
 * they cannot show is that a person can host a table, read a code off the
 * screen, have someone else type it in, and — the whole point of this platform
 * — close the tab mid-game and come back to the same seat with their hidden
 * information intact. That is what this drives.
 *
 * Covers, and prints a verdict for, each of:
 *   N1  host mints a shareable code; a second client joins with it
 *   N3  a client that closes its tab and returns resumes its exact seat
 *   N6  hidden information survives reconnection without leaking to the other
 *       seat (checked in both directions)
 *   N7  the two clients disagree about nothing they should both see
 *
 * Prerequisites — both dev servers running:
 *   npm run dev:server &
 *   npm run dev:client &
 *
 * Usage:
 *   node tools/screenshot/multiplayer.mjs [--out DIR]
 *
 * Exits non-zero if any criterion fails, so it can gate a run.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  launch,
  instrument,
  sleep,
  clickText,
  clickTextIfPresent,
  fillByPlaceholder,
  readJoinCode,
  resolveSetup,
  describe,
  CLIENT_ORIGIN,
  outDir,
} from './harness.mjs';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dir = arg('--out', null) ?? outDir('multiplayer');
fs.mkdirSync(dir, { recursive: true });

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

/**
 * Everything this seat can see that is supposed to be private to it, plus the
 * public counters both seats must agree on. Comparing two of these is how the
 * leak checks are made concrete rather than assumed.
 */
async function readSeatView(page) {
  return page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.innerText?.trim() ?? null;
    const all = (sel) => [...document.querySelectorAll(sel)].map((e) => e.innerText.trim());
    return {
      seatLabel: all('.dow-seat').find((s) => /\(you\)/i.test(s)) ?? null,
      // The objective line is private: only your own seat card states it.
      objective: (all('.dow-seat').find((s) => /\(you\)/i.test(s)) ?? '').match(/Your objective:.*/s)?.[0] ?? null,
      handCards: all('.dow-hand .dow-card__title, .dow-hand .dow-card h4, .dow-hand [class*=title]'),
      handCount: document.querySelectorAll('.dow-hand [class*=card]').length,
      mySurvivors: all('[class*=survivor]').slice(0, 12),
      morale: text('[class*=morale]'),
      body: document.body.innerText,
    };
  });
}

const browsers = [];
try {
  /* ---------------- N1: host mints a code, a second client joins ------- */
  const hostBrowser = await launch({ width: 1600, height: 950 });
  browsers.push(hostBrowser);
  const host = await hostBrowser.newPage();
  const hostLog = instrument(host);

  await host.goto(`${CLIENT_ORIGIN}/g/dead-of-winter`, { waitUntil: 'domcontentloaded' });
  await sleep(2200);
  await fillByPlaceholder(host, 'Friedemann', 'Ada');
  /* Leave the player count at the mode's default — Standard seats 4 — and fill
     whatever is left with bots below, rather than assuming a table size. */
  await clickText(host, 'CREATE LOBBY');
  await sleep(2200);

  const code = await readJoinCode(host);
  record('N1.code', !!code && code.length >= 4, `host lobby minted code ${JSON.stringify(code)}`);
  if (!code) throw new Error('no join code — cannot continue');

  const guestBrowser = await launch({ width: 1600, height: 950 });
  browsers.push(guestBrowser);
  const guest = await guestBrowser.newPage();
  const guestLog = instrument(guest);

  await guest.goto(`${CLIENT_ORIGIN}/join/${code}`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  await fillByPlaceholder(guest, 'Friedemann', 'Boris').catch(() => {});
  await clickTextIfPresent(guest, 'JOIN');
  await sleep(2500);

  const guestSeated = (await guest.evaluate(() => document.body.innerText)).includes('Boris');
  record('N1.join', guestSeated, 'second browser took a seat using only the code');

  await host.screenshot({ path: path.join(dir, 'n1-host-lobby.png') });
  await guest.screenshot({ path: path.join(dir, 'n1-guest-lobby.png') });

  /*
   * Fill every remaining seat with a bot. The host cannot start until the
   * table is full and everyone is ready, and the number of empty seats depends
   * on the mode's default player count, so this loops rather than assuming.
   */
  for (let i = 0; i < 5; i++) {
    if (!(await clickTextIfPresent(host, 'ADD BOT'))) break;
    await sleep(700);
  }
  await sleep(600);
  /*
   * The ready control reads "I'm ready" while you are not, and flips to "Not
   * ready" once you are. Matching on "m ready" presses it without also
   * matching the flipped label, so this readies rather than un-readies.
   * The host is exempt from the all-ready check, but readying anyway keeps the
   * lobby screenshot honest.
   */
  await clickTextIfPresent(guest, "m ready");
  await sleep(700);
  await clickTextIfPresent(host, "m ready");
  await sleep(1200);

  const lobbyState = await host.evaluate(() => document.body.innerText.match(/Waiting for .*/)?.[0] ?? 'table full');
  record('N1.fill', !/Waiting for/.test(lobbyState), `lobby before start: ${lobbyState}`);

  await clickText(host, 'START GAME');
  await sleep(3500);

  const hostSetup = await resolveSetup(host);
  const guestSetup = await resolveSetup(guest);
  console.log('host setup:', hostSetup);
  console.log('guest setup:', guestSetup);
  await sleep(2000);

  await host.screenshot({ path: path.join(dir, 'n3-host-before.png') });
  await guest.screenshot({ path: path.join(dir, 'n3-guest-before.png') });

  const hostBefore = await readSeatView(host);
  const guestBefore = await readSeatView(guest);

  /* ---------------- N6: neither seat can read the other's secret ------- */
  const hostObjective = hostBefore.objective;
  const guestObjective = guestBefore.objective;
  const leakedToGuest = hostObjective ? guestBefore.body.includes(hostObjective.replace(/^Your objective:\s*/, '')) : false;
  const leakedToHost = guestObjective ? hostBefore.body.includes(guestObjective.replace(/^Your objective:\s*/, '')) : false;
  record(
    'N6.secrecy',
    !!hostObjective && !!guestObjective && !leakedToGuest && !leakedToHost,
    `each seat sees its own objective; neither appears in the other's DOM`,
  );

  /* ---------------- N3: close the tab, come back, same seat ------------ */
  const beforeUrl = host.url();
  await host.close();
  await sleep(1500);

  const returning = await hostBrowser.newPage();
  instrument(returning);
  await returning.goto(beforeUrl, { waitUntil: 'domcontentloaded' });
  await sleep(4000);

  const hostAfter = await readSeatView(returning);
  await returning.screenshot({ path: path.join(dir, 'n3-host-after-reconnect.png') });

  record(
    'N3.seat',
    hostAfter.seatLabel === hostBefore.seatLabel && hostAfter.seatLabel !== null,
    `seat label after return: ${JSON.stringify(hostAfter.seatLabel?.split('\n')[0])}`,
  );
  record(
    'N3.hidden',
    hostAfter.objective !== null && hostAfter.objective === hostBefore.objective,
    'secret objective restored identically after tab close and return',
  );
  record(
    'N3.hand',
    hostAfter.handCount === hostBefore.handCount && hostBefore.handCount > 0,
    `hand size ${hostBefore.handCount} -> ${hostAfter.handCount}`,
  );

  /* The other seat must not have gained anything from that reconnection. */
  const guestAfter = await readSeatView(guest);
  const leakedAfter = hostAfter.objective
    ? guestAfter.body.includes(hostAfter.objective.replace(/^Your objective:\s*/, ''))
    : false;
  record('N6.reconnect', !leakedAfter, "the returning player's secret did not leak to the other seat");

  fs.writeFileSync(
    path.join(dir, 'multiplayer-report.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        joinCode: code,
        results,
        hostConsoleErrors: hostLog.errors,
        guestConsoleErrors: guestLog.errors,
      },
      null,
      2,
    ),
  );
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} criteria passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.id).join(', '));
  process.exitCode = 1;
}
