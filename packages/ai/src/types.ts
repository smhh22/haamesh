/**
 * Translation provider contract (ADR-0016). Providers are pure request
 * builders over an injected fetch; no DOM, no keys, no retries here — the app
 * service owns caching, fallback order, and backoff.
 */
export type TranslationErrorCode =
  | 'AUTH'
  | 'QUOTA'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'TOO_LONG'
  | 'UNSUPPORTED_LANG'
  | 'CANCELLED'
  | 'PROVIDER_ERROR';

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  /** Raw provider detail for diagnosis; never shown as the primary message. */
  readonly detail: string | null;

  constructor(code: TranslationErrorCode, detail: string | null = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TranslationError';
    this.code = code;
    this.detail = detail;
  }
}

export interface TranslationRequest {
  text: string;
  /** BCP 47 primary tag, e.g. `fa`, `en`; `auto` lets the provider decide. */
  sourceLang: string;
  targetLang: string;
  signal?: AbortSignal;
}

export interface TranslationResult {
  text: string;
  /** Set when the provider reports what it actually detected. */
  detectedSourceLang?: string;
}

export interface TranslationCapabilities {
  /** Largest request the provider should receive; the service chunks above it. */
  maxChars: number;
  needsKey: boolean;
  /** Whether the provider's API sends CORS headers (web build usable). */
  worksInWeb: boolean;
}

export interface TranslationProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: TranslationCapabilities;
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

/** Minimal fetch surface; the app injects providerFetch(the Rust bridge) or window.fetch. */
export type FetchPort = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Human-readable language names for prompts. Falls back to the tag so an
 * unknown language never blocks a translation.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  fa: 'Persian',
  en: 'English',
  ar: 'Arabic',
  he: 'Hebrew',
  ur: 'Urdu',
  tr: 'Turkish',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
};

export const languageName = (tag: string): string =>
  LANGUAGE_NAMES[tag.split('-')[0]?.toLowerCase() ?? ''] ?? tag;

/** Map fetch/abort failures onto provider error codes consistently. */
export const mapFetchError = (error: unknown): TranslationError => {
  if (error instanceof TranslationError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') return new TranslationError('CANCELLED');
  return new TranslationError('NETWORK', error instanceof Error ? error.message : String(error));
};
