import { describe, expect, it } from 'vitest';
import { isSanitizableMediaType, sanitizeEpubHtml } from './sanitize';

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

  it('strips embedded frames and objects', () => {
    const html = `<html><head></head><body>
      <iframe src="https://evil.example/track"></iframe>
      <object data="https://evil.example/x"></object>
      <embed src="https://evil.example/y">
      text
    </body></html>`;
    const clean = sanitizeEpubHtml(html);
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<object');
    expect(clean).not.toContain('<embed');
    expect(clean).toContain('text');
  });

  it('strips meta refresh navigation', () => {
    const html =
      '<html><head><meta http-equiv="refresh" content="0;url=https://evil.example/"></head><body>x</body></html>';
    const clean = sanitizeEpubHtml(html);
    expect(clean).not.toContain('refresh');
    expect(clean).not.toContain('evil.example/"></head>');
  });

  it('defeats tag reassembly across removals', () => {
    const variants = [
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<script<script>>alert(1)</script>',
      '<<script>alert(1)//<</script>',
      '<a href="jav&#x0A;ascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
    ];
    for (const html of variants) {
      const clean = sanitizeEpubHtml(`<html><head></head><body>${html}</body></html>`);
      expect(clean, `variant: ${html}`).not.toMatch(/<\s*script/i);
      expect(clean).not.toMatch(/alert\s*\(/);
    }
  });

  it('blocks vbscript and data:text/html URLs on link-bearing attributes', () => {
    const html = `<html><head></head><body>
      <a href="vbscript:msgbox(1)">x</a>
      <a formaction="data:text/html;base64,PHNjcmlwdD4=">y</a>
    </body></html>`;
    const clean = sanitizeEpubHtml(html);
    expect(clean).not.toContain('vbscript:');
    expect(clean).not.toContain('data:text/html');
  });

  it('gives headless documents a valid head with the CSP', () => {
    const clean = sanitizeEpubHtml('<p>no head</p>');
    expect(clean).toContain('<head>');
    expect(clean).toContain('Content-Security-Policy');
    expect(clean).toContain('<p>no head</p>');
  });

  it('still injects CSP for documents with html but no head', () => {
    const clean = sanitizeEpubHtml('<html><body>x</body></html>');
    expect(clean).toContain('<head>');
    expect(clean).toContain('Content-Security-Policy');
  });
});

describe('sanitizeEpubHtml hardening', () => {
  it('discards an author CSP and always installs the restrictive one', () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src * data: blob: 'unsafe-inline'"/></head><body>text</body></html>`;
    const clean = sanitizeEpubHtml(html);
    expect(clean.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(clean).toContain("default-src 'none'");
    expect(clean).not.toContain('default-src *');
  });

  it('strips SVG scripts and namespaced handlers', () => {
    const clean = sanitizeEpubHtml(
      '<html><body><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle onmouseover="alert(3)"/></svg></body></html>',
    );
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('onmouseover');
  });

  it('removes entity-obfuscated script URLs and srcdoc', () => {
    const clean = sanitizeEpubHtml(
      '<html><body><a href="java&#115;cript:alert(1)">x</a><iframe srcdoc="<script>alert(2)</script>"></iframe></body></html>',
    );
    expect(clean.toLowerCase()).not.toContain('javascript:');
    expect(clean).not.toContain('srcdoc');
  });
});

describe('isSanitizableMediaType', () => {
  it('normalizes parameters and casing, including SVG', () => {
    expect(isSanitizableMediaType('application/xhtml+xml; charset=utf-8')).toBe(true);
    expect(isSanitizableMediaType('TEXT/HTML')).toBe(true);
    expect(isSanitizableMediaType('image/svg+xml')).toBe(true);
    expect(isSanitizableMediaType('text/css')).toBe(false);
    expect(isSanitizableMediaType(null)).toBe(false);
  });
});
