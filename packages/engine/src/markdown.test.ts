import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importBook } from './import';
import {
  convertMarkdownToEpub,
  detectMarkdownDirection,
  isMarkdownFile,
  markdownTitle,
  stripFrontMatter,
} from './markdown';

const makeMdFile = (content: string, name = 'notes.md'): File =>
  new File([content], name, { type: 'text/markdown' });

describe('isMarkdownFile', () => {
  it('detects markdown by type and extension', () => {
    expect(isMarkdownFile(new File([], 'a.md', { type: 'text/plain' }))).toBe(true);
    expect(isMarkdownFile(new File([], 'a.markdown', { type: '' }))).toBe(true);
    expect(isMarkdownFile(new File([], 'a.txt', { type: 'text/markdown' }))).toBe(true);
    expect(isMarkdownFile(new File([], 'a.epub', { type: 'application/epub+zip' }))).toBe(false);
    expect(isMarkdownFile(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
  });
});

describe('detectMarkdownDirection', () => {
  it('maps Persian text to rtl and Latin text to ltr', () => {
    expect(detectMarkdownDirection('# سلام\n\nاین یک آزمون است.')).toBe('rtl');
    expect(detectMarkdownDirection('# Hello\n\nWorld.')).toBe('ltr');
  });

  it('uses the first strong character, ignoring punctuation and digits', () => {
    expect(detectMarkdownDirection('---\ntitle: x\n---\n\nسلام')).toBe('rtl');
    expect(detectMarkdownDirection('۱۲۳ then English')).toBe('ltr');
  });
});

describe('markdownTitle', () => {
  it('takes the first level-1 heading and falls back to the filename', () => {
    expect(markdownTitle('# کتاب من\n\n## فصل', 'fallback')).toBe('کتاب من');
    expect(markdownTitle('no heading here', 'notes')).toBe('notes');
  });
});

describe('stripFrontMatter', () => {
  it('splits a YAML block and reads its title', () => {
    const { body, title } = stripFrontMatter('---\ntitle: "دفترچه"\n---\n\nمتن');
    expect(body).toBe('متن');
    expect(title).toBe('دفترچه');
  });

  it('leaves files without front matter untouched', () => {
    expect(stripFrontMatter('# فقط متن')).toEqual({ body: '# فقط متن', title: null });
  });
});

describe('convertMarkdownToEpub', () => {
  it('produces a conformant EPUB with sanitized XHTML content', async () => {
    const file = await convertMarkdownToEpub(
      makeMdFile('# کتاب من\n\nمتن با **پررنگ**.\n\n<script>alert(1)</script>\n\nسطر  \nجدید'),
    );

    expect(file.type).toBe('application/epub+zip');
    expect(file.name).toBe('notes.epub');

    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const names = Object.keys(entries);
    // mimetype is the first entry, stored uncompressed per the OCF spec.
    expect(names[0]).toBe('mimetype');
    expect(new TextDecoder().decode(entries.mimetype ?? new Uint8Array())).toBe(
      'application/epub+zip',
    );
    expect(names).toContain('META-INF/container.xml');
    expect(names).toContain('OEBPS/content.opf');
    expect(names).toContain('OEBPS/index.xhtml');

    const xhtml = new TextDecoder().decode(entries['OEBPS/index.xhtml']);
    expect(xhtml).toContain('dir="rtl"');
    expect(xhtml).toContain('پررنگ');
    expect(xhtml).not.toContain('<script');
    // XML serialization closes void elements.
    expect(xhtml).toMatch(/<br\s*\/>/);

    // The generated document must be well-formed XML for the EPUB parser.
    const dom = new DOMParser().parseFromString(xhtml, 'application/xml');
    expect(dom.querySelector('parsererror')).toBeNull();

    const opf = new TextDecoder().decode(entries['OEBPS/content.opf']);
    expect(opf).toContain('page-progression-direction="rtl"');
    expect(opf).toContain('<dc:title>کتاب من</dc:title>');
  });

  it('marks LTR content without a page progression override', async () => {
    const file = await convertMarkdownToEpub(makeMdFile('# English\n\nPlain text.'));
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const opf = new TextDecoder().decode(entries['OEBPS/content.opf']);
    expect(opf).not.toContain('page-progression-direction');
    const xhtml = new TextDecoder().decode(entries['OEBPS/index.xhtml']);
    expect(xhtml).toContain('dir="ltr"');
  });
});

describe('importBook with markdown', () => {
  it('routes markdown through the EPUB converter and reads its metadata', async () => {
    const result = await importBook(makeMdFile('# عنوان آزمون\n\nمتن کتاب.', 'دفترچه.md'));
    expect(result.metadata.format).toBe('epub');
    expect(result.metadata.title).toBe('عنوان آزمون');
    expect(result.metadata.direction).toBe('rtl');
    expect(result.cover).toBeNull();
  });

  it('converts the same file to byte-identical EPUBs (sync identity)', async () => {
    const content = '# عنوان\n\nمتن مشترک.';
    const first = await convertMarkdownToEpub(makeMdFile(content, 'a.md'));
    // Convert twice on differently named files: identical bytes are what makes
    // two devices agree on one book hash for one Markdown file.
    const second = await convertMarkdownToEpub(makeMdFile(content, 'copy.md'));
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const secondBytes = new Uint8Array(await second.arrayBuffer());
    expect(firstBytes.length).toBe(secondBytes.length);
    expect(Buffer.from(firstBytes).equals(Buffer.from(secondBytes))).toBe(true);

    const importedFirst = await importBook(makeMdFile(content, 'a.md'));
    const importedSecond = await importBook(makeMdFile(content, 'a.md'));
    expect(importedFirst.metadata.hash).toBe(importedSecond.metadata.hash);
  });
});
