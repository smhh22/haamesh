/**
 * One shared conformance suite: every StorageProvider implementation must
 * pass it before it ships (ADR-0006). Tests exercise only the contract.
 */
import { describe, expect, it } from 'vitest';
import type { StorageProvider } from './provider';

export const runProviderConformance = (createProvider: () => StorageProvider): void => {
  describe('provider conformance', () => {
    it('round-trips text', async () => {
      const provider = createProvider();
      expect(await provider.readText('docs/file.json')).toBeNull();
      await provider.writeText('docs/file.json', '{"a":1}');
      expect(await provider.readText('docs/file.json')).toBe('{"a":1}');
    });

    it('round-trips binary', async () => {
      const provider = createProvider();
      const data = new Uint8Array([0, 1, 2, 250, 251, 252]).buffer;
      expect(await provider.readBinary('blobs/book.epub')).toBeNull();
      await provider.writeBinary('blobs/book.epub', data);
      const read = await provider.readBinary('blobs/book.epub');
      expect(new Uint8Array(read ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([0, 1, 2, 250, 251, 252]),
      );
    });

    it('heads existing and missing files', async () => {
      const provider = createProvider();
      expect(await provider.head('docs/missing.json')).toBeNull();
      await provider.writeText('docs/here.json', 'x'.repeat(42));
      const head = await provider.head('docs/here.json');
      expect(head).not.toBeNull();
      if (head?.size !== undefined) expect(head.size).toBe(42);
    });

    it('creates parent directories implicitly on write and via ensureDir', async () => {
      const provider = createProvider();
      await provider.ensureDir(['Hamesh', 'Hamesh/books', 'Hamesh/books/abc']);
      await provider.writeText('Hamesh/books/abc/meta.json', '{}');
      expect(await provider.readText('Hamesh/books/abc/meta.json')).toBe('{}');
    });

    it('lists directories with entries', async () => {
      const provider = createProvider();
      await provider.writeText('Hamesh/index.json', 'index');
      await provider.writeText('Hamesh/books/a/meta.json', '{}');
      const root = await provider.list('Hamesh');
      expect(root.map((entry) => entry.name).sort()).toEqual(['books', 'index.json']);
      expect(root.find((entry) => entry.name === 'books')?.isDirectory).toBe(true);
      const books = await provider.list('Hamesh/books');
      expect(books.map((entry) => entry.name)).toEqual(['a']);
    });

    it('lists an empty or missing directory as empty', async () => {
      const provider = createProvider();
      expect(await provider.list('nothing/here')).toEqual([]);
    });

    it('deletes a directory tree', async () => {
      const provider = createProvider();
      await provider.writeText('tree/child/leaf.json', 'x');
      await provider.deleteDir('tree');
      expect(await provider.readText('tree/child/leaf.json')).toBeNull();
    });

    it('survives overwrites', async () => {
      const provider = createProvider();
      await provider.writeText('docs/file.json', 'v1');
      await provider.writeText('docs/file.json', 'v2');
      expect(await provider.readText('docs/file.json')).toBe('v2');
    });
  });
};
