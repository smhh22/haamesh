/**
 * Two-device sync harness: two fully isolated browser contexts (separate
 * storage = separate devices) against a real WebDAV server, exercising the
 * actual sync engine end-to-end through the app UI.
 *
 * Usage: node scripts/two-device-sync.mjs
 * Requires: dev server on :5173 (started automatically if missing), DAV server
 * on :8081 (spawned by this script), Playwright chromium.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const DEV_URL = 'http://127.0.0.1:5173';
const DAV_URL = 'http://127.0.0.1:8081';
const FIXTURE = fileURLToPath(new URL('../e2e/fixtures/sample.epub', import.meta.url));
const ARTIFACTS = 'e2e/artifacts/two-device';
mkdirSync(ARTIFACTS, { recursive: true });

const log = (message) => console.log(message);
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const waitFor = async (url, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url).catch(() => null);
      if (response) return true;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
};

const children = [];
const startDevServer = async () => {
  if (await waitFor(DEV_URL, 1500)) {
    log('dev server already running');
    return;
  }
  log('starting dev server…');
  const child = spawn('pnpm', ['dev'], { stdio: 'ignore', detached: true });
  children.push(child);
  if (!(await waitFor(DEV_URL, 60000))) throw new Error('dev server did not start');
};

const startDavServer = async () => {
  // Deterministic runs: wipe the previous DAV root.
  const { rmSync, existsSync } = await import('node:fs');
  rmSync('/tmp/hamesh-dav-data', { recursive: true, force: true });
  log(`dav root after wipe: exists=${existsSync('/tmp/hamesh-dav-data')}`);
  log('starting DAV server…');
  const child = spawn('node', ['scripts/dav-server.mjs', '8081'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.push(child);
  child.stdout.on('data', (chunk) => process.stdout.write(`[dav] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[dav] ${chunk}`));
  child.on('exit', (code) => log(`[dav] child exited with code ${code}`));
  if (!(await waitFor(`${DAV_URL}/`, 10000))) throw new Error('DAV server did not start');
};

const SYNC_CONFIG = {
  provider: 'webdav',
  baseUrl: DAV_URL,
  username: 'alice',
  password: 'secret',
  localFolder: '',
  hasPassword: false,
};

const openDevice = async (browser, name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((config) => {
    localStorage.setItem('hamesh.sync.config', JSON.stringify(config));
  }, SYNC_CONFIG);
  const page = await context.newPage();
  page.on('pageerror', (error) => fail(`[${name}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    if (text.includes('404 (Not Found)') || text.includes('405 (Method Not Allowed)')) return;
    log(`[${name}] console.${type}: ${text.slice(0, 200)}`);
  });
  return { context, page };
};

// Sync lives in the app-level settings dialog since Batch 2, so each sync
// interaction opens it first and closes it afterwards.
const openSettings = async (page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 10000 });
};

const closeSettings = async (page) => {
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Settings' })
    .waitFor({ state: 'detached', timeout: 10000 });
};

const syncNow = async (page, label) => {
  await openSettings(page);
  const syncButton = page.getByRole('button', { name: 'Sync now' });
  await syncButton.click();
  // The report lands in a .hint paragraph after the buttons.
  await page.waitForFunction(
    () => {
      const hints = [...document.querySelectorAll('.sync-settings .hint')];
      return hints.some((hint) =>
        /Pulled|downloaded|failed|failed|Sync failed/i.test(hint.textContent ?? ''),
      );
    },
    null,
    { timeout: 30000 },
  );
  const hints = await page.locator('.sync-settings .hint').allTextContents();
  log(
    `[${label}] sync result: ${hints.filter((text) => text && !text.startsWith('Last sync')).join(' | ')}`,
  );
  await page.screenshot({ path: `${ARTIFACTS}/${label}-after-sync.png` });
  await closeSettings(page);
};

const createHighlight = async (page) => {
  const frame = page
    .frames()
    .filter((item) => item.url().startsWith('blob:'))
    .pop();
  if (!frame) throw new Error('no book frame');
  await frame.waitForSelector('p');
  await frame.evaluate(() => {
    const paragraph = document.querySelector('p');
    if (!paragraph) throw new Error('no paragraph');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const popover = page.locator('.selection-popover');
  await popover.getByRole('button', { name: 'Yellow' }).waitFor({ timeout: 10000 });
  await popover.getByRole('button', { name: 'Yellow' }).click();
};

let browser = null;

const main = async () => {
  await startDavServer();
  await startDevServer();

  browser = await chromium.launch({ args: ['--disable-web-security'] });
  const deviceA = await openDevice(browser, 'device-a');
  const deviceB = await openDevice(browser, 'device-b');

  // ---- Device A: import, read, annotate ----
  log('device A: import fixture');
  await deviceA.page.goto(DEV_URL);
  await deviceA.page.locator('input[type="file"]').setInputFiles(FIXTURE);
  await deviceA.page.waitForFunction(
    () => document.querySelector('.library')?.getAttribute('aria-busy') === 'false',
    null,
    { timeout: 30000 },
  );
  await deviceA.page.waitForTimeout(2000); // extraction is fire-and-forget
  await deviceA.page.getByRole('heading', { name: 'نمونه کتاب' }).waitFor();

  log('device A: read two pages and annotate');
  await deviceA.page.getByRole('button', { name: 'Read' }).click();
  await deviceA.page.waitForFunction(
    () => document.querySelector('.reader-shell')?.getAttribute('data-ready') === 'true',
    null,
    { timeout: 20000 },
  );
  const progress = deviceA.page.locator('.reader-progress');
  const initial = await progress.textContent();
  await deviceA.page.getByRole('button', { name: 'Next' }).click();
  await deviceA.page.waitForTimeout(900);
  await deviceA.page.getByRole('button', { name: 'Next' }).click();
  await deviceA.page.waitForTimeout(900);
  const advanced = await progress.textContent();
  if (advanced === initial) fail('device A progress did not advance');
  await createHighlight(deviceA.page);
  await deviceA.page.getByRole('button', { name: 'Bookmark' }).click();
  await deviceA.page.waitForTimeout(800);
  const aNotes = await deviceA.page.locator('.note-item').count();
  log(`device A: local notes after annotate: ${aNotes}`);
  if (aNotes !== 2) fail(`expected exactly 2 local notes on A, got ${aNotes}`);
  await deviceA.page.getByRole('button', { name: 'Library' }).click();

  log('device A: sync up');
  await syncNow(deviceA.page, 'device-a');

  // ---- Device B: pull, verify book, progress, notes, content search ----
  log('device B: open and sync');
  await deviceB.page.goto(DEV_URL);
  await deviceB.page.waitForFunction(
    () => document.querySelector('.library')?.getAttribute('aria-busy') === 'false',
    null,
    { timeout: 30000 },
  );
  await syncNow(deviceB.page, 'device-b');
  await deviceB.page.getByRole('heading', { name: 'نمونه کتاب' }).waitFor({ timeout: 20000 });
  log('device B: book arrived via sync');

  await deviceB.page.getByRole('button', { name: 'Read' }).click();
  await deviceB.page.waitForFunction(
    () => document.querySelector('.reader-shell')?.getAttribute('data-ready') === 'true',
    null,
    { timeout: 20000 },
  );
  const bProgress = await deviceB.page.locator('.reader-progress').textContent();
  log(`device B: resumed progress "${bProgress}" (A was "${advanced}")`);
  if (bProgress !== advanced) fail(`progress mismatch: A="${advanced}" B="${bProgress}"`);
  await deviceB.page.getByRole('button', { name: 'Notes' }).click();
  const noteCount = await deviceB.page.locator('.note-item').count();
  log(`device B: notes received: ${noteCount}`);
  if (noteCount < 2) fail(`expected >=2 notes on device B, got ${noteCount}`);
  await deviceB.page.getByRole('button', { name: 'Library' }).click();

  log('device B: content search over synced book (extraction reconciliation)');
  await deviceB.page.getByPlaceholder('Search title, author, or series').fill('پاراگراف شمارهٔ 3');
  await deviceB.page.waitForTimeout(1500);
  const contentMatch = deviceB.page.locator('.content-matches button').first();
  const contentVisible = await contentMatch.isVisible().catch(() => false);
  if (!contentVisible) fail('content search found nothing in the synced book');
  else log('device B: content match found');

  // ---- Simultaneous rounds: both devices sync at the same moment ----
  // The content-search phase left a filter in the search box; clear it so
  // the assertions below see the full library.
  await deviceB.page.getByPlaceholder('Search title, author, or series').fill('');
  await deviceB.page.waitForTimeout(400);
  log('simultaneous sync rounds (5x, both devices at once)');
  const clickSync = async (page) => {
    await page.getByRole('button', { name: 'Sync now' }).click();
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll('.sync-settings button')].find(
          (element) => element.textContent?.trim() === 'Sync now',
        );
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      null,
      { timeout: 30000 },
    );
  };
  for (let round = 0; round < 5; round += 1) {
    await Promise.all([openSettings(deviceA.page), openSettings(deviceB.page)]);
    await Promise.all([clickSync(deviceA.page), clickSync(deviceB.page)]);
    await Promise.all([closeSettings(deviceA.page), closeSettings(deviceB.page)]);
  }
  // Nothing may be lost while both devices race the same index.
  await deviceB.page.waitForTimeout(1200);
  if (!(await deviceB.page.getByRole('heading', { name: 'نمونه کتاب' }).isVisible())) {
    fail('book vanished from device B after simultaneous rounds');
  }
  // ---- Tombstone: delete on B, expect removal on A ----
  log('device B: delete book, sync; device A syncs and should lose it');
  await deviceB.page.getByPlaceholder('Search title, author, or series').fill('');
  await deviceB.page.waitForTimeout(500);
  await deviceB.page.locator('.book-grid').getByRole('button', { name: 'Remove' }).click();
  await deviceB.page.waitForTimeout(500);
  await syncNow(deviceB.page, 'device-b-after-delete');
  await syncNow(deviceA.page, 'device-a-after-delete');
  await deviceA.page.waitForTimeout(1500);
  const aHasBook = await deviceA.page
    .getByRole('heading', { name: 'نمونه کتاب' })
    .isVisible()
    .catch(() => false);
  if (aHasBook) fail('device A still shows the tombstoned book');
  else log('device A: tombstone propagated, book removed');

  await deviceA.context.close();
  await deviceB.context.close();
  await browser.close();

  const indexResponse = await fetch(`${DAV_URL}/Hamesh/index.json`, {
    headers: { Authorization: `Basic ${Buffer.from('alice:secret').toString('base64')}` },
  });
  const index = await indexResponse.json();
  const devices = Object.keys(index.devices ?? {});
  log(`remote index: ${devices.length} device id(s)`);
  if (devices.length > 2) fail(`device-id churn: expected <=2 ids, saw ${devices.length}`);

  log(process.exitCode ? 'TWO-DEVICE TEST: FAILED' : 'TWO-DEVICE TEST: PASSED');
};

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  console.error(error);
} finally {
  // Never leave a browser behind: a hung Playwright process keeps retrying
  // connection-refused against the servers we just killed.
  try {
    await browser?.close();
  } catch {
    // already closed
  }
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  process.exit(process.exitCode ?? 0);
}
