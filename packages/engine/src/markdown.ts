import { strToU8, zipSync } from 'fflate';
import { marked } from 'marked';
import { sha256Hex } from './hash';
import { sanitizeEpubHtml } from './sanitize';

const EPUB_MIME = 'application/epub+zip';

export const isMarkdownFile = (file: File): boolean =>
  file.type === 'text/markdown' ||
  file.type === 'text/x-markdown' ||
  /\.(md|markdown)$/i.test(file.name);

// A leading YAML front-matter block is metadata, not book content.
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface StrippedMarkdown {
  body: string;
  /** A `title:` key in the front matter, if present. */
  title: string | null;
}

export const stripFrontMatter = (markdown: string): StrippedMarkdown => {
  const match = FRONT_MATTER.exec(markdown);
  if (!match) return { body: markdown, title: null };
  const titleLine = match[1]?.split(/\r?\n/).find((line) => /^title:\s*\S/.test(line));
  const title = titleLine
    ? (/^title:\s*(.+)$/.exec(titleLine)?.[1] ?? '').trim().replace(/^["']|["']$/g, '') || null
    : null;
  return { body: markdown.slice(match[0].length).replace(/^\r?\n+/, ''), title };
};

// The first strong directional character decides the text direction; Persian
// and Arabic letters map to RTL. Digits (Arabic-Indic or Latin) and punctuation
// are weak and must not decide; only letter blocks are listed. Scanning a
// prefix is enough and keeps very large files cheap.
const RTL_CHAR =
  /[\u0590-\u05FF\u0620-\u064A\u066E-\u06D3\u0710-\u072F\u0780-\u07BF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

export const detectMarkdownDirection = (markdown: string): 'rtl' | 'ltr' => {
  // Front-matter keys are usually Latin; judge direction by the content only.
  const { body } = stripFrontMatter(markdown);
  for (const char of body.slice(0, 2000)) {
    if (RTL_CHAR.test(char)) return 'rtl';
    if (LTR_CHAR.test(char)) return 'ltr';
  }
  return 'ltr';
};

/** The first level-1 heading is the book title; the filename is the fallback. */
export const markdownTitle = (markdown: string, fallback: string): string => {
  const tokens = marked.lexer(markdown);
  const heading = tokens.find((token) => token.type === 'heading' && token.depth === 1);
  if (heading && 'text' in heading && typeof heading.text === 'string') {
    const title = heading.text.trim();
    if (title) return title;
  }
  return fallback;
};

const XML_ESCAPE = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * Convert a Markdown file into a single-chapter EPUB so the reader, search,
 * notes, and sync all work on it without special cases. Rendered Markdown is
 * sanitized, serialized as XHTML through the DOM (which closes void elements
 * and escapes attributes for XML), and zipped with fflate; the mimetype entry
 * is stored first and uncompressed per the OCF spec.
 *
 * The conversion is deterministic: the identifier derives from the file's
 * SHA-256 and every timestamp and zip field is fixed, so the same Markdown
 * yields byte-identical EPUBs on every device. Without this, two devices
 * importing the same file would register two different books in sync
 * (the book identity is the SHA-256 of the file bytes).
 */
export const convertMarkdownToEpub = async (file: File): Promise<File> => {
  const bytes = Uint8Array.from(new Uint8Array(await file.arrayBuffer()));
  const markdown = new TextDecoder().decode(bytes);
  const digest = await sha256Hex(bytes);
  const { body, title: frontTitle } = stripFrontMatter(markdown);
  const direction = detectMarkdownDirection(body);
  const fallback = (frontTitle ?? file.name.replace(/\.(md|markdown)$/i, '')) || 'Untitled';
  const title = markdownTitle(body, fallback);
  const html = marked.parse(body, { async: false });

  // Sanitize as HTML, then reserialize the document through XMLSerializer so
  // the result is well-formed XML: void elements close, attributes escape,
  // and the XHTML namespace is explicit.
  const parsed = new DOMParser().parseFromString(sanitizeEpubHtml(html), 'text/html');
  // The sanitizer's XML serialization carries an explicit xmlns; XMLSerializer
  // re-adds the namespace, and keeping both produces a duplicate attribute.
  parsed.documentElement.removeAttribute('xmlns');
  parsed.documentElement.setAttribute('dir', direction);
  parsed.title = title;
  const link = parsed.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('type', 'text/css');
  link.setAttribute('href', 'style.css');
  parsed.head.append(link);
  const docXml = new XMLSerializer().serializeToString(parsed.documentElement);
  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
${docXml}`;

  // A UUID-shaped identifier derived from the content hash keeps the EPUB
  // deterministic while remaining a valid urn:uuid for EPUB validators.
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="und">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:uuid:${uuid}</dc:identifier>
<dc:title>${XML_ESCAPE(title)}</dc:title>
<dc:language>und</dc:language>
<meta property="dcterms:modified">1970-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="content" href="index.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
</manifest>
<spine${direction === 'rtl' ? ' page-progression-direction="rtl"' : ''}>
<itemref idref="content"/>
</spine>
</package>`;

  const css = `body { margin-block: 0; }
h1, h2, h3 { line-height: 1.3; }
pre, code { font-family: monospace; }
img { max-inline-size: 100%; block-size: auto; }
blockquote { margin-inline: 0; padding-inline-start: 1rem; }`;

  // Fixed mtimes keep the zip bytes stable across runs and devices. The DOS
  // date format in zips cannot represent 1970, so use its earliest year.
  const epoch = new Date(Date.UTC(1980, 0, 1));
  const zip = zipSync(
    {
      // mimetype must be the first entry and uncompressed for OCF conformance.
      mimetype: [strToU8(EPUB_MIME), { level: 0, mtime: epoch }],
      'META-INF/container.xml': [strToU8(container), { level: 6, mtime: epoch }],
      'OEBPS/content.opf': [strToU8(opf), { level: 6, mtime: epoch }],
      'OEBPS/index.xhtml': [strToU8(xhtml), { level: 6, mtime: epoch }],
      'OEBPS/style.css': [strToU8(css), { level: 6, mtime: epoch }],
    },
    { level: 6 },
  );

  const name = `${file.name.replace(/\.(md|markdown)$/i, '') || 'book'}.epub`;
  return new File([zip], name, { type: EPUB_MIME });
};
