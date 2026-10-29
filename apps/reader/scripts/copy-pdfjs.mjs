import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../../vendor/foliate-js/vendor/pdfjs', import.meta.url));
const target = fileURLToPath(new URL('../public/vendor/pdfjs', import.meta.url));

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const file of ['pdf.worker.mjs', 'text_layer_builder.css', 'annotation_layer_builder.css']) {
  await cp(`${source}/${file}`, `${target}/${file}`);
}

for (const directory of ['cmaps', 'standard_fonts']) {
  await cp(`${source}/${directory}`, `${target}/${directory}`, { recursive: true });
}

console.log(`pdf.js assets copied to ${target}`);
