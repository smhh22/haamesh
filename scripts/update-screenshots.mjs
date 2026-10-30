/**
 * Regenerate the README screenshots (.github/assets/*.png) against a running
 * dev server on :5173. Used by the release workflow so the screenshots track
 * the shipped UI; also runnable locally:
 *   pnpm dev & node scripts/update-screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE = process.env.SCREENSHOTS_BASE_URL ?? 'http://localhost:5173';
const OUT_DIR = fileURLToPath(new URL('../.github/assets/', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../e2e/fixtures/${name}`, import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});

await page.goto(BASE);

// Fill the library so the screenshot shows a real collection with covers.
for (const name of ['sample.epub', 'sample.md', 'sample.pdf']) {
  await page.locator('input[type="file"]').setInputFiles(fixture(name));
}
await page.waitForTimeout(500);

mkdirSync(OUT_DIR, { recursive: true });
await page.screenshot({ path: `${OUT_DIR}library.png` });

// Dark reading view of the EPUB.
const epubCard = page.locator('.book-card', { hasText: 'نمونه کتاب' });
await epubCard.getByRole('button', { name: 'Read' }).click();
await page.locator('.reader-shell').waitFor({ timeout: 15_000 });
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('button', { name: 'Dark' }).click();
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT_DIR}reader.png` });

await browser.close();
console.log('screenshots written to .github/assets/');
