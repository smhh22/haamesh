/**
 * Ports for operating-system capabilities. The Tauri shell and the web build
 * each provide one adapter; business logic depends only on these interfaces.
 * Written to stay compatible with Android's Storage Access Framework.
 */

export type OsPlatform = 'linux' | 'windows' | 'android' | 'web';

export interface FileSystemPort {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
}

export interface KeychainPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DialogPort {
  pickFile(options?: { extensions?: string[] }): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
}

export interface LoggerPort {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface DeviceInfoPort {
  platform: OsPlatform;
  deviceId: string;
}

export interface Platform {
  fs: FileSystemPort;
  keychain: KeychainPort;
  dialogs: DialogPort;
  logger: LoggerPort;
  device: DeviceInfoPort;
}
