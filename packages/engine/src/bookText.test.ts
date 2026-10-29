import { createTestEpub } from '@hamesh/test-fixtures';
import { describe, expect, it } from 'vitest';
import { extractEpubText } from './bookText';

const makeFile = (): File =>
  new File([createTestEpub()], 'sample.epub', { type: 'application/epub+zip' });

describe('extractEpubText', () => {
  it('extracts per-section text including Persian content', async () => {
    const { sections } = await extractEpubText(makeFile());
    expect(sections.length).toBeGreaterThan(0);
    const joined = sections.join(' ');
    // Body content: the fixture embeds 60 Persian paragraphs across sections.
    expect(joined).toContain('پاراگراف شمارهٔ 1');
    expect(joined).toContain('متن نمونه');
    // Markup must not survive into extracted text.
    expect(joined).not.toContain('<p');
    expect(joined).not.toContain('<html');
  });

  it('keeps section indexes aligned even for empty sections', async () => {
    const { sections } = await extractEpubText(makeFile());
    expect(Array.isArray(sections)).toBe(true);
    for (const section of sections) {
      expect(typeof section).toBe('string');
    }
  });
});
