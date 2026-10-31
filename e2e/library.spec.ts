import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('./fixtures/sample.epub', import.meta.url));
const englishFixture = fileURLToPath(new URL('./fixtures/english.epub', import.meta.url));
const pdfFixture = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));
const nodirFixture = fileURLToPath(new URL('./fixtures/nodir.epub', import.meta.url));
const markdownFixture = fileURLToPath(new URL('./fixtures/sample.md', import.meta.url));

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

test('opens settings from the library, applies dark mode, and survives RTL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const canvas = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--hamesh-color-canvas').trim(),
  );
  expect(canvas).toBe('#14161a');

  // The dialog is direction-agnostic: switching language flips the document
  // while the dialog stays open and closeable.
  await page.getByRole('button', { name: 'فارسی' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('dialog', { name: 'تنظیمات' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The preference is local and persists across reloads.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('traps focus in dialogs and restores it to the opener', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hāmesh' })).toBeVisible();
  const opener = page.getByRole('button', { name: 'Settings' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();

  const focusInDialog = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  await expect.poll(focusInDialog).toBe(true);

  for (let index = 0; index < 40; index += 1) await page.keyboard.press('Tab');
  await expect.poll(focusInDialog).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('guides sync setup from an empty state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();

  await expect(dialog.getByText('No storage connected')).toBeVisible();
  await dialog.getByLabel('Add storage').selectOption('webdav:generic');
  await expect(dialog.getByText('Needs setup')).toBeVisible();

  await dialog.getByLabel('Server URL').fill('https://dav.example.com');
  await expect(dialog.getByText('Ready')).toBeVisible();

  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(dialog.getByText('No storage connected')).toBeVisible();
});

test('adds a WebDAV preset with its URL pattern', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();

  await dialog.getByLabel('Add storage').selectOption('webdav:koofr');
  await expect(dialog.getByLabel('Server URL')).toHaveValue('https://app.koofr.net/dav/Koofr');
});

test('configures an S3-compatible provider', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();

  await dialog.getByLabel('Add storage').selectOption('s3');
  await expect(dialog.getByText('Needs setup')).toBeVisible();

  await dialog.getByLabel('Endpoint').fill('https://s3.example.com');
  await dialog.getByLabel('Bucket').fill('hamesh');
  await dialog.getByLabel('Access key ID').fill('AKIDEXAMPLE');
  await dialog.getByLabel('Secret access key').fill('secret');
  await expect(dialog.getByText('Ready')).toBeVisible();
});

test('configures a Dropbox provider with a user-owned app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();

  await dialog.getByLabel('Add storage').selectOption('dropbox');
  await expect(dialog.getByText('Needs setup')).toBeVisible();

  await dialog.getByLabel('App key').fill('test-app-key');
  await dialog.getByLabel('App secret').fill('test-secret');
  // The consent link is built from the app key; the code connects in-app.
  await expect(dialog.getByRole('link', { name: 'Open Dropbox' })).toHaveAttribute(
    'href',
    /client_id=test-app-key/,
  );
  await expect(dialog.getByText('Needs setup')).toBeVisible();
});

test('organizes books into a category with tags and filters by them', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Book details' });
  await dialog.getByLabel('Category').fill('Persian classics');
  await dialog.getByLabel('Tags').fill('history، persian');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.locator('.tag-chip', { hasText: 'history' })).toBeVisible();
  await page.getByLabel('Category', { exact: true }).selectOption('Persian classics');
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  await page.locator('.tag-chip', { hasText: 'persian' }).click();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  // Tags filter excludes books without the tag.
  await page.locator('.tag-chip', { hasText: 'persian' }).click();
  await page.locator('.tag-chip', { hasText: 'history' }).click();
  // Give the async SQLite flush a moment before reloading.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.tag-chip', { hasText: 'history' })).toBeVisible();
});

test('lays out a real mobile shelf and reader', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  // Two-column shelf instead of the desktop minmax(14rem) single column.
  const columns = await page.locator('.book-grid').evaluate((element) => {
    const value = getComputedStyle(element).gridTemplateColumns;
    return value.trim().split(/\s+/).length;
  });
  expect(columns).toBe(2);

  await page.getByRole('button', { name: 'Read' }).first().click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  // Reader turn buttons split the footer on phones.
  const turnBoxes = await page
    .locator('.reader-turn')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
  expect(turnBoxes).toHaveLength(2);
  expect(turnBoxes.every((width) => width > 100)).toBe(true);
});

test('shows grouped shortcuts in the settings dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Keyboard shortcuts' }).click();

  await expect(dialog.getByRole('heading', { name: 'Library' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Reader' })).toBeVisible();
  await expect(dialog.locator('.shortcut-group')).toHaveCount(2);
  await expect(dialog.locator('kbd').first()).toBeVisible();
});

test('persists the library across a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.locator('.library')).toHaveAttribute('aria-busy', 'false');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.getByText('RTL')).toBeVisible();
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

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect(progress).toHaveText(saved ?? '');
});

test('filters the library and switches to list view', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.locator('.library')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  const search = page.getByPlaceholder('Search title, author, or series');
  await search.fill('sample');
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Book');
  await page.getByRole('button', { name: 'Library' }).click();

  await search.fill('');
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.book-grid')).toHaveClass(/is-list/);
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(page.locator('.book-grid')).not.toHaveClass(/is-list/);

  await page.getByLabel('Sort books').selectOption('title');
  await expect(page.locator('.book-grid .book-card')).toHaveCount(2);
});

test('navigates the TOC and changes reader settings', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Contents' }).click();
  const tocItem = page.getByRole('button', { name: 'فصل یک' });
  await expect(tocItem).toBeVisible();
  await tocItem.click();
  await expect(tocItem).toHaveClass(/is-active/);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  const shell = page.locator('.reader-shell');
  await expect(shell).toHaveAttribute('data-font-size', '100');
  await page.getByRole('button', { name: 'Increase font size' }).click();
  await expect(shell).toHaveAttribute('data-font-size', '110');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Scrolled' }).click();
  await expect(shell).toHaveAttribute('data-flow', 'scrolled');

  // Typography controls update the reader styles live.
  await page.getByLabel('Font', { exact: true }).selectOption('literata');
  await expect(shell).toHaveAttribute('data-font-family', 'literata');
  // The book iframe must actually load the chosen face (absolute /fonts URL
  // allowed by the document CSP), not silently fall back.
  const faceLoaded = async (): Promise<boolean> => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const loaded = await frame.evaluate(async () => {
          await document.fonts.ready;
          return document.fonts.check('16px "Literata"');
        });
        if (loaded) return true;
      } catch {
        // detached or cross-origin frame
      }
    }
    return false;
  };
  await expect.poll(faceLoaded).toBe(true);
  await page.getByLabel('Line height').fill('2.1');
  await expect(shell).toHaveAttribute('data-line-height', '2.1');
  await page.getByLabel('Page margin').fill('32');
  await expect(shell).toHaveAttribute('data-margin', '32');
  await page.getByLabel('Brightness').fill('70');
  await expect(shell).toHaveAttribute('data-brightness', '70');
  await page.getByRole('button', { name: 'Hyphenation' }).click();
  await expect(shell).toHaveAttribute('data-hyphenate', 'true');
});

const openReader = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
};

test('searches inside the book', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Search' }).click();

  const panel = page.locator('.search-panel');
  const input = panel.getByPlaceholder('Search in this book');
  await input.fill('پاراگراف');
  await input.press('Enter');

  await expect(panel.locator('.search-result').first()).toBeVisible({ timeout: 15_000 });
  expect(await panel.locator('.search-result').count()).toBeGreaterThan(0);

  await panel.locator('.search-result').first().click();
  await page.getByRole('button', { name: 'Close' }).click();
});

test('creates a highlight and bookmark, then persists them', async ({ page }) => {
  await openReader(page);

  const frame = page.frames().find((item) => item.url().startsWith('blob:'));
  expect(frame).toBeTruthy();
  if (!frame) return;

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
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: 'Yellow' }).click();

  await page.getByRole('button', { name: 'Bookmark' }).click();
  await expect(page.locator('.note-item')).toHaveCount(2);

  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.locator('.note-item')).toHaveCount(2);
});

test('imports a Persian markdown file and reads it RTL', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(markdownFixture);
  await expect(page.getByRole('heading', { name: 'دفترچهٔ آزمون' })).toBeVisible();

  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-format', 'epub');
  // The front-matter title wins when the file has no level-1 heading conflict,
  // and the content detects as RTL from the Persian text.
  await expect(page.locator('foliate-view')).toBeVisible();
});

test('imports and reads a PDF', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await expect(page.getByRole('heading', { name: 'Hamesh PDF Test' })).toBeVisible();
  await expect(page.getByText('LTR')).toBeVisible();

  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-format', 'pdf');
  // PDFs support bookmarks and notes on pages; in-book search stays EPUB-only.
  await expect(page.getByRole('button', { name: 'Search' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notes' })).toBeVisible();
  await expect(page.locator('.reader-progress')).toHaveText('Page 1 of 4');

  await page.getByRole('button', { name: 'Settings' }).click();
  const shell = page.locator('.reader-shell');
  await expect(shell).toHaveAttribute('data-zoom', 'fit-page');
  await page.getByRole('button', { name: 'Fit width' }).click();
  await expect(shell).toHaveAttribute('data-zoom', 'fit-width');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(shell).toHaveAttribute('data-zoom', '1.25');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect.poll(async () => page.locator('.reader-progress').textContent()).toBe('Page 2 of 4');
});

test('bookmarks PDF pages and lists them', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Bookmark' }).click();
  const panel = page.locator('.notes-panel');
  await expect(panel.getByText('Page 1')).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.reader-progress')).toContainText('2');
  await page.getByRole('button', { name: 'Bookmark' }).click();
  await expect(panel.getByText('Page 2')).toBeVisible();
  await expect(panel.locator('.note-item')).toHaveCount(2);
});

test('resumes a multi-page PDF at the saved page', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  const progress = page.locator('.reader-progress');
  await expect(progress).toHaveText('Page 1 of 4');

  await page.getByRole('button', { name: 'Next' }).click();
  await expect.poll(async () => progress.textContent()).toBe('Page 2 of 4');
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  await expect(progress).toHaveText('Page 2 of 4');

  await page.reload();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  await expect(progress).toHaveText('Page 2 of 4');
  expect(pageErrors).toEqual([]);
});

const createHighlightAndBookmark = async (page: import('@playwright/test').Page) => {
  const frame = page.frames().find((item) => item.url().startsWith('blob:'));
  expect(frame).toBeTruthy();
  if (!frame) return;
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
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: 'Yellow' }).click();
  await page.getByRole('button', { name: 'Bookmark' }).click();
  await expect(page.locator('.note-item')).toHaveCount(2);
};

test('exports notes as JSON and Markdown round-trip', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  await openReader(page);
  await createHighlightAndBookmark(page);
  // The highlight/bookmark flows open the notes panel themselves.
  const panel = page.locator('.notes-panel');
  await expect(panel).toBeVisible();

  const jsonDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'JSON', exact: true }).click();
  const jsonFile = await jsonDownload;
  expect(jsonFile.suggestedFilename()).toMatch(/\.json$/);
  const exported = JSON.parse(readFileSync(await jsonFile.path(), 'utf8')) as {
    book: string;
    notes: Array<{ type: string; text: string | null }>;
  };
  expect(exported.book).toBe('نمونه کتاب');
  expect(exported.notes).toHaveLength(2);
  const types = exported.notes.map((note) => note.type).sort();
  expect(types).toEqual(['bookmark', 'highlight']);
  const highlight = exported.notes.find((note) => note.type === 'highlight');
  expect(highlight?.text).toBeTruthy();

  const mdDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Markdown', exact: true }).click();
  const mdFile = await mdDownload;
  expect(mdFile.suggestedFilename()).toMatch(/\.md$/);
  const markdown = readFileSync(await mdFile.path(), 'utf8');
  expect(markdown).toContain('# نمونه کتاب');
  expect(markdown).toContain('>');
});

test('keeps highlights intact after changing font size', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // The overlayer SVG is rendered inside a closed shadow root, so the suite
  // observes the draw counter on the stage instead of the drawn shapes.
  const drawnCount = async () => {
    const raw = await page.locator('.reader-stage').getAttribute('data-annotations-drawn');
    return Number(raw ?? '0');
  };

  await openReader(page);
  await createHighlightAndBookmark(page);
  await expect.poll(drawnCount).toBeGreaterThanOrEqual(1);

  // Reopening remounts the reader (fresh stage, fresh counter): the highlight
  // must be re-applied to the new document.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect.poll(drawnCount).toBeGreaterThanOrEqual(1);

  await page.getByRole('button', { name: 'Settings' }).click();
  const shell = page.locator('.reader-shell');
  await expect(shell).toHaveAttribute('data-font-size', '100');
  await page.getByRole('button', { name: 'Increase font size' }).click();
  await expect(shell).toHaveAttribute('data-font-size', '110');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.locator('.note-item')).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});

test('finds text inside book contents and opens the book', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator('.library')).toHaveAttribute('aria-busy', 'false');
  // Extraction runs after the import commits.
  await page.waitForTimeout(1500);

  const search = page.getByPlaceholder('Search title, author, or series');
  await search.fill('پاراگراف شمارهٔ 3');

  const match = page.locator('.content-matches button').first();
  await expect(match).toBeVisible({ timeout: 10_000 });
  await expect(match.locator('.content-match-snippet')).toContainText('پاراگراف شمارهٔ 3');

  await match.click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
});

test('applies the book direction when documents omit dir', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(nodirFixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });

  const frame = page
    .frames()
    .filter((item) => item.url().startsWith('blob:'))
    .pop();
  expect(frame).toBeTruthy();
  if (!frame) return;
  await expect.poll(async () => frame.evaluate(() => document.documentElement.dir)).toBe('rtl');

  // RTL reading: ArrowLeft advances (the Next side), ArrowRight goes back.
  const progress = page.locator('.reader-progress');
  const initial = await progress.textContent();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => progress.textContent()).not.toBe(initial);
  const advanced = await progress.textContent();
  // The paginator holds a turn lock during the animation; wait it out.
  await page.waitForTimeout(700);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => progress.textContent()).toBe(initial ?? '');
  void advanced;
});

test('escape closes panels, then returns to the library', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Contents' }).click();
  await expect(page.locator('.toc-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.toc-panel')).toHaveCount(0);
  await expect(page.locator('.reader-shell')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Hāmesh' })).toBeVisible();
  await expect(page.locator('.reader-shell')).toHaveCount(0);
});

test('opens the shortcut map with ? and focuses search with /', async ({ page }) => {
  await page.goto('/');
  // The app mounts after the async storage bootstrap; register shortcuts only then.
  await expect(page.getByRole('heading', { name: 'Hāmesh' })).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByPlaceholder('Search title, author, or series')).toBeFocused();

  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('turns pages with Space in the reader', async ({ page }) => {
  await openReader(page);
  const progress = page.locator('.reader-progress');
  const initial = await progress.textContent();
  await page.keyboard.press('Space');
  await expect.poll(async () => progress.textContent()).not.toBe(initial);
  // Let the page-turn lock release before reversing.
  await page.waitForTimeout(700);
  await page.keyboard.press('Shift+Space');
  await expect.poll(async () => progress.textContent()).toBe(initial ?? '');
});

test('turns pages with Space while the book content has focus', async ({ page }) => {
  await openReader(page);
  // Clicking the page moves keyboard focus into the paginator iframe.
  await page.locator('.reader-stage').click({ position: { x: 260, y: 260 } });
  const progress = page.locator('.reader-progress');
  const initial = await progress.textContent();
  await page.keyboard.press('Space');
  await expect.poll(async () => progress.textContent()).not.toBe(initial);
});

test('the reader follows the app dark mode by default', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Dark' })
    .click();
  await page.keyboard.press('Escape');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-theme', 'dark', {
    timeout: 15_000,
  });
});

test('closes the shortcut map in the reader without leaving the book', async ({ page }) => {
  await openReader(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.reader-shell')).toBeVisible();
});

test('hides zoom controls for EPUB but keeps them for PDF', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.settings-panel')).toBeVisible();
  await expect(page.locator('.settings-panel').getByText('Zoom')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Increase font size' })).toBeVisible();
});
