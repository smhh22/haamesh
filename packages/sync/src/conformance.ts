import type { StorageProvider } from './provider';

export interface ConformanceCheck {
  name: string;
  run: (createProvider: () => StorageProvider) => Promise<void>;
}

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`conformance: ${message}`);
};

/**
 * One shared conformance suite: every StorageProvider implementation must pass
 * it before it ships (ADR-0006). The checks are runtime functions so they can
 * run both as vitest tests and against a live server from a script.
 */
export const providerConformanceChecks: ConformanceCheck[] = [
  {
    name: 'round-trips text',
    run: async (createProvider) => {
      const provider = createProvider();
      assert((await provider.readText('docs/file.json')) === null, 'missing text should be null');
      await provider.writeText('docs/file.json', '{"a":1}');
      assert((await provider.readText('docs/file.json')) === '{"a":1}', 'text round-trip');
    },
  },
  {
    name: 'round-trips binary',
    run: async (createProvider) => {
      const provider = createProvider();
      const data = new Uint8Array([0, 1, 2, 250, 251, 252]).buffer;
      assert(
        (await provider.readBinary('blobs/book.epub')) === null,
        'missing blob should be null',
      );
      await provider.writeBinary('blobs/book.epub', data);
      const read = new Uint8Array(
        (await provider.readBinary('blobs/book.epub')) ?? new ArrayBuffer(0),
      );
      assert(read.length === 6 && read[3] === 250 && read[5] === 252, 'binary round-trip');
    },
  },
  {
    name: 'heads existing and missing files',
    run: async (createProvider) => {
      const provider = createProvider();
      assert((await provider.head('docs/missing.json')) === null, 'missing head should be null');
      await provider.writeText('docs/here.json', 'x'.repeat(42));
      const head = await provider.head('docs/here.json');
      assert(head !== null, 'head should exist');
      if (head?.size !== undefined) assert(head.size === 42, 'head size');
    },
  },
  {
    name: 'creates parent directories implicitly on write and via ensureDir',
    run: async (createProvider) => {
      const provider = createProvider();
      await provider.ensureDir(['Hamesh', 'Hamesh/books', 'Hamesh/books/abc']);
      await provider.writeText('Hamesh/books/abc/meta.json', '{}');
      assert((await provider.readText('Hamesh/books/abc/meta.json')) === '{}', 'nested write/read');
    },
  },
  {
    name: 'lists directories with entries',
    run: async (createProvider) => {
      const provider = createProvider();
      await provider.writeText('Hamesh/index.json', 'index');
      await provider.writeText('Hamesh/books/a/meta.json', '{}');
      const root = await provider.list('Hamesh');
      const names = root.map((entry) => entry.name).sort();
      assert(
        names.includes('index.json') && names.includes('books'),
        `listing keys: ${names.join(',')}`,
      );
    },
  },
  {
    name: 'lists an empty or missing directory as empty',
    run: async (createProvider) => {
      const provider = createProvider();
      const entries = await provider.list('nothing/here');
      assert(Array.isArray(entries) && entries.length === 0, 'empty listing');
    },
  },
  {
    name: 'deletes a single file idempotently',
    run: async (createProvider) => {
      const provider = createProvider();
      await provider.writeText('docs/one.json', 'x');
      await provider.deleteFile('docs/one.json');
      assert((await provider.readText('docs/one.json')) === null, 'file deleted');
      await provider.deleteFile('docs/one.json');
    },
  },
  {
    name: 'deletes a directory tree',
    run: async (createProvider) => {
      const provider = createProvider();
      await provider.writeText('tree/child/leaf.json', 'x');
      await provider.deleteDir('tree');
      assert((await provider.readText('tree/child/leaf.json')) === null, 'tree deleted');
    },
  },
  {
    name: 'survives overwrites',
    run: async (createProvider) => {
      const provider = createProvider();
      await provider.writeText('docs/file.json', 'v1');
      await provider.writeText('docs/file.json', 'v2');
      assert((await provider.readText('docs/file.json')) === 'v2', 'overwrite');
    },
  },
];
