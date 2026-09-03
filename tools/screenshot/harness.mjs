/**
 * Headless-browser harness for driving a real Dead of Winter match and
 * capturing screenshots of it.
 *
 * This exists because the quality bar in `docs/QUALITY-BAR-DOW.md` is almost
 * entirely visual, and a visual criterion can only be scored against pixels
 * from the running game. Nightly runs kept deferring that work partly because
 * there was nothing to drive the game with; this is that thing.
 *
 * It talks to the app the way a player does — clicking real controls by their
 * visible text — rather than reaching into React state, so a screenshot it
 * produces is evidence about the shipped interface and not about a fixture.
 *
 * Chromium is pre-installed in the container at `/opt/pw-browsers/chromium`.
 * Never run `playwright install`; it is not needed and will not work.
 *
 * Usage:
 *   node tools/screenshot/capture.mjs --help
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

export const CHROMIUM = process.env.TT_CHROMIUM ?? '/opt/pw-browsers/chromium';
export const CLIENT_ORIGIN = process.env.TT_CLIENT_ORIGIN ?? 'http://localhost:5173';

/**
 * The container's outbound proxy rejects Google's telemetry endpoints, and a
 * Chromium that is allowed to try them stalls `networkidle` for the whole
 * navigation timeout. These flags keep it entirely on localhost.
 */
export const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-proxy-server',
  '--proxy-bypass-list=*',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,OptimizationHints,MediaRouter',
  '--metrics-recording-only',
  '--mute-audio',
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1920, height = 1080, scale = 1 } = {}) {
  return puppeteer.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: [...CHROME_ARGS, `--window-size=${width},${height}`],
    defaultViewport: { width, height, deviceScaleFactor: scale },
    protocolTimeout: 180000,
  });
}

/**
 * Records everything the page says about itself. The quality bar requires a
 * clean console, so this is evidence, not debugging aid: `pageerror` and
 * localhost request failures are collected separately from ordinary logging.
 */
export function instrument(page) {
  const log = { console: [], errors: [], failedRequests: [] };
  page.on('console', (m) => log.console.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.errors.push(String(e.message ?? e)));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith('http://localhost')) {
      log.failedRequests.push(`${r.url()} — ${r.failure()?.errorText ?? 'unknown'}`);
    }
  });
  return log;
}

/**
 * Clicks the first enabled control whose visible text contains `text`.
 *
 * Polls rather than failing on the first miss: every screen here mounts after
 * a server round trip, so "not there yet" and "not there at all" look
 * identical at any single instant.
 */
export async function clickText(page, text, { tags = 'button,a,[role=button]', nth = 0, timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate(
      (tags, text, nth) => {
        const matches = [...document.querySelectorAll(tags)].filter(
          (e) =>
            (e.innerText || e.textContent || '').trim().toLowerCase().includes(text.toLowerCase()) &&
            !e.disabled &&
            e.offsetParent !== null,
        );
        const el = matches[nth];
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      },
      tags,
      text,
      nth,
    );
    if (ok) {
      await sleep(450);
      return true;
    }
    if (Date.now() > deadline) {
      throw new Error(`clickText: no enabled, visible control matching ${JSON.stringify(text)} after ${timeout}ms`);
    }
    await sleep(250);
  }
}

/** Clicks it if it is there; says so if it is not. Used for optional steps. */
export async function clickTextIfPresent(page, text, opts) {
  try {
    await clickText(page, text, opts);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sets a controlled React input by its placeholder, firing a real input event
 * so React's onChange sees it. Polls for the field for the same reason
 * `clickText` does.
 */
export async function fillByPlaceholder(page, placeholderFragment, value, { timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate(
      (frag, value) => {
        const el = [...document.querySelectorAll('input,textarea')].find((e) =>
          (e.placeholder || '').toLowerCase().includes(frag.toLowerCase()),
        );
        if (!el) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      placeholderFragment,
      value,
    );
    if (ok) {
      await sleep(250);
      return true;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `fillByPlaceholder: no field matching ${JSON.stringify(placeholderFragment)} after ${timeout}ms`,
      );
    }
    await sleep(250);
  }
}

/** A terse inventory of what is on screen — used to steer and to debug. */
export async function describe(page) {
  return page.evaluate(() => ({
    url: location.href,
    headings: [...document.querySelectorAll('h1,h2,h3,h4')].map((e) => e.innerText.trim()).slice(0, 20),
    controls: [...document.querySelectorAll('button,a[href],input,select')]
      .map((e) => {
        const t = (e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 46);
        return `${e.tagName}${e.disabled ? '(off)' : ''}:${t}`;
      })
      .filter((s) => s.length > 4)
      .slice(0, 60),
  }));
}

/**
 * Overflow report. V13/V15 forbid unintended scrollbars and forbid hiding
 * state behind scrolling, so this measures both the document and every
 * scrollable descendant rather than trusting the eye.
 */
export async function overflowReport(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollers = [...document.querySelectorAll('*')]
      .filter((e) => {
        const s = getComputedStyle(e);
        const canScroll = /(auto|scroll)/.test(s.overflowY + s.overflowX);
        return canScroll && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
      })
      .map((e) => ({
        sel: e.className && typeof e.className === 'string' ? `.${e.className.split(/\s+/).join('.')}` : e.tagName,
        hiddenY: e.scrollHeight - e.clientHeight,
        hiddenX: e.scrollWidth - e.clientWidth,
      }))
      .slice(0, 25);
    return {
      documentScrollsX: doc.scrollWidth > doc.clientWidth + 1,
      documentScrollsY: doc.scrollHeight > doc.clientHeight + 1,
      documentOverflowX: doc.scrollWidth - doc.clientWidth,
      documentOverflowY: doc.scrollHeight - doc.clientHeight,
      innerScrollers: scrollers,
    };
  });
}

/**
 * Creates a Dead of Winter table, fills it with bots, and starts it.
 * Returns the join code so a second browser can be pointed at the same table.
 */
export async function hostMatch(page, { players = 4, seed = 'dow-shot-1', hostName = 'Ada' } = {}) {
  /*
   * Straight to the game's own setup route rather than clicking through the
   * catalogue. Once the server has games in it the portal home also lists
   * resumable tables, whose tiles carry the same game name — clicking by text
   * there resumes an old table instead of creating a new one.
   */
  await page.goto(`${CLIENT_ORIGIN}/g/dead-of-winter`, { waitUntil: 'domcontentloaded' });
  await sleep(2200);

  await fillByPlaceholder(page, 'Friedemann', hostName);
  await clickTextIfPresent(page, 'Random'); // reveals the seed field if hidden
  await fillByPlaceholder(page, 'fresh shuffle', seed).catch(() => {});

  // The form opens on the minimum player count; step it up to the target.
  for (let i = 2; i < players; i++) await clickTextIfPresent(page, 'Increase Players');
  await sleep(300);

  await clickText(page, 'CREATE LOBBY');
  await sleep(2200);

  // Fill every remaining seat with a bot, then ready up and start.
  for (let i = 0; i < players - 1; i++) {
    if (!(await clickTextIfPresent(page, 'ADD BOT'))) break;
    await sleep(500);
  }
  await sleep(600);
  /* The control reads "I'm ready" while you are not, and "Not ready" once you
     are — so the ready action is the former. Matching on "m ready" hits it
     without also matching "Not ready". */
  await clickTextIfPresent(page, "m ready");
  await sleep(700);

  const code = await readJoinCode(page);

  await clickText(page, 'START GAME');
  await sleep(3000);
  return code;
}

/**
 * Pulls the shareable join code out of the lobby chrome.
 *
 * The code is rendered inside `.tt-gamecode` with an `aria-label` that spells
 * it out letter by letter for screen readers; reading the label back is more
 * robust than scraping the visible glyphs, which are letter-spaced.
 */
export async function readJoinCode(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.tt-gamecode [aria-label^="Game code"]');
    if (el) return el.getAttribute('aria-label').replace(/^Game code\s*/, '').replace(/\s+/g, '');
    const holder = document.querySelector('.tt-gamecode');
    return holder ? holder.innerText.trim().split('\n')[0].replace(/\s+/g, '') : null;
  });
}

/**
 * Clears whatever setup decision the game opens on.
 *
 * Dead of Winter's start is not a single screen: depending on settings the
 * host may be asked to keep a subset of survivors, order the first player, or
 * acknowledge an objective before the board is live. Rather than encode each
 * one, this picks the required number of choices in whatever dialog is open
 * and confirms, repeating until no dialog remains.
 */
export async function resolveSetup(page, { maxSteps = 12 } = {}) {
  const steps = [];

  /* Setup modals mount after a server round trip, so absence has to be
     established by waiting rather than by a single miss. */
  const waitForDialog = async (ms = 4000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const title = await page.evaluate(() => {
        const dlg = document.querySelector('.tt-modal, [role=dialog]');
        if (!dlg || dlg.offsetParent === null) return null;
        return (dlg.innerText || '').split('\n')[0].trim().slice(0, 80);
      });
      if (title) return title;
      if (Date.now() > deadline) return null;
      await sleep(250);
    }
  };

  const readDialog = () =>
    page.evaluate(() => {
      const dlg = document.querySelector('.tt-modal, [role=dialog]');
      if (!dlg || dlg.offsetParent === null) return null;
      const confirm = [...dlg.querySelectorAll('.tt-modal__footer button')].find((b) =>
        /^(confirm|done)\b/i.test((b.innerText || '').trim()),
      );
      const options = [
        ...dlg.querySelectorAll('.tt-modal__body .dow-choice__option, .tt-modal__body [role=option]'),
      ].filter((e) => !e.disabled && e.offsetParent !== null);
      return {
        title: (dlg.innerText || '').split('\n')[0].trim().slice(0, 80),
        options: options.length,
        selected: options.filter((o) => o.getAttribute('aria-pressed') === 'true').length,
        hasConfirm: !!confirm,
        confirmEnabled: !!confirm && !confirm.disabled,
      };
    });

  const clickOption = (index) =>
    page.evaluate((i) => {
      const dlg = document.querySelector('.tt-modal, [role=dialog]');
      if (!dlg) return false;
      const options = [
        ...dlg.querySelectorAll('.tt-modal__body .dow-choice__option, .tt-modal__body [role=option]'),
      ].filter((e) => !e.disabled && e.offsetParent !== null);
      if (!options[i]) return false;
      options[i].click();
      return true;
    }, index);

  for (let step = 0; step < maxSteps; step++) {
    const title = await waitForDialog(step === 0 ? 6000 : 3000);
    if (!title) break;

    const before = await readDialog();
    if (!before) break;

    /*
     * Two shapes of decision exist. A multi-select gates a Confirm button and
     * is answered by selecting until Confirm enables, then pressing it. A
     * single-select has no footer button at all and commits on the click. Each
     * click is its own round trip: React batches state updates inside one
     * synchronous block, so a loop that clicked every option in a single
     * `page.evaluate` would never see Confirm enable and would over-select.
     */
    let clicked = 0;
    for (let i = 0; i < Math.max(before.options, 1); i++) {
      const now = await readDialog();
      if (!now) break; // committed and closed under us — a single-select
      if (now.hasConfirm && now.confirmEnabled) break;
      if (!(await clickOption(i))) break;
      clicked++;
      await sleep(300);
      if (!now.hasConfirm) break; // single-select: one click is the answer
    }

    const after = await readDialog();
    let outcome;
    if (!after) {
      outcome = 'committed on select';
    } else if (after.confirmEnabled) {
      await page.evaluate(() => {
        const dlg = document.querySelector('.tt-modal, [role=dialog]');
        [...dlg.querySelectorAll('.tt-modal__footer button')]
          .find((b) => /^(confirm|done)\b/i.test((b.innerText || '').trim()) && !b.disabled)
          ?.click();
      });
      outcome = 'confirmed';
    } else {
      /* Nothing left to answer — an acknowledgement rather than a decision. */
      const dismissed = await page.evaluate(() => {
        const dlg = document.querySelector('.tt-modal, [role=dialog]');
        const b = [...dlg.querySelectorAll('.tt-modal__footer button')].find(
          (x) => !x.disabled && /look at the board|continue|ok|close/i.test((x.innerText || '').trim()),
        );
        if (!b) return false;
        b.click();
        return true;
      });
      outcome = dismissed ? 'dismissed' : 'STUCK';
    }

    steps.push(`${title} — ${clicked}/${before.options} picked, ${outcome}`);
    if (outcome === 'STUCK') break;
    await sleep(1400);
  }
  return steps;
}

export function outDir(sub = '') {
  const base = process.env.TT_SHOT_DIR ?? path.join(process.cwd(), '.shots');
  const dir = sub ? path.join(base, sub) : base;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
