import type { Locator } from '@hamesh/core';

/** A highlight to draw on one rendered PDF page. */
export interface PdfHighlightDraft {
  id: string;
  color: string;
  /** Selected text exactly as it appears in the page's text layer. */
  text: string;
  /** Which repeat of `text` on the page this highlight anchors to (0-based). */
  occurrence: number;
}

export interface LocatedOccurrence {
  startNode: number;
  startOffset: number;
  endNode: number;
  endOffset: number;
}

/**
 * Find the `occurrence`-th appearance of `needle` inside the concatenated
 * node texts, mapped back to node indexes and offsets. PDF text layers never
 * reflow, so text anchoring survives zoom and re-render; overlays are
 * recomputed from the live DOM at draw time.
 */
export const locateOccurrence = (
  nodeTexts: string[],
  needle: string,
  occurrence: number,
): LocatedOccurrence | null => {
  if (!needle) return null;
  const full = nodeTexts.join('');
  let from = 0;
  let match = -1;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    match = full.indexOf(needle, from);
    if (match === -1) return null;
    from = match + 1;
  }
  const start = match;
  const end = start + needle.length;
  const at = (absolute: number): { node: number; offset: number } => {
    let offset = 0;
    for (let node = 0; node < nodeTexts.length; node += 1) {
      const text = nodeTexts[node];
      if (text === undefined) break;
      if (absolute < offset + text.length) {
        return { node, offset: absolute - offset };
      }
      offset += text.length;
    }
    const last = nodeTexts.length - 1;
    return { node: Math.max(0, last), offset: nodeTexts[last]?.length ?? 0 };
  };
  const from0 = at(start);
  const to = at(end);
  return {
    startNode: from0.node,
    startOffset: from0.offset,
    endNode: to.node,
    endOffset: to.offset,
  };
};

export const pdfLocatorMatchesPage = (locator: Locator, pageIndex: number): boolean =>
  locator.kind === 'pdf' && locator.page === pageIndex + 1;

/**
 * 0-based index of the occurrence the range starts in, across the layer's
 * concatenated text. Returns -1 when the text cannot be found (for example a
 * selection that leaked outside the text layer).
 */
export const pdfOccurrenceIndex = (layer: Element, range: Range, text: string): number => {
  if (!text) return -1;
  const full = pdfTextNodes(layer)
    .map((node) => node.nodeValue ?? '')
    .join('');
  const start = pdfStartIndex(layer, range);
  let occurrence = 0;
  let from = 0;
  while (from <= full.length) {
    const match = full.indexOf(text, from);
    if (match === -1 || match > start) break;
    occurrence += 1;
    from = match + 1;
  }
  return occurrence > 0 ? occurrence - 1 : -1;
};

const pdfStartIndex = (layer: Element, range: Range): number => {
  // The range's start container may be a text node or an element (for
  // selectNodeContents-style selections); walk document order and count the
  // text seen before it.
  let index = 0;
  const walker = layer.ownerDocument.createTreeWalker(
    layer,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  let current = walker.nextNode();
  while (current) {
    if (current === range.startContainer) return index + range.startOffset;
    if (current.nodeType === Node.TEXT_NODE) index += current.nodeValue?.length ?? 0;
    current = walker.nextNode();
  }
  return -1;
};

export const pdfTextNodes = (layer: Element): Text[] => {
  const nodes: Text[] = [];
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
};

export const PDF_OVERLAY_ID = 'hamesh-pdf-overlays';

/**
 * Draw translucent highlight rectangles over the page's text layer, anchored
 * to the stored text. Called after each page render (and on note changes), so
 * the overlay is rebuilt from scratch and coordinates come from the live DOM
 * (client rects are post-transform; the layer's children are pre-transform,
 * hence the devicePixelRatio factor).
 */
export const applyPdfHighlights = (doc: Document, highlights: PdfHighlightDraft[]): void => {
  const layer = doc.querySelector('.textLayer');
  const existing = doc.getElementById(PDF_OVERLAY_ID);
  if (!layer) {
    existing?.remove();
    return;
  }
  let overlay = existing;
  if (!overlay || overlay.parentElement !== layer) {
    overlay?.remove();
    overlay = doc.createElement('div');
    overlay.id = PDF_OVERLAY_ID;
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2';
    layer.appendChild(overlay);
  }
  overlay.replaceChildren();
  if (highlights.length === 0) return;

  const nodes = pdfTextNodes(layer);
  const texts = nodes.map((node) => node.nodeValue ?? '');
  const dpr = doc.defaultView?.devicePixelRatio ?? 1;
  const layerOrigin = layer.getBoundingClientRect();

  for (const highlight of highlights) {
    const located = locateOccurrence(texts, highlight.text, highlight.occurrence);
    if (!located) continue;
    const startNode = nodes[located.startNode];
    const endNode = nodes[located.endNode];
    if (!startNode || !endNode) continue;
    const range = doc.createRange();
    try {
      range.setStart(startNode, located.startOffset);
      range.setEnd(endNode, located.endOffset);
    } catch {
      continue;
    }
    for (const rect of range.getClientRects()) {
      const box = doc.createElement('div');
      box.className = 'hamesh-pdf-highlight';
      box.dataset.noteId = highlight.id;
      box.style.position = 'absolute';
      // Geometric placement from client rects (the page document has no
      // writing modes; physical offsets are the only meaningful ones here).
      box.style.setProperty('left', `${(rect.left - layerOrigin.left) * dpr}px`);
      box.style.setProperty('top', `${(rect.top - layerOrigin.top) * dpr}px`);
      box.style.setProperty('width', `${rect.width * dpr}px`);
      box.style.setProperty('height', `${rect.height * dpr}px`);
      box.style.background = highlight.color;
      box.style.opacity = '0.4';
      box.style.borderRadius = '2px';
      overlay.append(box);
    }
  }
};
