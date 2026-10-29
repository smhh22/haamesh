# End-to-end tests

Browser tests run against the Vite dev server on Chromium:

```bash
pnpm test:e2e
```

Fixtures are generated from the shared test fixture builder. After changing
`packages/test-fixtures/src/epub.ts`, regenerate them:

```bash
pnpm --filter @hamesh/test-fixtures fixture:e2e
```

- `fixtures/sample.epub` — Persian, RTL, multi-page, with a TOC and cover.
- `fixtures/english.epub` — English, LTR metadata.

The tests cover:

- importing Persian and English EPUBs;
- opening the reader, rendering pages, and English LTR reading;
- switching the interface to Persian RTL;
- library persistence across a full reload;
- resuming the reading position after closing, reopening, and reloading;
- library search, sort, and grid/list views;
- TOC navigation, font size, theme, and scrolled mode;
- in-book search with result navigation;
- creating a highlight and a bookmark, then reloading and finding them in the
  Notes panel.

Screenshots are written to `e2e/artifacts/` and are intentionally untracked.
Desktop open-with is not covered here; it is verified by launching the Tauri
binary with an EPUB path (see `docs/setup.md`).
