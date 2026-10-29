/**
 * Persian-aware search normalization shared by the library filter and
 * content full-text search: NFKC folds presentation forms, Arabic yeh/kaf
 * variants fold to their Persian shapes, and case folds for Latin text.
 */
export const normalizeForSearch = (value: string): string =>
  value.normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').toLocaleLowerCase();
