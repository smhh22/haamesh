#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const internalDeps = {
  core: [],
  platform: ['core'],
  engine: ['core'],
  storage: ['core', 'platform'],
  sync: ['core', 'storage'],
  ui: ['core'],
  'test-fixtures': ['core', 'platform', 'storage', 'sync'],
};

const forbiddenExternal = {
  core: [/^react$/, /^react-dom/, /^@tauri-apps\//, /^node:/, /^fs$/, /^path$/],
  platform: [/^react$/, /^react-dom/, /^@tauri-apps\//, /^node:/],
  engine: [/^react$/, /^react-dom/, /^@tauri-apps\//],
  storage: [/^react$/, /^react-dom/, /^@tauri-apps\//],
  sync: [/^react$/, /^react-dom/, /^@tauri-apps\//, /^node:/],
  ui: [/^@tauri-apps\//, /^node:/],
};

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
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
};

const importsOf = (source) => {
  const found = [];
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    const patterns = [
      /\bfrom\s+['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /^\s*import\s+['"]([^'"]+)['"]/g,
    ];
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        found.push({ specifier: match[1], line: index + 1 });
      }
    }
  });
  return found;
};

const isTest = (path) => /\.test\.(ts|tsx)$/.test(path);

const errors = [];

const checkFile = async (path, packageName) => {
  const source = await readFile(path, 'utf8');
  for (const { specifier, line } of importsOf(source)) {
    const where = `${relative(root, path)}:${line}`;

    if (specifier.startsWith('@hamesh/')) {
      const rest = specifier.slice('@hamesh/'.length);
      const [target, ...deep] = rest.split('/');
      if (deep.length > 0) {
        errors.push(
          `${where}: deep import "${specifier}" is not allowed; use the package entry point`,
        );
        continue;
      }
      if (target === packageName) {
        errors.push(`${where}: package "${packageName}" must not import itself by name`);
        continue;
      }
      if (packageName === 'app') continue;
      if (target === 'test-fixtures' && isTest(path)) continue;
      if (!internalDeps[packageName]?.includes(target)) {
        errors.push(
          `${where}: "${packageName}" may not import "@hamesh/${target}" ` +
            `(allowed: ${internalDeps[packageName]?.join(', ') || 'none'})`,
        );
      }
      continue;
    }

    const banned = forbiddenExternal[packageName];
    if (banned?.some((pattern) => pattern.test(specifier))) {
      errors.push(`${where}: "${packageName}" must not depend on "${specifier}"`);
    }
  }
};

const packageDirs = await readdir(join(root, 'packages'), { withFileTypes: true });
for (const entry of packageDirs) {
  if (!entry.isDirectory()) continue;
  for (const file of await walk(join(root, 'packages', entry.name, 'src'))) {
    await checkFile(file, entry.name);
  }
}

const appDirs = await readdir(join(root, 'apps'), { withFileTypes: true });
for (const entry of appDirs) {
  if (!entry.isDirectory()) continue;
  for (const file of await walk(join(root, 'apps', entry.name, 'src'))) {
    await checkFile(file, 'app');
  }
}

if (errors.length > 0) {
  console.error('Package boundary violations:\n');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log('Package boundaries OK.');
