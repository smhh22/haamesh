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

  export interface FoliateBook {
    metadata?: FoliateMetadata;
    dir?: 'ltr' | 'rtl' | 'default' | null;
    sections?: unknown[];
    toc?: unknown[];
    transformTarget?: EventTarget;
    getCover(): Promise<Blob | null>;
    destroy(): void;
  }

  export function makeBook(file: File | Blob): Promise<FoliateBook>;
}
