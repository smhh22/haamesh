// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyPdfHighlights, locateOccurrence } from './pdfHighlights';

describe('locateOccurrence', () => {
  const texts = ['intro ', 'target text here ', 'target text again'];

  it('finds the first occurrence across node boundaries', () => {
    // Index 6 is exactly the boundary between the two nodes; representing it
    // as the end of the previous node is equivalent for a DOM range.
    expect(locateOccurrence(texts, 'target text', 0)).toEqual({
      startNode: 1,
      startOffset: 0,
      endNode: 1,
      endOffset: 11,
    });
  });

  it('finds later occurrences across two nodes', () => {
    expect(locateOccurrence(texts, 'text again', 0)).toEqual({
      startNode: 2,
      startOffset: 7,
      endNode: 2,
      endOffset: 17,
    });
  });

  it('returns null when absent or exhausted', () => {
    expect(locateOccurrence(texts, 'missing', 0)).toBeNull();
    expect(locateOccurrence(texts, 'target text', 2)).toBeNull();
    expect(locateOccurrence(texts, '', 0)).toBeNull();
  });
});

describe('applyPdfHighlights', () => {
  const buildDoc = (): Document => {
    const doc = document.implementation.createHTMLDocument('page');
    doc.body.innerHTML = '<div class="textLayer"><span>intro </span><span>target text</span></div>';
    return doc;
  };

  const fakeRects = (rects: Array<[number, number, number, number]>) => {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      // DOMRect uses physical coordinates; the logical-property rule does not
      // apply to this geometry fixture.
      value: () =>
        rects.map(
          ([l, t, w, h]) => ({ left: l, top: t, width: w, height: h }), // logical-properties-ignore
        ) as unknown as DOMRectList,
    });
  };

  afterEach(() => {
    delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  });

  it('draws one box per client rect inside the text layer', () => {
    const doc = buildDoc();
    fakeRects([
      [10, 20, 30, 12],
      [40, 20, 15, 12],
    ]);

    applyPdfHighlights(doc, [
      { id: 'note-1', color: '#f2c94c', text: 'target text', occurrence: 0 },
    ]);

    const overlay = doc.getElementById('hamesh-pdf-overlays');
    expect(overlay?.parentElement?.classList.contains('textLayer')).toBe(true);
    expect(overlay?.children).toHaveLength(2);
    const first = overlay?.children[0] as HTMLElement;
    expect(first.dataset.noteId).toBe('note-1');
    expect(first.style.background).toContain('rgb(242, 201, 76)');
  });

  it('replaces the overlay on every call so removals disappear', () => {
    const doc = buildDoc();
    fakeRects([[0, 0, 5, 5]]);

    applyPdfHighlights(doc, [{ id: 'a', color: 'red', text: 'target text', occurrence: 0 }]);
    applyPdfHighlights(doc, [{ id: 'b', color: 'blue', text: 'target text', occurrence: 0 }]);
    applyPdfHighlights(doc, []);

    const overlay = doc.getElementById('hamesh-pdf-overlays');
    expect(overlay?.children).toHaveLength(0);
  });

  it('skips highlights whose text is not on the page', () => {
    const doc = buildDoc();
    fakeRects([[0, 0, 5, 5]]);

    applyPdfHighlights(doc, [{ id: 'x', color: 'red', text: 'not present', occurrence: 0 }]);
    expect(doc.getElementById('hamesh-pdf-overlays')?.children).toHaveLength(0);
  });
});
