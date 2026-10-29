export type { DirectionInput, PageProgression } from './direction';
export { isRtlLanguage, resolveBookDirection } from './direction';
export type { ImportErrorCode, ImportedBook } from './import';
export { ImportError, importBook, importEpub, importPdf, isPdfFile, sha256Hex } from './import';
export type { PageTurn } from './navigation';
export { pageTurnForKey } from './navigation';
export { sanitizeEpubHtml } from './sanitize';

/** Placeholder for the foliate-js reader boundary; import is implemented. */
export interface ReaderEngine {
  open(path: string): Promise<void>;
  close(): Promise<void>;
}
