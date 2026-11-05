// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createTranslationBlock,
  fillTranslationBlock,
  fillTranslationBlockError,
  findAttachedTranslation,
  findTranslatableBlock,
  isCopyTarget,
  removeTranslationBlock,
  TRANSLATION_BLOCK_ATTR,
  translationBlockAt,
  translationText,
} from './tapTranslation';

const buildDoc = (html: string): Document => {
  const doc = document.implementation.createHTMLDocument('chapter');
  doc.body.innerHTML = html;
  return doc;
};

const labels = { loading: 'Translating…', heading: 'Translation', copy: 'Copy' };

describe('findTranslatableBlock', () => {
  it('returns the innermost paragraph around the tapped node', () => {
    const doc = buildDoc('<div><p><em>hello</em> world</p></div>');
    const target = doc.querySelector('em');
    expect(findTranslatableBlock(target)).toBe(doc.querySelector('p'));
  });

  it('prefers a paragraph inside a list item over the item itself', () => {
    const doc = buildDoc('<ul><li><p>first</p></li></ul>');
    expect(findTranslatableBlock(doc.querySelector('p'))).toBe(doc.querySelector('p'));
  });

  it('ignores links, media, controls, and empty blocks', () => {
    const doc = buildDoc(
      '<p><a href="#n">note</a></p><p><img alt=""></p><p>   </p><button>go</button>',
    );
    expect(findTranslatableBlock(doc.querySelector('a'))).toBeNull();
    expect(findTranslatableBlock(doc.querySelector('img'))).toBeNull();
    expect(findTranslatableBlock(doc.querySelectorAll('p')[2] ?? null)).toBeNull();
    expect(findTranslatableBlock(doc.querySelector('button'))).toBeNull();
  });

  it('ignores taps inside an existing translation block', () => {
    const doc = buildDoc('<p>source</p>');
    const paragraph = doc.querySelector('p') as HTMLElement;
    const block = createTranslationBlock(paragraph, { lang: 'fa', dir: 'rtl', labels });
    expect(findTranslatableBlock(block)).toBeNull();
  });
});

describe('translation block lifecycle', () => {
  it('inserts a loading block after the paragraph with direction and language', () => {
    const doc = buildDoc('<p>source</p>');
    const paragraph = doc.querySelector('p') as HTMLElement;
    const block = createTranslationBlock(paragraph, { lang: 'fa', dir: 'rtl', labels });

    expect(paragraph.nextElementSibling).toBe(block);
    expect(block.getAttribute(TRANSLATION_BLOCK_ATTR)).toBe('');
    expect(block.getAttribute('lang')).toBe('fa');
    expect(block.getAttribute('dir')).toBe('rtl');
    expect(block.querySelector('.hamesh-translation-text')?.textContent).toBe('Translating…');
    expect(block.querySelector<HTMLButtonElement>('.hamesh-translation-copy')?.hidden).toBe(true);
    expect(findAttachedTranslation(paragraph)).toBe(block);
    expect(translationBlockAt(block.querySelector('.hamesh-translation-text'))).toBe(block);
  });

  it('fills the result, exposes the copy target, and drops the loading state', () => {
    const doc = buildDoc('<p>source</p>');
    const paragraph = doc.querySelector('p') as HTMLElement;
    const block = createTranslationBlock(paragraph, { lang: 'fa', dir: 'rtl', labels });

    fillTranslationBlock(block, { text: 'ترجمه', provider: 'MyMemory' });

    expect(block.querySelector('.hamesh-translation-text')?.textContent).toBe('ترجمه');
    expect(block.querySelector('.hamesh-translation-provider')?.textContent).toBe('MyMemory');
    const copy = block.querySelector<HTMLButtonElement>('.hamesh-translation-copy');
    expect(copy?.hidden).toBe(false);
    expect(isCopyTarget(copy)).toBe(true);
    expect(translationText(block)).toBe('ترجمه');
  });

  it('marks the block when the provider fails', () => {
    const doc = buildDoc('<p>source</p>');
    const block = createTranslationBlock(doc.querySelector('p') as HTMLElement, {
      lang: 'en',
      dir: 'ltr',
      labels,
    });
    fillTranslationBlockError(block, 'Could not reach the provider.');
    expect(block.classList.contains('is-error')).toBe(true);
    expect(block.querySelector('.hamesh-translation-text')?.textContent).toBe(
      'Could not reach the provider.',
    );
  });

  it('places the block inside a list item so the list stays valid', () => {
    const doc = buildDoc('<ul><li>item text</li></ul>');
    const item = doc.querySelector('li') as HTMLElement;
    const block = createTranslationBlock(item, { lang: 'fa', dir: 'rtl', labels });

    expect(item.lastElementChild).toBe(block);
    expect(doc.querySelector('ul')?.children).toHaveLength(1);
    expect(findAttachedTranslation(item)).toBe(block);
  });

  it('removes the block without touching the paragraph', () => {
    const doc = buildDoc('<p>source</p>');
    const paragraph = doc.querySelector('p') as HTMLElement;
    const block = createTranslationBlock(paragraph, { lang: 'fa', dir: 'rtl', labels });
    removeTranslationBlock(block);
    expect(paragraph.isConnected).toBe(true);
    expect(findAttachedTranslation(paragraph)).toBeNull();
  });
});
