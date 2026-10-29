import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestEpub } from '../src/epub.ts';

const fixturesDir = fileURLToPath(new URL('../../../e2e/fixtures', import.meta.url));
mkdirSync(fixturesDir, { recursive: true });

const persian = fileURLToPath(new URL('../../../e2e/fixtures/sample.epub', import.meta.url));
writeFileSync(persian, Buffer.from(createTestEpub()));
console.log(`wrote ${persian}`);

const english = fileURLToPath(new URL('../../../e2e/fixtures/english.epub', import.meta.url));
writeFileSync(
  english,
  Buffer.from(
    createTestEpub({
      title: 'Sample Book',
      author: 'Alice Example',
      language: 'en',
      pageProgression: 'ltr',
    }),
  ),
);
console.log(`wrote ${english}`);
