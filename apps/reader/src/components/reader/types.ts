/** Shared reader-view types for the extracted panel components. */
export interface SelectionInfo {
  x: number;
  y: number;
  cfi: string;
  text: string;
  fraction: number;
}

export interface SearchResult {
  cfi: string;
  label: string;
  pre: string;
  match: string;
  post: string;
}
