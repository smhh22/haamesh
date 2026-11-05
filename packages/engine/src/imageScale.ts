/**
 * Publisher CSS often sizes inline images (formula GIFs) in absolute px, so
 * they stop matching the text as soon as the reader scales the font. Rewrite
 * small images' computed px box in `rem` against the current root font size:
 * the image then scales exactly with `html { font-size }` — including inside
 * publisher-nested containers whose ancestors shrink `em`. Large images
 * (photos, full-width figures) keep their publisher sizing.
 *
 * Safe to run once per loaded document: in a real engine getComputedStyle
 * reports the used px size, so re-running yields the same rem values.
 */

/** Only images at most this many px in both dimensions count as inline art. */
const INLINE_IMAGE_MAX_PX = 96;

export interface ImageBox {
  width: number;
  height: number;
}

export type ImageMeasurer = (element: Element) => ImageBox | null;

/**
 * Real-engine measurer: getComputedStyle reports used px sizes for images.
 * (jsdom cannot, so tests inject their own measurer.)
 */
const computedBox =
  (doc: Document): ImageMeasurer =>
  (element) => {
    const view = doc.defaultView;
    if (!view) return null;
    const style = view.getComputedStyle(element);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { width, height };
  };

export interface ScaleImagesOptions {
  measure?: ImageMeasurer;
  /** Root font size in px; measured from the document when omitted. */
  rootFontSizePx?: number;
}

export const scaleImagesWithFont = (doc: Document, options: ScaleImagesOptions = {}): void => {
  const view = doc.defaultView;
  if (!view) return;
  const rootPx =
    options.rootFontSizePx ??
    Number.parseFloat(view.getComputedStyle(doc.documentElement).fontSize);
  if (!Number.isFinite(rootPx) || rootPx <= 0) return;
  const measure = options.measure ?? computedBox(doc);
  for (const img of doc.body.querySelectorAll('img')) {
    if (img.closest('[data-hamesh-translation]')) continue;
    const box = measure(img);
    if (
      !box ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.width > INLINE_IMAGE_MAX_PX ||
      box.height > INLINE_IMAGE_MAX_PX
    ) {
      continue;
    }
    img.style.width = `${(box.width / rootPx).toFixed(4)}rem`;
    img.style.height = `${(box.height / rootPx).toFixed(4)}rem`;
  }
};
