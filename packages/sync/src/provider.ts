/**
 * Transport contract for user-owned storage. Everything above this interface
 * (layout, wire envelopes, merge policy, orchestration) is provider-agnostic.
 * A new backend implements this and passes the shared conformance suite.
 */

export type ProviderErrorCode = 'AUTH_FAILED' | 'NOT_FOUND' | 'NETWORK' | 'CONFLICT' | 'UNKNOWN';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(message: string, code: ProviderErrorCode = 'UNKNOWN', status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

export interface ProviderCapabilities {
  etag: boolean;
  atomicRename: boolean;
  streaming: boolean;
  mkdirs: boolean;
  rangeRequests: boolean;
}

export interface ProviderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: string;
}

export interface ProviderHead {
  size?: number;
  etag?: string;
}

export interface StorageProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  readText(path: string): Promise<string | null>;
  readBinary(path: string): Promise<ArrayBuffer | null>;
  head(path: string): Promise<ProviderHead | null>;
  list(path: string): Promise<ProviderEntry[]>;

  writeText(path: string, body: string): Promise<void>;
  /**
   * Conditional write (ADR-0006): when an etag is given it must match the
   * current object (`If-Match`); a null etag means create-only
   * (`If-None-Match: *`). Returns 'conflict' on a precondition failure so the
   * caller can re-read, re-merge, and retry.
   */
  writeTextConditional?(
    path: string,
    body: string,
    etag: string | null,
  ): Promise<'ok' | 'conflict'>;
  writeBinary(path: string, body: ArrayBuffer): Promise<void>;
  ensureDir(paths: string[]): Promise<void>;
  deleteDir(path: string): Promise<void>;

  uploadStream?(path: string, localPath: string): Promise<boolean>;
  downloadStream?(path: string, localPath: string): Promise<boolean>;
}
