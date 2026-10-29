import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('./fixtures/sample.epub', import.meta.url));

test('imports a Persian EPUB and opens the reader', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hāmesh' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.getByText('RTL')).toBeVisible();

  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.getByRole('button', { name: 'Library' })).toBeVisible();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });

  const view = page.locator('foliate-view');
  await expect(view).toBeVisible();
  await expect
    .poll(async () => {
      const box = await view.boundingBox();
      return box ? box.width * box.height : 0;
    })
    .toBeGreaterThan(10_000);
  await page.waitForTimeout(300);

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/reader.png', fullPage: true });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('switches the interface to Persian RTL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to Persian' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('هامش');

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/library-rtl.png', fullPage: true });
});

test('resumes at the saved position', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });

  const progress = page.locator('.reader-progress');
  const initial = await progress.textContent();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect.poll(async () => progress.textContent()).not.toBe(initial);
  const afterFirst = await progress.textContent();

  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect.poll(async () => progress.textContent()).not.toBe(afterFirst);
  const saved = await progress.textContent();

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect(progress).toHaveText(saved ?? '');
});
