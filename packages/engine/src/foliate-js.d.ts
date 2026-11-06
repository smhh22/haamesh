declare module 'foliate-js/view.js' {
  export type FoliateContributor =
    | string
    | {
        name?: string | Record<string, string> | null;
      };

  export interface FoliateMetadata {
    identifier?: string | null;
    title?: string | Record<string, string> | null;
    language?: string | string[] | null;
    author?: FoliateContributor | FoliateContributor[] | null;
    publisher?: FoliateContributor | FoliateContributor[] | null;
    belongsTo?: { series?: unknown; collection?: unknown } | null;
  }

  export interface FoliateTocItem {
    label: string;
    href: string;
    subitems?: FoliateTocItem[] | null;
  }

  /** How the renderer presents fixed layouts (foliate-js fixed-layout.js). */
  export interface FoliateRendition {
    layout?: string;
    spread?: string;
    viewport?: unknown;
  }

  export interface FoliateBook {
    metadata?: FoliateMetadata;
    dir?: 'ltr' | 'rtl' | 'default' | null;
    sections?: Array<unknown | { createDocument?: () => Promise<Document> }>;
    toc?: FoliateTocItem[];
    rendition?: FoliateRendition;
    transformTarget?: EventTarget;
    getCover(): Promise<Blob | null>;
    destroy(): void;
  }

  export function makeBook(file: File | Blob): Promise<FoliateBook>;
}

declare module 'foliate-js/overlayer.js' {
  export class Overlayer {
    static highlight(rects: DOMRect[], options?: { color?: string }): Element;
    static outline(
      rects: DOMRect[],
      options?: { color?: string; width?: number; radius?: number },
    ): Element;
  }
}
