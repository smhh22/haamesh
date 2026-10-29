/**
 * Stress check against real-world books in ~/Desktop/books. Not part of the
 * e2e suite (large fixtures); run manually: node scripts/stress-books.mjs
 * Requires the dev server on :5173.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BOOKS = '/home/smhh22/Desktop/books';
const TARGETS = [
  {
    file: `${BOOKS}/Calculus-A-Complete-Course-Adams-9th-Edition-[konkur.in].pdf`,
    label: 'Calculus PDF (57MB)',
  },
  { file: `${BOOKS}/طرح کلی اندیشه اسلامی در قرآن.pdf`, label: 'Persian PDF (16MB)' },
  {
    file: `${BOOKS}/[Adaptive Computation and Machine Learning series] Richard S. Sutton & Andrew G. Barto - Reinforcement Learning, second edition (2018, MIT Press) - libgen.li.epub`,
    label: 'RL Book EPUB (5.5MB)',
  },
];

mkdirSync('e2e/artifacts', { recursive: true });
const browser = await chromium.launch();

for (const target of TARGETS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 200)}`);
  });

  console.log(`\n=== ${target.label}`);
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('input[type="file"]').setInputFiles(target.file);
  try {
    await page.waitForFunction(
      () => document.querySelector('.library')?.getAttribute('aria-busy') === 'false',
      null,
      { timeout: 60_000 },
    );
    console.log(`import: ${Date.now() - t0}ms`);
  } catch {
    console.log(`import: FAILED after ${Date.now() - t0}ms`);
  }

  const heading = await page
    .locator('.book-grid h1, .book-grid h2, .book-card')
    .first()
    .textContent({ timeout: 10_000 })
    .catch(() => null);
  console.log('card:', heading?.slice(0, 80));

  const t1 = Date.now();
  await page.getByRole('button', { name: 'Read' }).click();
  try {
    await page.waitForFunction(
      () => document.querySelector('.reader-shell')?.getAttribute('data-ready') === 'true',
      null,
      { timeout: 90_000 },
    );
    console.log(`reader ready: ${Date.now() - t1}ms`);
    const isPdf = await page.locator('.reader-shell').getAttribute('data-format');
    const t2 = Date.now();
    if (isPdf === 'pdf') {
      await page.getByRole('button', { name: 'Next' }).click();
      await page
        .locator('.reader-progress')
        .filter({ hasText: 'Page 2' })
        .waitFor({ timeout: 30_000 });
      console.log(`first page turn: ${Date.now() - t2}ms`);
      const progress = await page.locator('.reader-progress').textContent();
      console.log('progress:', progress);
    } else {
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForTimeout(1500);
      console.log(`first page turn: ${Date.now() - t2}ms`);
    }
    await page.screenshot({
      path: `e2e/artifacts/stress-${target.label.split(' ')[0].toLowerCase()}.png`,
    });
  } catch (error) {
    console.log(`reader: FAILED (${error.message.slice(0, 120)})`);
  }
  console.log(`errors (${errors.length}):`);
  for (const item of errors.slice(0, 8)) console.log('  -', item);
  await page.close();
}

await browser.close();
console.log('\nDONE');
