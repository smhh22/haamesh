/** Shared reader-view types for the extracted panel components. */
export interface SelectionInfo {
  x: number;
  y: number;
  text: string;
  fraction: number;
  /** EPUB only: CFI of the selection. */
  cfi?: string;
  /** PDF only: text-anchored position inside the page's text layer. */
  pdf?: { page: number; text: string; occurrence: number };
}

export interface SearchResult {
  cfi: string;
  label: string;
  pre: string;
  match: string;
  post: string;
}
