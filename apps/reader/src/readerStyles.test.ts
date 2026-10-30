import { describe, expect, it } from 'vitest';
import { buildReaderCss, type ReaderStyleInput } from './readerStyles';

const base: ReaderStyleInput = {
  fontSize: 100,
  theme: 'light',
  justify: true,
  fontFamily: 'vazirmatn',
  lineHeight: 1.9,
  hyphenate: false,
  flow: 'paginated',
  margin: 16,
};

describe('buildReaderCss', () => {
  it('applies font size, theme colors, and justification', () => {
    const css = buildReaderCss({ ...base, fontSize: 120, theme: 'sepia' });
    expect(css).toContain('font-size: 120%');
    expect(css).toContain('background: #f4ecd8');
    expect(css).toContain('text-align: justify');
  });

  it('uses start alignment and dark colors when requested', () => {
    const css = buildReaderCss({ ...base, fontSize: 90, theme: 'dark', justify: false });
    expect(css).toContain('text-align: start');
    expect(css).toContain('background: #14161a');
    expect(css).toContain('color: #e9e4d9');
  });

  it('applies the chosen font stack and line height', () => {
    const css = buildReaderCss({ ...base, fontFamily: 'literata', lineHeight: 2.1 });
    expect(css).toContain('font-family: "Literata", "Vazirmatn", serif');
    expect(css).toContain('line-height: 2.1');
  });

  it('toggles hyphenation', () => {
    expect(buildReaderCss(base)).toContain('hyphens: none');
    expect(buildReaderCss({ ...base, hyphenate: true })).toContain('hyphens: auto');
  });

  it('pads the body only in scrolled flow', () => {
    expect(buildReaderCss({ ...base, margin: 32 })).not.toContain('padding-inline: 32px');
    expect(buildReaderCss({ ...base, margin: 32, flow: 'scrolled' })).toContain(
      'padding-inline: 32px',
    );
  });

  it('disables letter spacing', () => {
    expect(buildReaderCss(base)).toContain('letter-spacing: normal');
  });
});
