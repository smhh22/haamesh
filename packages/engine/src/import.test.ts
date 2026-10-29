import { createTestEpub } from '@hamesh/test-fixtures';
import { describe, expect, it } from 'vitest';
import { importEpub } from './import';

const makeFile = (bytes = createTestEpub()): File =>
  new File([bytes], 'sample.epub', { type: 'application/epub+zip' });

describe('importEpub', () => {
  it('extracts identity, metadata, direction, and cover', async () => {
    const result = await importEpub(makeFile());

    expect(result.metadata.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metadata.format).toBe('epub');
    expect(result.metadata.title).toBe('نمونه کتاب');
    expect(result.metadata.authors).toEqual(['نویسنده آزمون']);
    expect(result.metadata.language).toBe('fa');
    expect(result.metadata.direction).toBe('rtl');
    expect(result.metadata.identifiers.primary).toBe('urn:uuid:hamesh-test-book');
    expect(result.cover).not.toBeNull();
    expect(result.cover?.type).toBe('image/png');
  });

  it('produces the same hash for identical bytes', async () => {
    const bytes = createTestEpub();
    const first = await importEpub(makeFile(bytes));
    const second = await importEpub(makeFile(bytes));
    expect(first.metadata.hash).toBe(second.metadata.hash);
  });

  it('rejects an empty file', async () => {
    const empty = new File([], 'empty.epub', { type: 'application/epub+zip' });
    await expect(importEpub(empty)).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
});
