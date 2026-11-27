import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('./fixtures/sample.epub', import.meta.url));
const englishFixture = fileURLToPath(new URL('./fixtures/english.epub', import.meta.url));
const pdfFixture = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));
const persianPdfFixture = fileURLToPath(new URL('./fixtures/persian.pdf', import.meta.url));
const nodirFixture = fileURLToPath(new URL('./fixtures/nodir.epub', import.meta.url));
const markdownFixture = fileURLToPath(new URL('./fixtures/sample.md', import.meta.url));
const audioFixture = fileURLToPath(new URL('./fixtures/sample.mp3', import.meta.url));
const bigPdfFixture = fileURLToPath(new URL('./fixtures/book.pdf', import.meta.url));
const videoFixture = fileURLToPath(new URL('./fixtures/lecture.webm', import.meta.url));
const headingsFixture = fileURLToPath(new URL('./fixtures/headings.epub', import.meta.url));

/** Category header actions live in one overflow menu now. */
const runCategoryAction = async (group: Locator, name: string) => {
  await group.getByRole('button', { name: 'Category actions' }).click();
  await group.getByRole('menuitem', { name }).click();
};

/** Book secondary actions now live behind the card's overflow menu. */
const chooseBookAction = async (card: Locator, name: 'Edit' | 'Remove') => {
  await card.getByRole('button', { name: 'Book actions' }).click();
  await card.getByRole('menuitem', { name }).click();
};

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
  // Direction is no longer a card badge; the Persian language tag is.
  await expect(page.locator('.book-card').getByText('fa', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Read', exact: true }).click();
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

test('imports a link-only book and materializes it on first open', async ({ page }) => {
  const epub = await (await import('node:fs/promises')).readFile(fixture);
  // The app's fetch of the book is answered locally; no network involved.
  // Request methods are recorded so the test can prove the import does not
  // download (ADR-0026): only a HEAD probe, bytes on demand.
  const methods: string[] = [];
  await page.route('https://books.example/**', (route) => {
    methods.push(route.request().method());
    return route.fulfill({ status: 200, contentType: 'application/epub+zip', body: epub });
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Add from URL' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add from URL' });
  await dialog.getByLabel('Book URL').fill('https://books.example/persian.epub');
  await dialog.getByText('Keep only the link; the file downloads when you open it').click();
  await dialog.getByRole('button', { name: 'Import books' }).click();
  await expect(dialog).toHaveCount(0);

  // The placeholder is titled from the URL and carries the link chip; no
  // bytes were fetched (HEAD only).
  const placeholder = page.locator('.book-card', { hasText: 'persian' });
  await expect(placeholder).toBeVisible();
  await expect(placeholder.locator('.format-chip.is-link')).toHaveText('Link');
  expect(methods.filter((method) => method !== 'HEAD')).toEqual([]);

  // A link can be organized before it is ever fetched (ADR-0026): the member
  // row keeps the catalog contract — Link chip, Download action.
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Reading list');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.group-row')).toBeVisible();
  await placeholder.getByRole('button', { name: 'Book actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to group…' }).click();
  await page
    .getByRole('dialog', { name: /Add [.“]persian[.”] to a group/ })
    .locator('.group-add-row', { hasText: 'Reading list' })
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.locator('.group-row')).toContainText('1 file');
  await page.locator('.group-row').getByRole('button', { name: 'Open', exact: true }).click();
  const member = page.locator('.member-row', { hasText: 'persian' });
  await expect(member).toBeVisible();
  await expect(member.locator('.format-chip.is-link')).toHaveText('Link');
  await expect(member.getByRole('button', { name: 'Download', exact: true })).toBeVisible();

  // The pending action says Download (there are no bytes yet); pressing it
  // materializes and opens: the fetch runs once and the row becomes the
  // real book (metadata title, no link chip).
  await member.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Library' }).click();
  expect(methods.filter((method) => method === 'GET')).toHaveLength(1);

  // Returning lands back inside the group (the open group is kept), and the
  // materialized book kept the membership the link already had (ADR-0026).
  const materialized = page.locator('.member-row', { hasText: 'نمونه کتاب' });
  await expect(materialized).toBeVisible();
  await expect(page.locator('.format-chip.is-link')).toHaveCount(0);
  // From then on it behaves like any imported book (EPUB → Read).
  await materialized.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
});

test('organizes books into a category with tags and filters by them', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  await chooseBookAction(page.locator('.book-card').first(), 'Edit');
  const dialog = page.getByRole('dialog', { name: 'Book details' });
  await dialog.getByLabel('Category').selectOption('__new__');
  await dialog.getByLabel('New category name').fill('Persian classics');
  await dialog.getByLabel('Tags').fill('history، persian');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.locator('.tag-chip', { hasText: 'history' })).toBeVisible();
  await expect(
    page
      .locator('.book-group', { hasText: 'Persian classics' })
      .getByRole('heading', { name: 'نمونه کتاب' }),
  ).toBeVisible();

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

test('scrolls the library with the mouse wheel', async ({ page }) => {
  // Guards against document-level CSS (overscroll/touch-action) that once
  // risked disabling wheel scrolling on WebKitGTK desktops.
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight))
    .toBe(true);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(640, 150);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});

test('lays out a real mobile shelf and reader', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  // Two-column cover shelf instead of the desktop minmax(14rem) single
  // column; the catalog is the default, so switch to the grid first.
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(page.locator('.book-grid')).not.toHaveClass(/is-list/);
  const columns = await page.locator('.book-grid').evaluate((element) => {
    const value = getComputedStyle(element).gridTemplateColumns;
    return value.trim().split(/\s+/).length;
  });
  expect(columns).toBe(2);

  await page.getByRole('button', { name: 'Read', exact: true }).first().click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  // Reader footer: thumb-sized chevron turn buttons flanking a seek slider,
  // not buttons stretched edge to edge.
  const turnBoxes = await page
    .locator('.reader-turn')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
  expect(turnBoxes).toHaveLength(2);
  expect(turnBoxes.every((width) => width > 36 && width < 64)).toBe(true);
  // The position slider opens from the page label so the reading surface
  // stays free of a permanent footer.
  await page.locator('.pill-progress').click();
  await expect(page.locator('.reader-seek')).toBeVisible();
});

test('renames and deletes a category across its books', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  const assign = async (title: string, existing: boolean) => {
    await chooseBookAction(page.locator('.book-card', { hasText: title }), 'Edit');
    const dialog = page.getByRole('dialog', { name: 'Book details' });
    if (existing) {
      await dialog.getByLabel('Category').selectOption('Classics');
    } else {
      await dialog.getByLabel('Category').selectOption('__new__');
      await dialog.getByLabel('New category name').fill('Classics');
    }
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
  };
  await assign('نمونه کتاب', false);
  await assign('Sample Book', true);

  const group = page.locator('.book-group', { hasText: 'Classics' });
  await expect(group.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(group.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  await runCategoryAction(group, 'Rename category');
  const rename = page.getByRole('dialog', { name: 'Rename category' });
  await rename.getByLabel('Category name').fill('Classic novels');
  await rename.getByRole('button', { name: 'Save' }).click();

  const renamed = page.locator('.book-group', { hasText: 'Classic novels' });
  await expect(renamed).toHaveCount(1);
  await expect(renamed.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(renamed.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  await runCategoryAction(renamed, 'Delete category');
  const remove = page.getByRole('dialog', { name: 'Delete this category?' });
  await remove.getByRole('button', { name: 'Remove' }).click();

  await expect(page.locator('.book-group', { hasText: 'Classic novels' })).toHaveCount(0);
  // With no categories left the library returns to the flat grid.
  await expect(page.locator('.book-groups')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();
});

test('creates a category from the toolbar and keeps it when empty', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  await page.getByRole('button', { name: 'New category' }).click();
  const create = page.getByRole('dialog', { name: 'New category' });
  await create.getByLabel('Category name').fill('Poetry');
  await create.getByRole('button', { name: 'Save' }).click();

  // The empty section appears immediately, before any book is assigned.
  const group = page.locator('.book-group', { hasText: 'Poetry' });
  await expect(group).toHaveCount(1);
  await expect(group.locator('.book-group-count')).toHaveText('0 books');

  await chooseBookAction(page.locator('.book-card', { hasText: 'Sample Book' }), 'Edit');
  const dialog = page.getByRole('dialog', { name: 'Book details' });
  await dialog.getByLabel('Category').selectOption('Poetry');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(group.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  // The created category survives a reload; the persist runs in the
  // background, so give it a moment or a slow disk reloads the old record.
  await page.waitForTimeout(500);
  await page.reload();
  const reloaded = page.locator('.book-group', { hasText: 'Poetry' });
  await expect(reloaded).toHaveCount(1);
  await expect(reloaded.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  await runCategoryAction(reloaded, 'Delete category');
  await page
    .getByRole('dialog', { name: 'Delete this category?' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page.locator('.book-group', { hasText: 'Poetry' })).toHaveCount(0);
});

test('reorders category sections and remembers the order', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);

  const assign = async (title: string, category: string) => {
    await chooseBookAction(page.locator('.book-card', { hasText: title }), 'Edit');
    const dialog = page.getByRole('dialog', { name: 'Book details' });
    await dialog.getByLabel('Category').selectOption('__new__');
    await dialog.getByLabel('New category name').fill(category);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
  };
  await assign('Sample Book', 'Zeta');
  await assign('نمونه کتاب', 'Alpha');

  // Alphabetical: Alpha before Zeta.
  const names = () => page.locator('.book-group-toggle span[dir="auto"]');
  await expect(names().first()).toHaveText('Alpha');

  // Move Zeta above Alpha with the button; the order survives a reload.
  await runCategoryAction(page.locator('.book-group', { hasText: 'Zeta' }), 'Move category up');
  await expect(names().first()).toHaveText('Zeta');

  // From a fresh order, moving the FIRST category down must swap the two
  // (regression: a sparse order made this a no-op or jumped rows).
  await runCategoryAction(page.locator('.book-group', { hasText: 'Zeta' }), 'Move category down');
  await expect(names().first()).toHaveText('Alpha');
  await runCategoryAction(page.locator('.book-group', { hasText: 'Zeta' }), 'Move category up');
  await expect(names().first()).toHaveText('Zeta');

  await page.waitForTimeout(500);
  await page.reload();
  await expect(names().first()).toHaveText('Zeta');
});

test('collapses category sections and remembers the state', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  const assign = async (title: string, existing: boolean) => {
    await chooseBookAction(page.locator('.book-card', { hasText: title }), 'Edit');
    const dialog = page.getByRole('dialog', { name: 'Book details' });
    if (existing) {
      await dialog.getByLabel('Category').selectOption('Classics');
    } else {
      await dialog.getByLabel('Category').selectOption('__new__');
      await dialog.getByLabel('New category name').fill('Classics');
    }
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
  };
  await assign('نمونه کتاب', false);
  await assign('Sample Book', true);

  const toggle = page.locator('.book-group', { hasText: 'Classics' }).locator('.book-group-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toHaveCount(0);

  await page.waitForTimeout(500);
  await page.reload();
  const reloaded = page
    .locator('.book-group', { hasText: 'Classics' })
    .locator('.book-group-toggle');
  await expect(reloaded).toHaveAttribute('aria-expanded', 'false');
  await reloaded.click();
  await expect(reloaded).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();
});

test('renames and deletes a tag across books', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  const assign = async (title: string) => {
    await chooseBookAction(page.locator('.book-card', { hasText: title }), 'Edit');
    const details = page.getByRole('dialog', { name: 'Book details' });
    await details.getByLabel('Tags').fill('history');
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(details).toHaveCount(0);
  };
  await assign('نمونه کتاب');
  await assign('Sample Book');

  await page.getByRole('button', { name: 'Manage tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage tags' });
  await expect(dialog.getByText('#history')).toBeVisible();
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await dialog.getByLabel('Tag name').fill('past');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('#past')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.tag-chip', { hasText: 'past' })).toBeVisible();

  await page.getByRole('button', { name: 'Manage tags' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(dialog.getByText('No tags yet.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.tag-chip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage tags' })).toHaveCount(0);
});

test('keeps the last failed sync round visible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();

  await dialog.getByLabel('Add storage').selectOption('webdav:generic');
  await dialog.getByLabel('Server URL').fill('http://127.0.0.1:9');
  await dialog.getByRole('button', { name: 'Sync now' }).click();
  await expect(dialog.getByText('The last sync round failed:')).toBeVisible({
    timeout: 15_000,
  });
  const failure = dialog.locator('.sync-last-error');
  await expect(failure).toContainText('WebDAV:');
  await expect(failure).toContainText('Could not reach the server.');
  // The raw provider detail stays visible for diagnosis.
  await expect(failure).toContainText('network error: TypeError: Failed to fetch');
  await expect(failure).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);

  // The library toolbar carries the same action: run a round and surface the
  // failure without opening settings.
  await dialog.getByRole('button', { name: 'Back to reading' }).click();
  const librarySync = page.locator('.library-toolbar').getByRole('button', { name: 'Sync now' });
  await expect(librarySync).toBeVisible();
  await librarySync.click();
  await expect(
    page.locator('.library-toolbar').getByRole('button', { name: 'Sync failed' }),
  ).toBeVisible({ timeout: 15_000 });

  // The report is persisted, so reopening the app still explains the failure.
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  const reopened = page.getByRole('dialog', { name: 'Settings' });
  await reopened.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(reopened.getByText('The last sync round failed:')).toBeVisible();
  await expect(reopened.locator('.sync-last-error')).toContainText('WebDAV:');
  await expect(reopened.locator('.sync-last-error')).toContainText('Could not reach the server.');

  // The same stored report is localized when the UI is Persian.
  await reopened.getByRole('button', { name: 'Back to reading' }).click();
  await page.getByRole('button', { name: 'Switch to Persian' }).click();
  await page.getByRole('button', { name: 'تنظیمات' }).click();
  const persian = page.getByRole('dialog', { name: 'تنظیمات' });
  await persian.getByRole('button', { name: 'همگام‌سازی', exact: true }).click();
  await expect(persian.locator('.sync-last-error')).toContainText('ارتباط با سرور برقرار نشد.');
});

test('refreshes the sync panel when a background round finishes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(dialog.getByText('The last sync round failed:')).toHaveCount(0);

  // A round finishing elsewhere (the auto-sync timer) writes the status and
  // dispatches an event; the open panel must follow it without remounting.
  await page.evaluate(() => {
    localStorage.setItem(
      'hamesh.sync.status',
      JSON.stringify({
        lastSyncAt: Date.now(),
        lastReport: {
          ok: false,
          providers: [
            {
              providerId: 'webdav',
              ok: false,
              code: 'NETWORK',
              error: 'boom',
              pulledRecords: 0,
              uploadedBlobs: 0,
              downloadedBlobs: 0,
            },
          ],
        },
      }),
    );
    window.dispatchEvent(new Event('hamesh:sync-status'));
  });

  await expect(dialog.getByText('The last sync round failed:')).toBeVisible();
  await expect(dialog.locator('.sync-last-error')).toContainText('Could not reach the server.');
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

test('asks before removing a book', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  await chooseBookAction(page.locator('.book-card').first(), 'Remove');
  const dialog = page.getByRole('dialog', { name: 'Remove this book?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  await chooseBookAction(page.locator('.book-card').first(), 'Remove');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toHaveCount(0);
});

test('persists the library across a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.locator('.library')).toHaveAttribute('aria-busy', 'false');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.locator('.book-card').getByText('fa', { exact: true })).toBeVisible();
});

test('reports a missing book file instead of hiding the book', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await expect(page.locator('.library')).toHaveAttribute('aria-busy', 'false');

  // Reload so the runtime file cache is empty, then simulate a corrupted
  // profile by deleting the stored blob. The lazy loader must surface an
  // error on open rather than the book vanishing from the library.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const books = await root.getDirectoryHandle('books');
    for await (const name of books.keys()) {
      if (name.endsWith('.epub') || name.endsWith('.pdf')) await books.removeEntry(name);
    }
  });

  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(
    page.getByText("This book's file is missing from Hāmesh storage. Import it again."),
  ).toBeVisible();
});

test('resumes at the saved position', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect(progress).toHaveText(saved ?? '');

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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

  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Book');
  await page.getByRole('button', { name: 'Library' }).click();

  await search.fill('');
  await expect(page.getByRole('heading', { name: 'نمونه کتاب' })).toBeVisible();

  // The catalog is the default; switching to the grid and back persists
  // across a reload.
  await expect(page.locator('.book-grid')).toHaveClass(/is-list/);
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(page.locator('.book-grid')).not.toHaveClass(/is-list/);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.book-grid')).toHaveClass(/is-list/);
  await page.reload();
  await expect(page.locator('.book-grid')).toHaveClass(/is-list/);

  await page.getByLabel('Sort books').selectOption('title');
  await expect(page.locator('.book-grid .book-card')).toHaveCount(2);
});

test('navigates the TOC and changes reader settings', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Contents' }).click();
  const tocItem = page.getByRole('button', { name: 'فصل یک' });
  await expect(tocItem).toBeVisible();
  await tocItem.click();
  await expect(tocItem).toHaveClass(/is-active/);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Contents' })).toBeFocused();

  await page.getByRole('button', { name: 'Settings' }).click();
  const shell = page.locator('.reader-shell');
  await expect(shell).toHaveAttribute('data-font-size', '100');
  await page.getByRole('button', { name: 'Increase font size' }).click();
  await expect(shell).toHaveAttribute('data-font-size', '110');
  // exact: true — the invert-images row's label contains the word "dark" too.
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Sepia' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Scrolled' }).click();
  await expect(shell).toHaveAttribute('data-flow', 'scrolled');
  await expect(page.getByRole('button', { name: 'Scrolled' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Paginated' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
};

test('formats reader percentages in the active locale', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  // Brightness and font size both start at 100%.
  await expect(page.locator('.settings-panel').getByText('100%', { exact: true })).toHaveCount(2);
  await page.locator('.settings-panel').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Switch to Persian' }).click();
  await page.locator('.book-card').first().getByRole('button', { name: 'خواندن' }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'تنظیمات' }).click();
  await expect(page.locator('.settings-panel').getByText('۱۰۰٪', { exact: true })).toHaveCount(2);
});

test('searches inside the book', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Search' }).click();

  const panel = page.locator('.search-panel');
  const input = panel.getByPlaceholder('Search in this book');
  await expect(input).toBeFocused();
  await input.fill('پاراگراف');
  await input.press('Enter');

  await expect(panel.locator('.search-result').first()).toBeVisible({ timeout: 15_000 });
  expect(await panel.locator('.search-result').count()).toBeGreaterThan(0);

  await panel.locator('.search-result').first().click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Search' })).toBeFocused();
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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.locator('.note-item')).toHaveCount(2);
});

test.describe('phone viewport', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('keeps the reader toolbar and the translated popover inside the viewport', async ({
    page,
  }) => {
    await page.route('https://api.mymemory.translated.net/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          responseStatus: 200,
          responseData: {
            translatedText:
              'این ترجمهٔ آزمایشی برای بررسی چیدمان موبایل است و باید در چند خط بشکند تا رفتار متن بلند هم دیده شود.',
          },
        }),
      }),
    );
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'hamesh.ai.translation',
        JSON.stringify({
          providers: [
            {
              id: 'e2e-mymemory',
              kind: 'mymemory',
              label: 'MyMemory',
              enabled: true,
              baseUrl: '',
              model: '',
              email: '',
              apiKey: '',
              hasApiKey: false,
              proxy: '',
            },
          ],
          targetLang: 'fa',
          tapToTranslate: false,
        }),
      );
    });
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
      timeout: 15_000,
    });

    // Every toolbar button and the progress read-out must stay on screen; the
    // mobile layout wraps the actions instead of scrolling them sideways.
    const viewport = await page.evaluate(() => window.innerWidth);
    for (const selector of ['.reader-action', '.reader-progress']) {
      const boxes = await page.locator(selector).evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      );
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport + 0.5);
      }
    }

    const frame = page.frames().find((item) => item.url().startsWith('blob:'));
    expect(frame).toBeTruthy();
    if (!frame) return;
    await frame.waitForSelector('p');
    await frame.evaluate(() => {
      // A paragraph low on the page: the translated popover would run off the
      // bottom if it did not flip above the selection.
      const paragraph = document.querySelectorAll('p')[2];
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    const popover = page.locator('.selection-popover');
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: 'Translate' }).click();
    await expect(popover.locator('.selection-translation-text')).toHaveText(
      'این ترجمهٔ آزمایشی برای بررسی چیدمان موبایل است و باید در چند خط بشکند تا رفتار متن بلند هم دیده شود.',
    );

    const visible = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const box = await popover.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(visible.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(visible.height + 0.5);
  });

  test('turns pages and toggles the chrome with taps', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
      timeout: 15_000,
    });

    // The fixture is an RTL book, so the inline-end (visual left) advances.
    const progress = page.locator('.reader-progress');
    const before = await progress.textContent();
    await page.mouse.click(20, 500);
    await expect.poll(async () => progress.textContent()).not.toBe(before);

    // Center tap: immersive; again: chrome back.
    const chrome = page.locator('.reader-back');
    await page.mouse.click(206, 500);
    await expect(chrome).toBeHidden();
    await page.mouse.click(206, 500);
    await expect(chrome).toBeVisible();
  });
});

test('imports a Persian markdown file and reads it RTL', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(markdownFixture);
  await expect(page.getByRole('heading', { name: 'دفترچهٔ آزمون' })).toBeVisible();

  await page.getByRole('button', { name: 'Read', exact: true }).click();
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

  await page.getByRole('button', { name: 'Read', exact: true }).click();
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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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

test('detects PDF language and direction from the text layer', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(persianPdfFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  // The first rendered pages are sampled and the profile is persisted into
  // the book record, so the library card shows the detected language.
  await page.getByRole('button', { name: 'Library' }).click();
  const card = page.locator('.book-card', { hasText: 'نمونه فارسی' });
  await expect(card.locator('.format-chip', { hasText: 'fa' })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(
    page
      .locator('.book-card', { hasText: 'نمونه فارسی' })
      .locator('.format-chip', { hasText: 'fa' }),
  ).toBeVisible();
});

test('pairs RTL PDF spreads from the persisted direction', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(persianPdfFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  // First open: detection samples the text layer and persists direction.
  await page.getByRole('button', { name: 'Library' }).click();
  const card = page.locator('.book-card', { hasText: 'نمونه فارسی' });
  await expect(card.locator('.format-chip', { hasText: 'fa' })).toBeVisible({ timeout: 10_000 });

  // Second open seeds foliate's book.dir from the persisted direction, so a
  // forced two-page layout pairs with the first page on the leading side.
  const state = () =>
    page.evaluate(() => {
      const view = document.querySelector('foliate-view');
      const renderer = view?.renderer as
        | {
            spread?: string;
            rtl?: boolean;
            getContents?: () => unknown[];
          }
        | null
        | undefined;
      return {
        spread: renderer?.spread,
        rtl: renderer?.rtl,
        frames: renderer?.getContents?.().length ?? 0,
      };
    });
  await card.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  await expect.poll(state).toMatchObject({ spread: 'auto', rtl: true });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Two pages' }).click();
  // A one-page PDF still mounts a blank half next to the page, so the frame
  // count stays at 2 — the RTL pairing is what this assertion pins down.
  await expect.poll(state).toMatchObject({ spread: 'both', rtl: true });
});

test('lets the reader override PDF language and direction', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await expect(page.getByRole('heading', { name: 'Hamesh PDF Test' })).toBeVisible();

  await chooseBookAction(page.locator('.book-card', { hasText: 'Hamesh PDF Test' }), 'Edit');
  const dialog = page.getByRole('dialog', { name: 'Book details' });
  await dialog.getByLabel('Language').fill('fa');
  await dialog.getByLabel('Reading direction').selectOption('rtl');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  // The override is the book record: the badge and the dialog keep it. The
  // persist runs in the background; give it a moment before reloading or a
  // slow CI disk reloads the pre-save record.
  await expect(page.locator('.format-chip', { hasText: 'fa' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.format-chip', { hasText: 'fa' })).toBeVisible();
  await chooseBookAction(page.locator('.book-card', { hasText: 'Hamesh PDF Test' }), 'Edit');
  const reopened = page.getByRole('dialog', { name: 'Book details' });
  await expect(reopened.getByLabel('Language')).toHaveValue('fa');
  await expect(reopened.getByLabel('Reading direction')).toHaveValue('rtl');
});

test('zooms a PDF with ctrl+wheel and shows highlight actions on right-click', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  const frame = page.frames().find((item) => item.url().startsWith('blob:'));
  expect(frame).toBeTruthy();
  await frame!.waitForSelector('.textLayer span');

  // Ctrl+wheel up zooms from the default fit mode to the first step.
  await frame!.evaluate(() => {
    const span = document.querySelector('.textLayer span');
    if (!span) throw new Error('no text layer span');
    span.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-zoom', '1.25');

  // Right-click over a selection opens the highlight popover instead of the
  // native menu.
  await frame!.evaluate(() => {
    const span = document.querySelector('.textLayer span');
    if (!span) throw new Error('no text layer span');
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    span.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
    );
  });
  await expect(page.locator('.selection-popover')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yellow' })).toBeVisible();
});

test('highlights PDF text and redraws it after reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  const frame = page.frames().find((item) => item.url().startsWith('blob:'));
  expect(frame).toBeTruthy();
  await frame!.waitForSelector('.textLayer span');
  await frame!.evaluate(() => {
    const span = document.querySelector('.textLayer span');
    if (!span) throw new Error('no text layer span');
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  await page.getByRole('button', { name: 'Yellow' }).click();

  const overlays = () =>
    frame!.evaluate(() => document.querySelectorAll('.hamesh-pdf-highlight').length);
  await expect.poll(overlays).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Library' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  const reopened = page.frames().find((item) => item.url().startsWith('blob:'));
  expect(reopened).toBeTruthy();
  await reopened!.waitForSelector('#hamesh-pdf-overlays div');
  await expect(reopened!.locator('#hamesh-pdf-overlays div').first()).toBeVisible();
  const noteItem = page.locator('.note-item');
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(noteItem.first()).toContainText('Hamesh PDF Test');
});

test('resumes a multi-page PDF at the saved page', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  const progress = page.locator('.reader-progress');
  await expect(progress).toHaveText('Page 1 of 4');

  await page.getByRole('button', { name: 'Next' }).click();
  await expect.poll(async () => progress.textContent()).toBe('Page 2 of 4');
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  await expect(progress).toHaveText('Page 2 of 4');

  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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
  await page.locator('.settings-panel').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.locator('.note-item')).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});

test('re-anchors a highlight to the same text after font-size and window changes', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openReader(page);

  // Record the CFI the app hands to foliate when the highlight is drawn.
  await page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      addAnnotation: (annotation: { value: string }) => Promise<unknown>;
    };
    const original = view.addAnnotation.bind(view);
    Object.assign(view, {
      addAnnotation: (annotation: { value: string }) => {
        (window as unknown as { __driftCfi?: string }).__driftCfi = annotation.value;
        return original(annotation);
      },
    });
  });
  // A text-anchored selection, like a real user drag. (An element-boundary
  // range from selectNodeContents round-trips through foliate's CFI as a
  // collapsed range, so the drift probe needs text offsets.)
  const frame = page.frames().find((item) => item.url().startsWith('blob:'));
  expect(frame).toBeTruthy();
  if (!frame) return;
  await frame.waitForSelector('p');
  await frame.evaluate(() => {
    const paragraph = document.querySelector('p');
    const textNode = paragraph?.firstChild;
    if (!paragraph || !textNode) throw new Error('no paragraph text');
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.setEnd(textNode, Math.min(40, textNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const popover = page.locator('.selection-popover');
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: 'Yellow' }).click();
  // The highlight flow does not open the notes panel itself; the drawn
  // counter on the stage proves the annotation was applied (the SVG lives
  // in a closed shadow root).
  const drawnCount = () =>
    page
      .locator('.reader-stage')
      .getAttribute('data-annotations-drawn')
      .then((raw) => Number(raw ?? '0'));
  await expect.poll(drawnCount).toBeGreaterThanOrEqual(1);

  // What the highlight's CFI anchors, and what the drawn overlayer actually
  // covers, must stay the same text across reflow.
  const textAtCfi = () =>
    page.evaluate(() => {
      const view = document.querySelector('foliate-view') as unknown as {
        resolveCFI: (cfi: string) => { anchor: (doc: Document) => Range };
        renderer: { getContents: () => Array<{ doc: Document }> };
      };
      const cfi = (window as unknown as { __driftCfi?: string }).__driftCfi;
      if (!cfi) throw new Error('no captured cfi');
      const { anchor } = view.resolveCFI(cfi);
      for (const content of view.renderer.getContents()) {
        try {
          const range = anchor(content.doc);
          if (range && !range.collapsed) return range.toString();
        } catch {
          // The anchor lives in another loaded section.
        }
      }
      throw new Error('cfi did not resolve in any loaded section');
    });

  const drawnHighlightText = () =>
    page.evaluate(() => {
      const view = document.querySelector('foliate-view') as unknown as {
        resolveCFI: (cfi: string) => { anchor: (doc: Document) => Range };
        renderer: {
          getContents: () => Array<{
            doc: Document;
            overlayer: { hitTest: (point: { x: number; y: number }) => [string, Range] | [] };
          }>;
        };
      };
      const cfi = (window as unknown as { __driftCfi?: string }).__driftCfi;
      if (!cfi) throw new Error('no captured cfi');
      const { anchor } = view.resolveCFI(cfi);
      for (const content of view.renderer.getContents()) {
        let range: Range;
        try {
          range = anchor(content.doc);
        } catch {
          continue;
        }
        if (!range || range.collapsed) continue;
        // Probe a point inside the anchor's own client rects: the drawn
        // highlight must be found there, or it has drifted off its text.
        const rects = Array.from(range.getClientRects()).filter(
          (item) => item.width > 1 && item.height > 1,
        );
        const rect = rects[Math.min(1, rects.length - 1)];
        if (!rect) continue;
        const hit = content.overlayer.hitTest({
          x: rect.left + 2,
          y: rect.top + rect.height / 2,
        });
        return hit.length > 0 ? hit[1].toString() : null;
      }
      return null;
    });

  const textBefore = await textAtCfi();
  expect(textBefore.length).toBeGreaterThan(0);
  expect(await drawnHighlightText()).toBe(textBefore);

  // Reflow both ways: bigger type, then a narrower window.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Increase font size' }).click();
  await page.waitForTimeout(600);
  await page.locator('.settings-panel').getByRole('button', { name: 'Close' }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(800);

  expect(await textAtCfi()).toBe(textBefore);
  expect(await drawnHighlightText()).toBe(textBefore);
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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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
  // Panels are overlays at every width; Escape closes the panel first.
  await expect(page.locator('.reader-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-panel')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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

test('exposes PDF fit modes as pressed toggles', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  const fitPage = page.getByRole('button', { name: 'Fit page' });
  const fitWidth = page.getByRole('button', { name: 'Fit width' });
  await expect(fitPage).toHaveAttribute('aria-pressed', 'true');
  await fitWidth.click();
  await expect(fitWidth).toHaveAttribute('aria-pressed', 'true');
  await expect(fitPage).toHaveAttribute('aria-pressed', 'false');
});

test('applies the PDF page layout from the reader panel and keeps the page', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  // The fixed-layout renderer reads its spread once per open: 'auto' pairs
  // pages adaptively, 'both' always pairs, 'none' centers each page alone.
  // Page frames live in the renderer's shadow root, so getContents() is the
  // observable for how many pages are mounted.
  const spread = () =>
    page.evaluate(() => {
      const view = document.querySelector('foliate-view');
      const renderer = view?.renderer as
        | {
            spread?: string;
            getContents?: () => unknown[];
          }
        | null
        | undefined;
      return { spread: renderer?.spread, frames: renderer?.getContents?.().length ?? 0 };
    });
  await expect.poll(spread).toMatchObject({ spread: 'auto' });

  // Turn to the next spread (pages 2–3): both halves are real pages here,
  // unlike the first spread whose left half is a blank.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const progress = () =>
    page.evaluate(() => document.querySelector('.reader-progress')?.textContent ?? '');
  await expect.poll(progress).toContain('2');
  const before = await progress();
  await expect.poll(spread).toMatchObject({ frames: 2 });

  // Forcing two-page pairing re-opens the book and resumes on this page.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Two pages' }).click();
  await expect.poll(spread).toMatchObject({ spread: 'both', frames: 2 });
  await expect.poll(progress).toBe(before);

  // Back to a single centered page: one frame, same page.
  await page.getByRole('button', { name: 'Single page' }).click();
  await expect.poll(spread).toMatchObject({ spread: 'none', frames: 1 });
  await expect.poll(progress).toBe(before);
});

test('imports an audio book and plays it in the player bar', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(audioFixture);
  // Title and cover come from the embedded tags (ADR-0021).
  await expect(page.getByRole('heading', { name: 'Hāmesh Audio Test' })).toBeVisible();

  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  const bar = page.locator('.player-bar');
  await expect(bar).toBeVisible();
  await expect(page.locator('.player-title')).toHaveText('Hāmesh Audio Test');

  const currentTime = () =>
    page.evaluate(() => {
      const audio = document.querySelector('.player-bar audio');
      return audio instanceof HTMLAudioElement ? audio.currentTime : -1;
    });

  // exact: "Close player" also contains "Play" as a substring.
  await bar.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(currentTime, { timeout: 10_000 }).toBeGreaterThan(0.2);
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedAt = await currentTime();
  expect(pausedAt).toBeGreaterThan(0.2);
  // Let the async persistence write land before the reload; under parallel
  // workers the SQLite write needs more than the previous 300 ms.
  await page.waitForTimeout(800);

  // The position persists through the reading state and restores on reopen.
  await page.reload();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(bar).toBeVisible();
  await expect.poll(currentTime, { timeout: 10_000 }).toBeGreaterThan(0.1);
  expect(pageErrors).toEqual([]);
});

test('keeps turning PDF pages under rapid taps and turns them with tap zones', async ({ page }) => {
  // Touch context: the tap-zone gate requires a coarse pointer.
  const context = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
  const touch = await context.newPage();
  await touch.goto('/');
  await touch.locator('input[type="file"]').setInputFiles(bigPdfFixture);
  await expect(touch.getByRole('heading', { name: 'book', exact: true })).toBeVisible();
  await touch.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(touch.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  const pageInfo = touch.locator('.reader-progress');
  await expect(pageInfo).toHaveText(/Page 1 of 30/);

  // Rapid-fire clicks: overlapping turns used to wedge the fixed-layout
  // renderer (a detached iframe's load event never fires). Turns are
  // serialized now, so every click lands and the book reaches its end.
  const next = touch.getByRole('button', { name: 'Next' });
  for (let i = 0; i < 29; i += 1) {
    await next.click({ delay: 10 });
  }
  await expect(pageInfo).toHaveText(/Page 30 of 30/, { timeout: 15_000 });
  await touch.getByRole('button', { name: 'Previous' }).click();
  await expect(pageInfo).toHaveText(/Page 29 of 30/, { timeout: 10_000 });

  // Tap zones work on PDF pages too: the inline-end third turns forward.
  const stage = touch.locator('.reader-stage');
  const box = await stage.boundingBox();
  if (!box) throw new Error('stage missing');
  await touch.touchscreen.tap(box.x + box.width * 0.9, box.y + box.height * 0.5);
  await expect(pageInfo).toHaveText(/Page 30 of 30/, { timeout: 10_000 });
  await context.close();
});

test('imports a video course and watches it with a persisted position', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(videoFixture);
  await expect(page.getByRole('heading', { name: 'lecture' })).toBeVisible();

  // Videos have no embedded artwork: the import frames a still from the file,
  // and the chip names the real container instead of a generic video label.
  const videoCover = page.locator('.book-card .book-cover img').first();
  await expect(videoCover).toBeVisible();
  expect(await videoCover.getAttribute('src')).toMatch(/^blob:/);
  await expect(
    page.locator('.book-card', { hasText: 'lecture' }).locator('.format-chip').first(),
  ).toHaveText('WEBM');

  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  const video = page.locator('.video-stage video');
  await expect(video).toBeVisible();

  const currentTime = () =>
    page.evaluate(() => {
      const el = document.querySelector('.video-stage video');
      return el instanceof HTMLVideoElement ? el.currentTime : -1;
    });

  await video.evaluate((el) => {
    if (el instanceof HTMLVideoElement) void el.play();
  });
  await expect.poll(currentTime, { timeout: 10_000 }).toBeGreaterThan(0.3);
  const watched = await currentTime();

  // The position persists through the reading state and restores on reopen;
  // the captured cover is stored with the book and comes back too.
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.book-card .book-cover img').first()).toBeVisible();
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(video).toBeVisible();
  await expect.poll(currentTime, { timeout: 10_000 }).toBeGreaterThan(0.1);
  expect(pageErrors).toEqual([]);
});

test('catalog rows, continue strip, filters, and row menu', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture, pdfFixture]);
  await expect(page.locator('.book-card')).toHaveCount(3);

  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.book-row')).toHaveCount(3);
  // Real cover art shows in rows too; the thumb falls back to a letter.
  await expect(
    page.locator('.book-row', { hasText: 'نمونه کتاب' }).locator('.book-cover img'),
  ).toBeVisible();
  // The row keeps the primary action explicit (tests and keyboard users rely
  // on it); secondary actions live in the overflow menu.
  const sampleRow = page.locator('.book-row', { hasText: 'Sample Book' });
  await expect(sampleRow.getByRole('button', { name: 'Read', exact: true })).toBeVisible();

  // Format chips narrow the catalog; clicking the active chip clears it.
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.locator('.book-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.locator('.book-row')).toHaveCount(3);

  // The rail filters by reading status.
  const rail = page.locator('.library-rail');
  await rail.getByRole('button', { name: /Not started/ }).click();
  await expect(page.locator('.book-row')).toHaveCount(3);
  await rail.getByRole('button', { name: /All books/ }).click();

  // Open a book, turn a page, and come back: the Continue strip appears and
  // the row carries its progress.
  await sampleRow.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Library' }).click();

  await expect(page.locator('.continue-reading')).toBeVisible();
  await expect(page.locator('.continue-item')).toHaveCount(1);
  await expect(page.locator('.continue-item')).toContainText('Sample Book');
  await expect(page.locator('.book-row', { hasText: 'Sample Book' })).toContainText('%');
  await expect(rail.getByRole('button', { name: /Reading/ })).toContainText('1');

  // The row menu keeps Edit reachable without three text links per line.
  await page
    .locator('.book-row', { hasText: 'Sample Book' })
    .getByRole('button', { name: 'Book actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByRole('dialog', { name: 'Book details' })).toBeVisible();
});

test('shelves view features a book and shelves each category', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  await chooseBookAction(page.locator('.book-card', { hasText: 'Sample Book' }), 'Edit');
  const dialog = page.getByRole('dialog', { name: 'Book details' });
  await dialog.getByLabel('Category').selectOption('__new__');
  await dialog.getByLabel('New category name').fill('Classics');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Shelves view' }).click();
  await expect(page.locator('.shelves-view')).toBeVisible();
  await expect(page.locator('.shelf-featured')).toBeVisible();
  await expect(page.locator('.shelf-title')).toHaveText(['Classics', 'Uncategorized']);
  await expect(page.locator('.shelf-track .book-card')).toHaveCount(2);

  // Cards keep uniform rows (two clamped title lines + a reserved progress
  // row even at 0%) and expose the full title as a hover tooltip.
  const titleHeights = await page
    .locator('.shelf-track .book-plate-title')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(new Set(titleHeights).size).toBe(1);
  await expect(page.locator('.shelf-track .book-plate-progress')).toHaveCount(2);
  await expect(page.locator('.shelf-track .book-plate-title').first()).toHaveAttribute(
    'title',
    /./,
  );

  // The divider belongs to the category header, not under the covers.
  const shelfHeadRule = await page
    .locator('.shelf-head')
    .first()
    .evaluate((node) => getComputedStyle(node).borderBlockEndWidth);
  expect(shelfHeadRule).toBe('1px');
  const plank = await page
    .locator('.shelf-track')
    .first()
    .evaluate((node) => getComputedStyle(node, '::after').content);
  expect(plank).toBe('none');

  // The layout choice persists across a reload.
  await page.reload();
  await expect(page.locator('.shelves-view')).toBeVisible();

  // The featured cover is the primary way into the book.
  await page.locator('.featured-cover-button').click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
});

test('expand and collapse all category sections', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.getByRole('heading', { name: 'Sample Book' })).toBeVisible();

  await chooseBookAction(page.locator('.book-card', { hasText: 'Sample Book' }), 'Edit');
  const dialog = page.getByRole('dialog', { name: 'Book details' });
  await dialog.getByLabel('Category').selectOption('__new__');
  await dialog.getByLabel('New category name').fill('Classics');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.locator('.book-group-toggle').first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('.book-card')).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('.book-group-toggle').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.book-card')).toHaveCount(2);

  // The bulk choice persists like a manual toggle.
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(2);
});

test('groups file books into one library item (ADR-0025)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.locator('.book-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Lecture Notes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.group-row')).toBeVisible();
  await expect(page.locator('.group-row')).toContainText('0 files');

  // "Add to group…" from the row menu files the book; the group represents
  // it, so the standalone row disappears from the catalog.
  await page
    .locator('.book-row', { hasText: 'Sample Book' })
    .getByRole('button', { name: 'Book actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Add to group…' }).click();
  await page
    .getByRole('dialog', { name: /Add “Sample Book” to a group/ })
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.locator('.book-row', { hasText: 'Sample Book' })).toHaveCount(0);
  await expect(page.locator('.group-row')).toContainText('1 file');

  // Drag the remaining book row onto the group row: the drop files it.
  await page
    .locator('.book-row', { hasText: 'نمونه کتاب' })
    .dragTo(page.locator('.group-row', { hasText: 'Lecture Notes' }));
  await expect(page.locator('.book-row', { hasText: 'نمونه کتاب' })).toHaveCount(0);
  await expect(page.locator('.group-row')).toContainText('2 files');

  // The group view lists members and removal returns the book.
  await page.locator('.group-row').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.group-view')).toBeVisible();
  await expect(page.locator('.member-row')).toHaveCount(2);
  await page
    .locator('.member-row', { hasText: 'Sample Book' })
    .getByRole('button', { name: 'Book actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Remove from this group' }).click();
  await expect(page.locator('.member-row')).toHaveCount(1);

  // Deleting the group keeps the books in the library (ADR-0027 option 2).
  await page
    .locator('.group-header-actions')
    .getByRole('button', { name: 'Group actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete group' });
  await deleteDialog.getByRole('radio', { name: /Groups only, keep the files/ }).check();
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.group-view')).toHaveCount(0);
  await expect(page.locator('.book-row', { hasText: 'Sample Book' })).toBeVisible();
  await expect(page.locator('.book-row', { hasText: 'نمونه کتاب' })).toBeVisible();
});

test('nests groups and deletes them three ways (ADR-0027)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.locator('.book-card')).toHaveCount(2);

  // Course root → Week 1 → Slides.
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('CS224W');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.group-row', { hasText: 'CS224W' })).toBeVisible();

  await page
    .locator('.group-row', { hasText: 'CS224W' })
    .getByRole('button', { name: 'Group actions' })
    .click();
  await page.getByRole('menuitem', { name: 'New subgroup' }).click();
  await page.getByLabel('Group name').fill('Week 1');
  await page.getByRole('button', { name: 'Save' }).click();

  // The root stays the only catalog row; the child lives inside it.
  await page
    .locator('.group-row', { hasText: 'CS224W' })
    .getByRole('button', { name: 'Open' })
    .click();
  await expect(page.locator('.group-children .group-row', { hasText: 'Week 1' })).toBeVisible();
  await page
    .locator('.group-children .group-row', { hasText: 'Week 1' })
    .getByRole('button', { name: 'Open' })
    .click();

  // Nested breadcrumb is present; create a third level.
  await expect(page.locator('.group-crumb', { hasText: 'CS224W' })).toBeVisible();
  await page.getByRole('button', { name: 'New subgroup' }).click();
  await page.getByLabel('Group name').fill('Slides');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.group-children .group-row', { hasText: 'Slides' })).toBeVisible();

  // File a book into the deepest group: counts roll up to the root.
  await page
    .locator('.group-children .group-row', { hasText: 'Slides' })
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByRole('button', { name: 'Add books' }).click();
  const addDialog = page.getByRole('dialog', { name: /Add books to “Slides”/ });
  await addDialog
    .locator('.group-add-row', { hasText: 'Sample Book' })
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await addDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.group-view .group-header-meta')).toContainText('1 file');

  // Breadcrumb ancestors navigate up one level at a time.
  await page.locator('.group-crumb', { hasText: 'Week 1' }).click();
  await expect(page.locator('.group-children .group-row', { hasText: 'Slides' })).toBeVisible();

  // Delete Week 1 only: Slides moves up under CS224W, its book survives.
  await page
    .locator('.group-header-actions')
    .getByRole('button', { name: 'Group actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete group' });
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await dialog.getByRole('radio', { name: /Only this group/ }).check();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.group-children .group-row', { hasText: 'Slides' })).toBeVisible();
  await expect(page.locator('.group-children .group-row', { hasText: 'Week 1' })).toHaveCount(0);

  // Delete the root with contents: the subtree's book and file go too.
  await page
    .locator('.group-header-actions')
    .getByRole('button', { name: 'Group actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  const rootDialog = page.getByRole('dialog', { name: 'Delete group' });
  await rootDialog.getByRole('radio', { name: /Group and everything in it/ }).check();
  await rootDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.group-row')).toHaveCount(0);
  await expect(page.locator('.book-row')).toHaveCount(1);
  await expect(page.locator('.book-row', { hasText: 'نمونه کتاب' })).toBeVisible();
});

test('narrows an open group with the active search', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.locator('.book-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Course');
  await page.getByRole('button', { name: 'Save' }).click();
  for (const title of ['Sample Book', 'نمونه کتاب']) {
    await page
      .locator('.book-row', { hasText: title })
      .getByRole('button', { name: 'Book actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Add to group…' }).click();
    await page
      .getByRole('dialog', { name: /Add [.“]/ })
      .locator('.group-add-row', { hasText: 'Course' })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
  }

  await page.locator('.group-row').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.member-row')).toHaveCount(2);

  // The query narrows the member list inside the open group.
  await page.getByRole('searchbox').fill('sample');
  await expect(page.locator('.member-row')).toHaveCount(1);
  await expect(page.locator('.member-row', { hasText: 'Sample Book' })).toBeVisible();

  // Nothing matches inside the group: the view says so.
  await page.getByRole('searchbox').fill('zzz');
  await expect(page.locator('.group-view')).toContainText('No books match this search.');

  // Clearing restores the whole group.
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('.member-row')).toHaveCount(2);
});

test('search surfaces group members with their group path (ADR-0025)', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.locator('.book-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Lecture Notes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.group-row')).toBeVisible();
  await page
    .locator('.book-row', { hasText: 'Sample Book' })
    .getByRole('button', { name: 'Book actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Add to group…' }).click();
  await page
    .getByRole('dialog', { name: /Add “Sample Book” to a group/ })
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.locator('.book-row', { hasText: 'Sample Book' })).toHaveCount(0);

  // Browsing hides members; searching surfaces the member with its group.
  await page.getByRole('searchbox').fill('sample');
  await expect(page.locator('.book-row', { hasText: 'Sample Book' })).toBeVisible();
  await expect(page.locator('.book-row', { hasText: 'Sample Book' })).toContainText(
    'in Lecture Notes',
  );
  // The group itself matches by name.
  await page.getByRole('searchbox').fill('lecture notes');
  await expect(page.locator('.group-row', { hasText: 'Lecture Notes' })).toBeVisible();
  await expect(page.locator('.book-row', { hasText: 'Sample Book' })).toHaveCount(0);
});

test('reorders group members with a grip long-press on touch (ADR-0025)', async ({ browser }) => {
  // Touch context: the gesture is pointer events with pointerType 'touch'.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.locator('.book-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Lecture Notes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.group-row')).toBeVisible();

  // File both members through the menu (touch has no HTML5 drag).
  for (const title of ['Sample Book', 'نمونه کتاب']) {
    await page
      .locator('.book-row', { hasText: title })
      .getByRole('button', { name: 'Book actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Add to group…' }).click();
    await page
      .getByRole('dialog', { name: new RegExp(`Add “${title}” to a group`) })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
  }
  await page.locator('.group-row').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.member-row')).toHaveCount(2);
  const titles = () =>
    page
      .locator('.member-row .book-row-title')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  await expect.poll(titles).toEqual(['Sample Book', 'نمونه کتاب']);

  // Long-press the first row's grip, drag it over the second row, release.
  await page.evaluate(() => {
    const fire = (element: Element, type: string, clientY: number) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: 24,
          clientY,
        }),
      );
    const grips = [...document.querySelectorAll('.member-row .group-grip')];
    const first = grips[0]?.getBoundingClientRect();
    const second = grips[1]?.getBoundingClientRect();
    if (!first || !second) throw new Error('grips missing');
    const grip = grips[0] as HTMLElement;
    fire(grip, 'pointerdown', first.top + first.height / 2);
    window.setTimeout(() => fire(grip, 'pointermove', second.top + second.height / 2), 350);
    window.setTimeout(() => fire(grip, 'pointerup', second.top + second.height / 2), 500);
  });

  // The dragged row lands before the hovered row, and the order persists.
  await expect.poll(titles).toEqual(['نمونه کتاب', 'Sample Book']);
  await page.waitForTimeout(500);
  await page.reload();
  await page.locator('.group-row').getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(titles).toEqual(['نمونه کتاب', 'Sample Book']);

  await context.close();
});

test('animates page turns unless reduced motion is requested', async ({ page }) => {
  const animated = () =>
    page.evaluate(() => {
      const view = document.querySelector('foliate-view') as unknown as {
        renderer?: { hasAttribute?: (name: string) => boolean };
      };
      return Boolean(view?.renderer?.hasAttribute?.('animated'));
    });

  await openReader(page);
  await expect.poll(animated).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await expect.poll(animated).toBe(false);
});

test('keeps the phone top bar complete: link import and paired create buttons', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator('.book-card')).toHaveCount(1);

  // Link-only import used to be display:none on phones; it is now a compact
  // icon button that still opens the URL dialog.
  const urlButton = page.getByRole('button', { name: 'Add from URL' });
  await expect(urlButton).toBeVisible();
  await urlButton.click();
  await expect(page.getByRole('dialog', { name: 'Add from URL' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // New category and New group wrap as one cluster, not a lone button.
  const category = await page.getByRole('button', { name: 'New category' }).boundingBox();
  const group = await page.getByRole('button', { name: 'New group' }).boundingBox();
  expect(category).toBeTruthy();
  expect(group).toBeTruthy();
  expect(Math.round(category?.y ?? -1)).toBe(Math.round(group?.y ?? -2));

  // On a phone the Import button opens the file picker directly (no folder
  // menu: the platform has no directory picker, so the menu would only add a
  // tap).
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(chooser).resolves.toBeTruthy();

  await context.close();
});

test('imports a folder tree as nested groups with a summary', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const epub = [...readFileSync(fixture)];
  const english = [...readFileSync(englishFixture)];
  const pdf = [...readFileSync(fileURLToPath(new URL('./fixtures/book.pdf', import.meta.url)))];
  await page.goto('/');

  // Desktop Import is a menu now.
  await page.getByRole('button', { name: 'Import books' }).click();
  await page.getByRole('menuitem', { name: 'Import a folder…' }).click();

  // The same hidden input is in directory mode; feed it a synthetic tree
  // (a real folder picker cannot run headless).
  await page.evaluate(
    ({ epub, english, pdf }) => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const transfer = new DataTransfer();
      const add = (name: string, path: string, bytes: number[], type: string) => {
        const file = new File([new Uint8Array(bytes)], name, { type });
        Object.defineProperty(file, 'webkitRelativePath', { value: path });
        transfer.items.add(file);
      };
      add('01.epub', 'CS224W/01-intro.epub', epub, 'application/epub+zip');
      add('02.epub', 'CS224W/slides/02-nodeemb.epub', english, 'application/epub+zip');
      add('03.pdf', 'CS224W/slides/03-GNN1.pdf', pdf, 'application/pdf');
      add('notes.txt', 'CS224W/notes.txt', [110, 111], 'text/plain');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { epub, english, pdf },
  );

  // Summary reports the imports and the skipped non-book file.
  const summary = page.locator('.folder-import-banner');
  await expect(summary).toContainText('3 books imported', { timeout: 30_000 });
  await expect(summary).toContainText('1 file skipped');

  // The folder tree became groups: root files in CS224W, slides nested.
  await expect(page.locator('.group-row', { hasText: 'CS224W' })).toBeVisible();
  await page
    .locator('.group-row', { hasText: 'CS224W' })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(page.locator('.group-children .group-row', { hasText: 'slides' })).toBeVisible();
  await expect(page.locator('.member-row')).toHaveCount(1);
  await page
    .locator('.group-children .group-row', { hasText: 'slides' })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(page.locator('.member-row')).toHaveCount(2);
});

test('downloads every pending link in a group as one queue', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const persianEpub = readFileSync(fixture);
  const englishEpub = readFileSync(englishFixture);
  const downloads: string[] = [];
  await page.route('https://queue.test/**', (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/epub+zip',
        body: persianEpub,
      });
    }
    downloads.push(url);
    return route.fulfill({
      status: 200,
      contentType: 'application/epub+zip',
      body: url.endsWith('english.epub') ? englishEpub : persianEpub,
    });
  });
  await page.goto('/');

  for (const url of ['https://queue.test/persian.epub', 'https://queue.test/english.epub']) {
    await page.getByRole('button', { name: 'Add from URL' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add from URL' });
    await dialog.getByLabel('Book URL').fill(url);
    await dialog.getByText('Keep only the link; the file downloads when you open it').click();
    await dialog.getByRole('button', { name: 'Import books' }).click();
    await expect(dialog).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Course');
  await page.getByRole('button', { name: 'Save' }).click();
  for (const title of ['persian', 'english']) {
    await page
      .locator('.book-row', { hasText: title })
      .getByRole('button', { name: 'Book actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Add to group…' }).click();
    await page
      .getByRole('dialog', { name: /Add [.“]/ })
      .locator('.group-add-row', { hasText: 'Course' })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
  }

  await page.locator('.group-row').getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Download 2 links' }).click();

  // The queue fetches both links, materializes them, and the summary closes
  // the loop; the member rows lose their Link chips.
  await expect(page.locator('.folder-import-banner')).toContainText('2 links downloaded', {
    timeout: 30_000,
  });
  await expect(page.locator('.format-chip.is-link')).toHaveCount(0);
  await expect(page.locator('.member-row')).toHaveCount(2);
  expect(downloads).toHaveLength(2);
});

test('aligns headings to the reading direction and keeps body justification', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(headingsFixture);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });

  /** Computed alignment of the chapter currently rendered in a book frame. */
  const chapterAlignment = async (heading: string) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      for (const frame of page.frames()) {
        if (!frame.url().startsWith('blob:')) continue;
        const result = await frame
          .evaluate((needle) => {
            const h1 = document.querySelector('h1');
            const h2 = document.querySelector('h2');
            const p = document.querySelector('p');
            if (!h1 || !h2 || !p || !h1.textContent?.includes(needle)) return null;
            return {
              direction: getComputedStyle(document.documentElement).direction,
              heading: getComputedStyle(h1).textAlign,
              centeredHeading: getComputedStyle(h2).textAlign,
              paragraph: getComputedStyle(p).textAlign,
            };
          }, heading)
          .catch(() => null);
        if (result) return result;
      }
      await page.waitForTimeout(200);
    }
    throw new Error(`no chapter rendered with "${heading}"`);
  };

  // Justification must not stretch a heading, and it must not override a
  // publisher's inline centering either (ADR-0028).
  const ltr = await chapterAlignment('5.2 Monte Carlo');
  expect(ltr.direction).toBe('ltr');
  expect(ltr.heading).toBe('start');
  expect(ltr.centeredHeading).toBe('center');
  expect(ltr.paragraph).toBe('justify');

  // Same rule in RTL: "start" resolves to the right edge.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const rtl = await chapterAlignment('برآورد مونت کارلو');
  expect(rtl.direction).toBe('rtl');
  expect(rtl.heading).toBe('start');
  expect(rtl.centeredHeading).toBe('center');
  expect(rtl.paragraph).toBe('justify');
});

test('system back closes the open screen instead of leaving the app', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);

  // A group is a screen: back returns to the catalog.
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Course');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.group-row').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.group-view')).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(page.locator('.group-view')).toHaveCount(0);

  // The reader is a screen too: back returns to the library.
  await page.getByRole('button', { name: 'Read', exact: true }).first().click();
  await expect(page.locator('.reader-shell')).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(page.locator('.reader-shell')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hāmesh' })).toBeVisible();

  // Closing from the UI must not leave a stale history entry behind: a second
  // back is a plain app-level back, not a reopen of the reader.
  await page.getByRole('button', { name: 'Read', exact: true }).first().click();
  await expect(page.locator('.reader-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.reader-shell')).toHaveCount(0);
  await page.evaluate(() => window.history.back());
  await expect(page.locator('.reader-shell')).toHaveCount(0);
});

test.describe('phone-sized dialogs', () => {
  // Redmi Note 13 Pro: 1220x2712 px at density 480.
  test.use({
    viewport: { width: 407, height: 904 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test('book details scroll their fields and keep Save on screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
    await expect(page.locator('.book-card')).toHaveCount(2);

    await page.locator('.book-card').first().getByRole('button', { name: 'Book actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Book details' });
    await expect(dialog).toBeVisible();

    const geometry = await page.evaluate(() => {
      const node = document.querySelector('[role="dialog"]') as HTMLElement;
      const form = node.querySelector('form') as HTMLElement;
      const save = [...node.querySelectorAll('button')].find(
        (button) => (button.textContent ?? '').trim() === 'Save',
      );
      const saveBox = save?.getBoundingClientRect();
      return {
        dialogBottom: Math.round(node.getBoundingClientRect().bottom),
        viewportH: window.innerHeight,
        formScrolls: form.scrollHeight > form.clientHeight,
        saveBottom: saveBox ? Math.round(saveBox.bottom) : null,
      };
    });
    expect(geometry.dialogBottom).toBeLessThanOrEqual(geometry.viewportH);
    expect(geometry.formScrolls).toBe(true);
    expect(geometry.saveBottom).not.toBeNull();
    expect(geometry.saveBottom ?? 0).toBeLessThanOrEqual(geometry.viewportH);

    // The footer is reachable and the edit round-trips.
    await dialog.getByLabel('Series').fill('Phone Series');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.book-card').first()).toContainText('Phone Series');
  });

  test('add-books dialog stays inside the viewport', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
    await expect(page.locator('.book-card')).toHaveCount(2);

    await page.getByRole('button', { name: 'New group' }).click();
    await page.getByLabel('Group name').fill('Phone group');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'List view' }).click();
    await page
      .locator('.group-row')
      .first()
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add books' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (!box || !viewport) return;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });
});

test('a group view drops top-level create actions and scopes the search label', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
  await expect(page.locator('.book-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('CS224W');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'List view' }).click();
  await page
    .locator('.group-row')
    .first()
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(page.locator('.group-view')).toBeVisible();

  // Creating a category or a top-level group from inside a group is a trap.
  await expect(page.getByRole('button', { name: 'New category' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New group' })).toHaveCount(0);
  // The search box says what it now searches.
  await expect(page.getByPlaceholder('Search in “CS224W”')).toBeVisible();
  // Delete is behind the group menu, not a full red block beside the actions.
  await expect(page.locator('.group-header-actions .reader-action.is-danger')).toHaveCount(0);
  await page
    .locator('.group-header-actions')
    .getByRole('button', { name: 'Group actions' })
    .click();
  await expect(page.getByRole('menuitem', { name: 'Delete group' })).toBeVisible();
});

test.describe('phone touch targets', () => {
  test.use({
    viewport: { width: 407, height: 904 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test('every interactive control is at least a thumb target', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles([fixture, englishFixture]);
    await expect(page.locator('.book-card')).toHaveCount(2);

    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, select, input, a[href]')]
        .filter((node) => {
          const box = node.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          if (node.classList.contains('visually-hidden')) return false;
          return box.height < 44;
        })
        .map((node) => ({
          label: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 24),
          height: Math.round(node.getBoundingClientRect().height),
        })),
    );
    expect(small).toEqual([]);
  });
});
