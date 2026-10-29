import { describe, expect, it } from 'vitest';
import { locatorFromRelocate } from './readerLocator';

describe('locatorFromRelocate', () => {
  it('builds a page locator for PDF', () => {
    expect(
      locatorFromRelocate({ fraction: 0.5, section: { current: 2, total: 10 } }, true),
    ).toEqual({ kind: 'page', page: 3, fraction: 0.5 });
  });

  it('builds a CFI locator for EPUB', () => {
    expect(locatorFromRelocate({ fraction: 0.2, cfi: 'epubcfi(/6/2)' }, false)).toEqual({
      kind: 'cfi',
      cfi: 'epubcfi(/6/2)',
      fraction: 0.2,
    });
  });

  it('returns null without a usable position', () => {
    expect(locatorFromRelocate({ fraction: 0.2 }, false)).toBeNull();
    expect(locatorFromRelocate({ fraction: 0.2 }, true)).toBeNull();
    expect(locatorFromRelocate({ cfi: 'x' }, false)).toBeNull();
  });

  it('clamps the fraction', () => {
    expect(
      locatorFromRelocate({ fraction: 2, section: { current: 0, total: 1 } }, true)?.fraction,
    ).toBe(1);
  });
});
