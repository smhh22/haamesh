import type { BookRecord } from '@hamesh/storage';
import type { TFunction } from 'i18next';
import type { UiLocale } from '../stores/uiStore';

/** Shared display helpers for the library layouts (grid and catalog). */

export const formatAuthorList = (authors: string[], locale: UiLocale): string => {
  if (authors.length === 0) return '';
  try {
    return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(authors);
  } catch {
    return authors.join(locale === 'fa' ? '، ' : ', ');
  }
};

export type PrimaryActionKey = 'library.read' | 'library.listen' | 'library.watch';

export const primaryActionKey = (format: BookRecord['format']): PrimaryActionKey =>
  format === 'audio' ? 'library.listen' : format === 'video' ? 'library.watch' : 'library.read';

/** Label while a book opens or downloads; the steady label otherwise. */
export const primaryActionLabel = (
  book: BookRecord,
  t: TFunction,
  opening: boolean,
  hasFile: boolean,
): string => {
  if (opening) return hasFile ? t('library.opening') : t('library.downloading');
  return t(primaryActionKey(book.format));
};
