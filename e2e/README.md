# End-to-end tests

Browser tests run against the Vite dev server on Chromium:

```bash
pnpm test:e2e
```

`fixtures/sample.epub` is generated from the shared test fixture builder. After
changing `packages/test-fixtures/src/epub.ts`, regenerate it:

```bash
pnpm --filter @hamesh/test-fixtures fixture:e2e
```

The tests cover:

- importing a Persian EPUB and reading it end to end;
- opening the reader and rendering the first page;
- switching the interface to Persian RTL;
- advancing pages and resuming at the saved position after closing and
  reopening the book.

Screenshots are written to `e2e/artifacts/` and are intentionally untracked.
