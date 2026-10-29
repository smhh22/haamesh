import { createTestEpub } from '@hamesh/test-fixtures';
import { describe, expect, it } from 'vitest';
import { getBookFile } from './bookFiles';
import { importBookFile } from './importBook';

describe('importBookFile', () => {
  it('creates a library record and remembers the file', async () => {
    const file = new File([createTestEpub()], 'sample.epub', {
      type: 'application/epub+zip',
    });

    const record = await importBookFile(file);

    expect(record.id).toBe(record.hash);
    expect(record.title).toBe('نمونه کتاب');
    expect(record.authors).toEqual(['نویسنده آزمون']);
    expect(record.language).toBe('fa');
    expect(record.direction).toBe('rtl');
    expect(record.filePath).toBe('sample.epub');
    expect(getBookFile(record.hash)).toBe(file);
  });
});
