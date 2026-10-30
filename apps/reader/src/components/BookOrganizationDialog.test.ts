import { describe, expect, it } from 'vitest';
import { parseTags } from './BookOrganizationDialog';

describe('parseTags', () => {
  it('splits on Latin and Persian commas, trims, and dedupes', () => {
    expect(parseTags('persian, history،  travel ,, persian')).toEqual([
      'persian',
      'history',
      'travel',
    ]);
    expect(parseTags('   ')).toEqual([]);
  });
});
