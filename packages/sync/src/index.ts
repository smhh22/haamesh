/**
 * Package boundary: the transport contract, the merge core, the engine, and
 * the built-in providers. App code depends on this entry point only.
 */

export { HybridLogicalClock } from '@hamesh/core';
export type {
  SyncEngine,
  SyncKind,
  SyncOptions,
  SyncRecord,
  SyncReport,
  SyncStore,
} from './engine';
export {
  bookBlobPath,
  bookMetaPath,
  buildLocalDoc,
  createSyncEngine,
  INDEX_PATH,
  legacyTimestamp,
  REMOTE_ROOT,
} from './engine';
export type { Envelope } from './envelope';
export { makeEnvelope, mergeEnvelope } from './envelope';
export type { DeviceDoc, IndexDoc, RecordDoc } from './indexDoc';
export {
  decodeIndexDoc,
  diffPull,
  emptyIndexDoc,
  encodeIndexDoc,
  mergeAllIndexDocs,
  mergeIndexDoc,
  mergeRecordDoc,
  SCHEMA_VERSION,
  SyncError,
} from './indexDoc';
export type {
  ProviderCapabilities,
  ProviderEntry,
  ProviderErrorCode,
  ProviderHead,
  StorageProvider,
} from './provider';
export { ProviderError } from './provider';
export {
  createDropboxProvider,
  dropboxAuthorizeUrl,
  exchangeDropboxCode,
} from './providers/dropbox';
export type { FolderFs } from './providers/localFolder';
export { createLocalFolderProvider } from './providers/localFolder';
export { createMemoryProvider } from './providers/memory';
export type { S3Config } from './providers/s3';
export { createS3Provider } from './providers/s3';
export type { FetchLike, WebDavConfig } from './providers/webdav';
export { createWebDavProvider } from './providers/webdav';
