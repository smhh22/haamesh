/**
 * Tap-to-translate (ADR-0016): DOM helpers for the inline translation block
 * that appears below a tapped paragraph. The block lives inside the book
 * document, so it is marked and made non-selectable: selections (and therefore
 * CFIs and highlights) must never include content that is not in the book.
 */

export const TRANSLATION_BLOCK_ATTR = 'data-hamesh-translation';
const TRANSLATION_TEXT_ATTR = 'data-hamesh-translation-text';
const TRANSLATION_COPY_ATTR = 'data-hamesh-copy';

/** Innermost block-level candidates. `div` is excluded: it can be a whole page. */
const BLOCK_SELECTOR = 'p, li, dd, dt, blockquote, figcaption, pre, h1, h2, h3, h4, h5, h6';

/** Taps on these elements are navigation/controls, not translation requests. */
const IGNORED_SELECTOR =
  'a, img, svg, video, audio, iframe, input, button, select, textarea, [data-hamesh-translation]';

export interface TranslationBlockLabels {
  /** Shown between insertion and the result, e.g. "Translating…". */
  loading: string;
  /** Heading once the result arrives, e.g. "Translation". */
  heading: string;
  /** Copy button label. */
  copy: string;
}

export interface TranslationPlacement {
  /** Target language tag (BCP 47), also used for the block's `lang`. */
  lang: string;
  dir: 'ltr' | 'rtl';
  labels: TranslationBlockLabels;
}

/**
 * Cross-realm element check. Event targets from a book iframe belong to that
 * iframe's realm, so `target instanceof Element` is false in the app realm.
 */
export const asDomElement = (target: EventTarget | null): Element | null => {
  if (!target) return null;
  const candidate = target as Element;
  return typeof candidate.closest === 'function' ? candidate : null;
};

/**
 * Innermost translatable block for a tap target, or null when the tap is a
 * link, media, control, our own block, or empty space.
 */
export const findTranslatableBlock = (target: EventTarget | null): HTMLElement | null => {
  const element = asDomElement(target);
  if (!element) return null;
  if (element.closest(IGNORED_SELECTOR)) return null;
  const block = element.closest<HTMLElement>(BLOCK_SELECTOR);
  if (!block) return null;
  return block.textContent?.trim() ? block : null;
};

/** The translation block already attached below (or inside) `block`, if any. */
export const findAttachedTranslation = (block: HTMLElement): HTMLElement | null => {
  for (const child of Array.from(block.children)) {
    if (child.hasAttribute(TRANSLATION_BLOCK_ATTR)) return child as HTMLElement;
  }
  const sibling = block.nextElementSibling as HTMLElement | null;
  // No `instanceof HTMLElement`: in a book iframe the sibling belongs to the
  // iframe's realm and would fail the check.
  return sibling?.hasAttribute(TRANSLATION_BLOCK_ATTR) ? sibling : null;
};

/** True when the tap landed on the block's Copy button. */
export const isCopyTarget = (target: EventTarget | null): boolean =>
  Boolean(asDomElement(target)?.closest(`[${TRANSLATION_COPY_ATTR}]`));

/** The translation block containing a tap target, if any. */
export const translationBlockAt = (target: EventTarget | null): HTMLElement | null =>
  asDomElement(target)?.closest<HTMLElement>(`[${TRANSLATION_BLOCK_ATTR}]`) ?? null;

/** Text stored on the block for the Copy button (kept out of the DOM text). */
export const translationText = (block: HTMLElement): string =>
  block.getAttribute(TRANSLATION_TEXT_ATTR) ?? '';

/**
 * Insert a loading block right after `block`. `lang`/`dir` are set up front so
 * the result renders in its own direction, even inside an opposite-direction
 * book.
 */
export const createTranslationBlock = (
  block: HTMLElement,
  placement: TranslationPlacement,
): HTMLElement => {
  const doc = block.ownerDocument;
  const aside = doc.createElement('aside');
  aside.className = 'hamesh-translation';
  aside.setAttribute(TRANSLATION_BLOCK_ATTR, '');
  aside.setAttribute('role', 'note');
  aside.setAttribute('lang', placement.lang);
  aside.setAttribute('dir', placement.dir);
  aside.setAttribute('aria-live', 'polite');

  const head = doc.createElement('div');
  head.className = 'hamesh-translation-head';
  const label = doc.createElement('span');
  label.className = 'hamesh-translation-label';
  label.textContent = placement.labels.heading;
  const provider = doc.createElement('span');
  provider.className = 'hamesh-translation-provider';
  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.className = 'hamesh-translation-copy';
  copy.setAttribute(TRANSLATION_COPY_ATTR, '');
  copy.textContent = placement.labels.copy;
  copy.hidden = true;
  head.append(label, provider, copy);

  const body = doc.createElement('div');
  body.className = 'hamesh-translation-text';
  body.textContent = placement.labels.loading;

  aside.append(head, body);
  // `aside` is not allowed as a direct child of a list; keep it inside the
  // item and let it inherit the item's indentation.
  if (block.localName === 'li' || block.localName === 'dd') block.append(aside);
  else block.after(aside);
  return aside;
};

export interface TranslationResult {
  text: string;
  /** Provider name shown next to the heading. */
  provider: string;
}

/** Fill a placed block with the successful result. */
export const fillTranslationBlock = (block: HTMLElement, result: TranslationResult): void => {
  const provider = block.querySelector<HTMLElement>('.hamesh-translation-provider');
  if (provider) provider.textContent = result.provider;
  const copy = block.querySelector<HTMLButtonElement>('.hamesh-translation-copy');
  if (copy) copy.hidden = false;
  const body = block.querySelector<HTMLElement>('.hamesh-translation-text');
  if (body) body.textContent = result.text;
  block.setAttribute(TRANSLATION_TEXT_ATTR, result.text);
  block.classList.remove('is-error');
};

/** Replace the loading state with a localized error message. */
export const fillTranslationBlockError = (block: HTMLElement, message: string): void => {
  const body = block.querySelector<HTMLElement>('.hamesh-translation-text');
  if (body) body.textContent = message;
  block.classList.add('is-error');
};

export const removeTranslationBlock = (block: HTMLElement): void => {
  block.remove();
};
