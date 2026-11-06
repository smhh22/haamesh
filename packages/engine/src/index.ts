export type { DirectionInput, PageProgression } from './direction';
export { isRtlLanguage, resolveBookDirection } from './direction';
export type { ImageMeasurer } from './imageScale';
export { scaleImagesWithFont } from './imageScale';
export type { ImportErrorCode, ImportedBook } from './import';
export {
  ImportError,
  importAudio,
  importBook,
  importEpub,
  importPdf,
  importVideo,
  isAudioFile,
  isPdfFile,
  isVideoFile,
  sha256Hex,
} from './import';
export {
  convertMarkdownToEpub,
  detectMarkdownDirection,
  isMarkdownFile,
  markdownTitle,
  markdownToFragment,
} from './markdown';
export type { PageTurn } from './navigation';
export { pageTurnForKey } from './navigation';
export type { LocatedOccurrence, PdfHighlightDraft } from './pdfHighlights';
export {
  applyPdfHighlights,
  locateOccurrence,
  PDF_OVERLAY_ID,
  pdfLocatorMatchesPage,
  pdfOccurrenceIndex,
} from './pdfHighlights';
export type { TextProfile } from './pdfLanguage';
export { profilePdfText } from './pdfLanguage';
export { isSanitizableMediaType, sanitizeEpubHtml } from './sanitize';

/** Placeholder for the foliate-js reader boundary; import is implemented. */
export interface ReaderEngine {
  open(path: string): Promise<void>;
  close(): Promise<void>;
}
export type { ExtractedBookText } from './bookText';
export { extractEpubText } from './bookText';
