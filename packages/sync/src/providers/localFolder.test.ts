import { describe, expect, it } from 'vitest';
import { describeProviderConformance } from '../conformance.vitest';
import type { FolderFs } from './localFolder';
import { createLocalFolderProvider } from './localFolder';

/**
 * The intended desktop FileSystemPort adapter semantics: writes create parent
 * directories, listing a file fails, removal of a directory removes the tree.
 */
const createFakeFs = (): FolderFs & { dirs: Set<string> } => {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['']);
  const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
  const norm = (path: string): string => path.replace(/^\/+|\/+$/g, '');

  return {
    dirs,
    async readFile(path) {
      const data = files.get(norm(path));
      if (!data) throw new Error(`ENOENT: ${path}`);
      return data;
    },
    async writeFile(path, data) {
      const clean = norm(path);
      const parent = parentOf(clean);
      if (!dirs.has(parent) && parent !== '') {
        // Implicit mkdir -p like the desktop adapter.
        let current = '';
        for (const segment of parent.split('/')) {
          current = current ? `${current}/${segment}` : segment;
          dirs.add(current);
        }
      }
      files.set(clean, data);
    },
    async exists(path) {
      const clean = norm(path);
      return files.has(clean) || dirs.has(clean);
    },
    async remove(path) {
      const clean = norm(path);
      if (dirs.has(clean)) {
        for (const key of [...files.keys()]) if (key.startsWith(`${clean}/`)) files.delete(key);
        for (const key of [...dirs]) if (key.startsWith(`${clean}/`)) dirs.delete(key);
        dirs.delete(clean);
        return;
      }
      files.delete(clean);
    },
    async list(path) {
      const clean = norm(path);
      if (!dirs.has(clean)) throw new Error(`ENOTDIR: ${path}`);
      const prefix = clean ? `${clean}/` : '';
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix) || key === prefix) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;
        names.add(rest.includes('/') ? (rest.split('/')[0] ?? rest) : rest);
      }
      for (const key of dirs) {
        if (key === '' || key === clean || !key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;
        names.add(rest.includes('/') ? (rest.split('/')[0] ?? rest) : rest);
      }
      return [...names].sort();
    },
  };
};

describe('local folder provider', () => {
  describeProviderConformance(() => createLocalFolderProvider(createFakeFs()));

  it('detects directories from filesystem structure', async () => {
    const fs = createFakeFs();
    const provider = createLocalFolderProvider(fs);
    await provider.writeText('Hamesh/index.json', '{}');
    await provider.writeText('Hamesh/books/x/meta.json', '{}');
    const entries = await provider.list('Hamesh');
    const books = entries.find((entry) => entry.name === 'books');
    const index = entries.find((entry) => entry.name === 'index.json');
    expect(books?.isDirectory).toBe(true);
    expect(index?.isDirectory).toBe(false);
  });
});
