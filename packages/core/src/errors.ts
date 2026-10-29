/**
 * Domain-level error codes. Libraries return these; only the app and UI layers
 * map them to user-facing, localized messages.
 */
export const ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'STORAGE_FAILURE',
  'UNSUPPORTED_FORMAT',
  'CONFLICT',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface DomainError {
  code: ErrorCode;
  detail?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
