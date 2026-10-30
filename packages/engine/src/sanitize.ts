/**
 * Remove active content from an EPUB document before it enters the reader
 * iframe, and inject a CSP that blocks network access.
 *
 * The iframe sandbox must allow scripts for foliate-js event handling on
 * WebKit, so this sanitizer is the security control. It works on a parsed DOM
 * (not regexes, which are bypassable by reassembly and entity tricks): every
 * dangerous element is removed, event-handler and script URLs are stripped,
 * any author-supplied CSP meta is discarded so it cannot loosen ours, and our
 * restrictive CSP is always injected first in <head>.
 *
 * Document media types must be normalized by the caller; this accepts HTML,
 * XHTML, and SVG markup strings alike (HTML parsing covers SVG subtrees).
 */

const DANGEROUS_ELEMENTS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'form',
  'link',
  'meta', // re-added below only as our own charset/CSP where needed
];

const URL_ATTRIBUTES = [
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'xlink:href',
  'data',
  'poster',
  'background',
];

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src 'self' blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none';\"/>";

const NUL = String.fromCharCode(0);

/** Decoded scheme check; the DOM already decodes entities in attribute values. */
const isDangerousUrl = (value: string): boolean => {
  const compact = value
    .replace(/[\t\n\r]/g, '')
    .split(NUL)
    .join('')
    .trimStart();
  return /^(?:javascript|vbscript):/i.test(compact) || /^data:text\/html/i.test(compact);
};

const sanitizeDocument = (doc: Document): Document => {
  for (const tag of DANGEROUS_ELEMENTS) {
    for (const element of Array.from(doc.getElementsByTagName(tag))) {
      element.remove();
    }
  }
  // Namespaced variants (SVG script/meta) are not covered by getElementsByTagName
  // in every engine; a query by local name is.
  for (const element of Array.from(doc.querySelectorAll('script, iframe, object, embed'))) {
    element.remove();
  }
  // Malformed markup can produce elements whose names contain '<' (for
  // example <scr<script>), which serialize back into script-looking tags.
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    if (!/^[a-z][a-z0-9-]*$/i.test(element.localName)) element.remove();
  }

  const all = doc.getElementsByTagName('*');
  for (const element of Array.from(all)) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        attribute.ownerElement?.removeAttributeNode(attribute);
        continue;
      }
      if (name === 'srcdoc' || name === 'ping') {
        attribute.ownerElement?.removeAttributeNode(attribute);
        continue;
      }
      if (URL_ATTRIBUTES.includes(name) && isDangerousUrl(attribute.value)) {
        attribute.ownerElement?.removeAttributeNode(attribute);
      }
    }
  }

  // Our CSP goes first in head; any author meta was removed above.
  const head = doc.head ?? doc.createElement('head');
  if (!doc.head) {
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
  }
  head.insertAdjacentHTML('afterbegin', CSP_META);
  return doc;
};

/**
 * Sanitize one book document. Returns a full document string suitable for an
 * iframe srcdoc: the restrictive CSP is always present, scripts and handlers
 * are gone, and links to script URLs are stripped.
 */
export const sanitizeEpubHtml = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeDocument(doc);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
};

/**
 * Spine media types that must pass through the sanitizer. Parameters
 * (charset, profiles) and casing are ignored, and SVG documents are included
 * because they can carry script handlers.
 */
export const isSanitizableMediaType = (type: string | null | undefined): boolean => {
  const normalized = (type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    normalized === 'application/xhtml+xml' ||
    normalized === 'text/html' ||
    normalized === 'image/svg+xml'
  );
};
