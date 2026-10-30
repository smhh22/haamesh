import { strToU8, zipSync } from 'fflate';

export interface TestEpubOptions {
  title?: string;
  author?: string;
  language?: string;
  pageProgression?: 'ltr' | 'rtl';
  /** Omit dir from the XHTML: simulates real-world books without a base direction. */
  omitDir?: boolean;
}

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4xoAAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
);

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** Build a small, valid EPUB 3 file in memory for tests and fixtures. */
export const createTestEpub = (options: TestEpubOptions = {}): Uint8Array<ArrayBuffer> => {
  const title = escapeXml(options.title ?? 'نمونه کتاب');
  const author = escapeXml(options.author ?? 'نویسنده آزمون');
  const language = escapeXml(options.language ?? 'fa');
  const progression = options.pageProgression ?? 'rtl';

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:hamesh-test-book</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${language}</dc:language>
    <dc:creator>${author}</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="${progression}">
    <itemref idref="chap1"/>
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>فهرست</title></head>
  <body>
    <nav epub:type="toc"><ol><li><a href="chapter1.xhtml">فصل یک</a></li></ol></nav>
  </body>
</html>`;

  const paragraphs = Array.from(
    { length: 60 },
    (_, index) =>
      `<p>این پاراگراف شمارهٔ ${index + 1} برای آزمون صفحه‌بندی است. ${'متن نمونه برای خواندن. '.repeat(12)}</p>`,
  ).join('\n');

  const dirAttribute = options.omitDir ? '' : ` dir="${progression}"`;
  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"${dirAttribute} lang="${language}">
  <head><title>فصل یک</title></head>
  <body>${paragraphs}</body>
</html>`;

  const zipped = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/chapter1.xhtml': strToU8(chapter),
    'OEBPS/cover.png': ONE_PIXEL_PNG,
  });
  const copy = new Uint8Array(new ArrayBuffer(zipped.byteLength));
  copy.set(zipped);
  return copy;
};
