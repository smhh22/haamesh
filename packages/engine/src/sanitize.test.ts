import { describe, expect, it } from 'vitest';
import { sanitizeEpubHtml } from './sanitize';

describe('sanitizeEpubHtml', () => {
  it('removes scripts, event handlers, and javascript URLs', () => {
    const html = `<html><head><title>x</title></head><body>
      <script>alert(1)</script>
      <p onclick="alert(2)">text</p>
      <a href="javascript:alert(3)">link</a>
    </body></html>`;
    const clean = sanitizeEpubHtml(html);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('<p>text</p>');
  });

  it('injects a restrictive CSP into the head', () => {
    const clean = sanitizeEpubHtml('<html><head><title>x</title></head><body>text</body></html>');
    expect(clean).toContain('Content-Security-Policy');
    expect(clean).toContain("default-src 'none'");
    expect(clean).toContain('img-src blob: data:');
  });

  it('does not duplicate an existing CSP', () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"/></head><body>text</body></html>';
    const clean = sanitizeEpubHtml(html);
    expect(clean.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('preserves ordinary markup', () => {
    const html = '<html><head></head><body><p dir="rtl">سلام</p></body></html>';
    expect(sanitizeEpubHtml(html)).toContain('<p dir="rtl">سلام</p>');
  });
});
