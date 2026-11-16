import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The orchestration imports (persistence/stores) pull the storage stack in;
// these tests only exercise the pure URL/id/probe helpers.
vi.mock('./libraryPersistence', () => ({
  persistBook: vi.fn(),
  deletePersistedBook: vi.fn(),
}));
vi.mock('../stores/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({ books: [], addBook: vi.fn(), removeBook: vi.fn() }),
  },
}));

import type { BookRecord } from '@hamesh/storage';
import {
  detectLinkFormat,
  isPendingBook,
  LinkImportError,
  normalizeLinkUrl,
  pendingBookId,
  probeLink,
  readLinkSizeCapMb,
  saveLinkSizeCapMb,
  titleFromLink,
} from './linkImport';

const book = (identifiers: Record<string, string>): BookRecord =>
  ({ identifiers }) as unknown as BookRecord;

describe('normalizeLinkUrl', () => {
  it('accepts http(s), strips the fragment', () => {
    expect(normalizeLinkUrl('https://example.com/a.pdf#page=3').toString()).toBe(
      'https://example.com/a.pdf',
    );
    expect(normalizeLinkUrl('http://example.com/a.epub').protocol).toBe('http:');
  });

  it('rejects non-http schemes and credentials', () => {
    expect(() => normalizeLinkUrl('ftp://example.com/a.epub')).toThrow(LinkImportError);
    expect(() => normalizeLinkUrl('file:///etc/passwd')).toThrow(LinkImportError);
    expect(() => normalizeLinkUrl('https://user:pass@example.com/a.epub')).toThrow(LinkImportError);
    expect(() => normalizeLinkUrl('not a url')).toThrow(LinkImportError);
  });
});

describe('pendingBookId', () => {
  it('is deterministic and URL-sensitive', async () => {
    const one = await pendingBookId(normalizeLinkUrl('https://example.com/a.epub'));
    const again = await pendingBookId(normalizeLinkUrl('https://example.com/a.epub#x'));
    const other = await pendingBookId(normalizeLinkUrl('https://example.com/b.epub'));
    expect(one).toBe(again);
    expect(one).not.toBe(other);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('titleFromLink', () => {
  it('uses the decoded file stem, falling back to the host', () => {
    expect(titleFromLink(normalizeLinkUrl('https://example.com/notes%20one.pdf'))).toBe(
      'notes one',
    );
    expect(titleFromLink(normalizeLinkUrl('https://example.com/'))).toBe('example.com');
  });
});

describe('detectLinkFormat', () => {
  it('detects from the extension and the content type', () => {
    expect(detectLinkFormat(normalizeLinkUrl('https://e.com/x.epub'), null)).toBe('epub');
    expect(detectLinkFormat(normalizeLinkUrl('https://e.com/x'), 'application/pdf')).toBe('pdf');
    expect(detectLinkFormat(normalizeLinkUrl('https://e.com/x'), 'video/mp4; codecs=avc1')).toBe(
      'video',
    );
    expect(detectLinkFormat(normalizeLinkUrl('https://e.com/x'), 'text/html')).toBeNull();
  });
});

describe('probeLink', () => {
  beforeEach(() => saveLinkSizeCapMb(1));
  afterEach(() => saveLinkSizeCapMb(2048));

  it('rejects unsupported types', async () => {
    const fake = vi.fn(
      async () => new Response(null, { headers: { 'content-type': 'text/html' } }),
    );
    await expect(
      probeLink(normalizeLinkUrl('https://e.com/page'), fake as never),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('enforces the size cap from HEAD', async () => {
    const fake = vi.fn(
      async () =>
        new Response(null, {
          headers: { 'content-type': 'application/pdf', 'content-length': String(2 * 1024 * 1024) },
        }),
    );
    await expect(
      probeLink(normalizeLinkUrl('https://e.com/x.pdf'), fake as never),
    ).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
  });

  it('falls back to the extension when HEAD is unsupported', async () => {
    const fake = vi.fn(async () => new Response(null, { status: 405 }));
    await expect(
      probeLink(normalizeLinkUrl('https://e.com/x.pdf'), fake as never),
    ).resolves.toMatchObject({ format: 'pdf', contentType: null });
  });
});

describe('readLinkSizeCapMb', () => {
  it('defaults to 2048 with empty storage and persists a valid value', () => {
    // Empty storage must yield the default, not zero (Number(null) is 0).
    localStorage.removeItem('hamesh.library.linkSizeCapMb');
    expect(readLinkSizeCapMb()).toBe(2048);
    saveLinkSizeCapMb(512);
    expect(readLinkSizeCapMb()).toBe(512);
    saveLinkSizeCapMb(0);
    expect(readLinkSizeCapMb()).toBe(0);
  });
});

describe('isPendingBook', () => {
  it('reads the pending marker', () => {
    expect(isPendingBook(book({ pending: '1' }))).toBe(true);
    expect(isPendingBook(book({}))).toBe(false);
  });
});
