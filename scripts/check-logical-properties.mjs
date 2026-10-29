#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const walk = async (dir) => {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(path)));
    } else if (/\.(css|ts|tsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
};

const rules = [
  {
    name: 'physical margin/padding/border',
    pattern: /\b(?:margin|padding|border)-(?:left|right)\b/g,
  },
  {
    name: 'physical inset',
    pattern: /(?:^|[;{\s])(?:left|right)\s*:/g,
  },
  {
    name: 'physical text alignment',
    pattern: /text-align\s*:\s*(?:left|right)\b/g,
  },
  {
    name: 'physical float',
    pattern: /float\s*:\s*(?:left|right)\b/g,
  },
  {
    name: 'physical Tailwind utility',
    pattern:
      /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r)-/g,
  },
];

const errors = [];

const checkFile = async (path) => {
  const source = await readFile(path, 'utf8');
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('logical-properties-ignore')) return;
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        errors.push(`${relative(root, path)}:${index + 1}: ${rule.name}: ${line.trim()}`);
      }
      rule.pattern.lastIndex = 0;
    }
  });
};

for (const group of ['packages', 'apps']) {
  const entries = await readdir(join(root, group), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (group === 'packages' && entry.name === 'test-fixtures') continue;
    for (const file of await walk(join(root, group, entry.name, 'src'))) {
      await checkFile(file);
    }
  }
}

if (errors.length > 0) {
  console.error('Physical layout properties found. Use CSS logical properties:\n');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log('Logical properties OK.');
