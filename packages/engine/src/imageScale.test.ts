// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { type ImageMeasurer, scaleImagesWithFont } from './imageScale';

const buildDoc = (bodyHtml: string, rootFontSizePx: string): Document => {
  // The helper walks the live document: created HTMLDocuments have no
  // defaultView, and the real measurer needs one.
  document.body.innerHTML = bodyHtml;
  document.documentElement.style.fontSize = rootFontSizePx;
  return document;
};

const measurePx =
  (width: number, height: number): ImageMeasurer =>
  (element) => {
    // The measurer is per-image; encode which size to report in the src.
    if (element.getAttribute('src') === 'small.gif') return { width, height };
    return null;
  };

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('font-size');
});

describe('scaleImagesWithFont', () => {
  it('rewrites small px-sized images as em against the root font size', () => {
    const doc = buildDoc('<p>text <img src="small.gif" alt=""></p>', '20px');
    scaleImagesWithFont(doc, { measure: measurePx(26, 17), rootFontSizePx: 20 });
    const img = doc.querySelector('img') as HTMLImageElement;
    expect(img.style.width).toBe('1.3rem');
    expect(img.style.height).toBe('0.85rem');
  });

  it('leaves images the measurer reports as large or unusable', () => {
    const doc = buildDoc('<img src="small.gif" alt="">', '16px');
    // A 640px "photo": above the inline-art threshold.
    scaleImagesWithFont(doc, { measure: measurePx(640, 480), rootFontSizePx: 16 });
    const img = doc.querySelector('img') as HTMLImageElement;
    expect(img.style.width).toBe('');

    // No usable box (not yet laid out): untouched.
    scaleImagesWithFont(doc, { measure: () => null, rootFontSizePx: 16 });
    expect(img.style.width).toBe('');
  });
});
