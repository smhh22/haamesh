/**
 * Desktop SFTP adapter for the sync provider. The Rust side owns the SSH
 * session (password or private key, TOFU host-key pinning); this module only
 * speaks paths below the configured remote base.
 */
import type { FolderFs } from '@hamesh/sync';
import { isTauriRuntime } from './dataStore';

const invokeFs = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
};

export const isSftpAvailable = (): boolean => isTauriRuntime();

export interface SftpConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  keyPath: string;
  keyPassphrase: string;
}

/** Open an SSH/SFTP session and pin the host key on first use. */
export const connectSftp = async (connection: SftpConnection): Promise<string> =>
  invokeFs<string>('sftp_connect', {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password || null,
    keyPath: connection.keyPath || null,
    keyPassphrase: connection.keyPassphrase || null,
  });

export const disconnectSftp = async (session: string): Promise<void> => {
  if (!isTauriRuntime()) return;
  await invokeFs<null>('sftp_disconnect', { session });
};

/** FolderFs view of the remote tree rooted at `remoteBase`. */
export const createSftpFs = (session: string, remoteBase: string): FolderFs => {
  const base = remoteBase.replace(/\/+$/, '');
  const full = (relative: string): string => {
    const clean = relative.replace(/^\/+/, '');
    return clean ? `${base}/${clean}` : base || '/';
  };

  return {
    async readFile(relative) {
      const path = full(relative);
      const data = await invokeFs<number[] | null>('sftp_read', { session, path });
      if (data === null) throw new Error(`ENOENT: ${relative}`);
      return new Uint8Array(data);
    },
    async writeFile(relative, data) {
      await invokeFs<null>('sftp_write', { session, path: full(relative), data: Array.from(data) });
    },
    async exists(relative) {
      return invokeFs<boolean>('sftp_exists', { session, path: full(relative) });
    },
    async remove(relative) {
      await invokeFs<null>('sftp_remove', { session, path: full(relative) });
    },
    async list(relative) {
      return invokeFs<string[]>('sftp_list', { session, path: full(relative) });
    },
    async mkdir(relative) {
      await invokeFs<null>('sftp_mkdir', { session, path: full(relative) });
    },
  };
};
