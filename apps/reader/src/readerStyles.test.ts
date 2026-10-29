import { describe, expect, it } from 'vitest';
import { buildReaderCss } from './readerStyles';

describe('buildReaderCss', () => {
  it('applies font size, theme colors, and justification', () => {
    const css = buildReaderCss({ fontSize: 120, theme: 'sepia', justify: true });
    expect(css).toContain('font-size: 120%');
    expect(css).toContain('background: #f4ecd8');
    expect(css).toContain('text-align: justify');
  });

  it('uses start alignment and dark colors when requested', () => {
    const css = buildReaderCss({ fontSize: 90, theme: 'dark', justify: false });
    expect(css).toContain('text-align: start');
    expect(css).toContain('background: #1e1e1e');
    expect(css).toContain('color: #e6e1d8');
  });

  it('disables hyphenation and letter spacing', () => {
    const css = buildReaderCss({ fontSize: 100, theme: 'light', justify: true });
    expect(css).toContain('letter-spacing: normal');
    expect(css).toContain('hyphens: none');
  });
});
