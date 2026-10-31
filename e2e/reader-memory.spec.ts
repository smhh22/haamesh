import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const pdfFixture = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

// Opening a PDF starts a pdf.js worker; closing the reader must destroy the
// parsed book (which terminates it). Leaking one worker per open was the main
// cause of the app's memory growth across reading sessions.
test('releases the PDF worker when the reader closes', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const counts = { created: 0, terminated: 0 };
    (window as unknown as { __workerCounts: typeof counts }).__workerCounts = counts;
    // biome-ignore lint/complexity/useArrowFunction: the shim is constructed with `new`
    window.Worker = function (url: string | URL, options?: WorkerOptions) {
      const worker = new NativeWorker(url, options);
      counts.created += 1;
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        counts.terminated += 1;
        terminate();
      };
      return worker;
    } as typeof Worker;
  });

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  await page.getByRole('button', { name: 'Library' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const counts = (
          window as unknown as { __workerCounts: { created: number; terminated: number } }
        ).__workerCounts;
        return counts.created > 0 && counts.terminated >= counts.created;
      }),
    )
    .toBe(true);
});
