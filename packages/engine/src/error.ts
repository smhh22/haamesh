export type ImportErrorCode =
  | 'INVALID_FILE'
  | 'UNSUPPORTED_FORMAT'
  | 'CRYPTO_UNAVAILABLE'
  | 'PARSE_FAILED';

export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImportError';
    this.code = code;
  }
}
