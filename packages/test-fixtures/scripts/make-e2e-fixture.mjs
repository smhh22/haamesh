import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestEpub } from '../src/epub.ts';
import { createTestPdf } from '../src/pdf.ts';

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

// Persian content with no dir attribute and no page-progression-direction in
// the OPF: the reader must apply the resolved RTL direction itself.
const nodir = fileURLToPath(new URL('../../../e2e/fixtures/nodir.epub', import.meta.url));
writeFileSync(
  nodir,
  Buffer.from(
    createTestEpub({
      title: 'کتاب بی‌جهت',
      author: 'نویسنده آزمون',
      language: 'fa',
      omitDir: true,
      pageProgression: 'rtl',
    }),
  ),
);
console.log(`wrote ${nodir}`);

const pdf = fileURLToPath(new URL('../../../e2e/fixtures/sample.pdf', import.meta.url));
writeFileSync(pdf, Buffer.from(createTestPdf(4)));
console.log(`wrote ${pdf}`);
