import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestEpub } from '../src/epub.ts';

const target = fileURLToPath(new URL('../../../e2e/fixtures/sample.epub', import.meta.url));
mkdirSync(fileURLToPath(new URL('../../../e2e/fixtures', import.meta.url)), { recursive: true });
writeFileSync(target, Buffer.from(createTestEpub()));
console.log(`wrote ${target}`);
