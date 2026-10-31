/**
 * Desktop SFTP adapter for the sync provider. The Rust side owns the SSH
 * session (password or private key, TOFU host-key pinning, base-folder
 * validation); this module speaks paths below the configured remote base and
 * reconnects once when the server has closed a cached session.
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
  /** Folder on the server that must already exist. */
  base: string;
}

/** Open an SSH/SFTP session; the Rust side verifies the base folder. */
export const connectSftp = async (connection: SftpConnection): Promise<string> =>
  invokeFs<string>('sftp_connect', {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password || null,
    keyPath: connection.keyPath || null,
    keyPassphrase: connection.keyPassphrase || null,
    base: connection.base || null,
  });

export const disconnectSftp = async (session: string): Promise<void> => {
  if (!isTauriRuntime()) return;
  await invokeFs<null>('sftp_disconnect', { session });
};

/** Servers close idle sessions; retry once with a fresh one. */
const isClosedSession = (error: unknown): boolean =>
  /session closed|channel closed|connection (reset|closed)|broken pipe|unexpected eof|eof/i.test(
    error instanceof Error ? error.message : String(error),
  );

/** FolderFs view of the remote tree rooted at `connection.base`. */
export const createSftpFs = (connection: SftpConnection): FolderFs => {
  let session: string | null = null;
  let opening: Promise<string> | null = null;

  const open = (): Promise<string> => {
    opening ??= connectSftp(connection)
      .then((id) => {
        session = id;
        return id;
      })
      .finally(() => {
        opening = null;
      });
    return opening;
  };

  const invalidate = async (): Promise<void> => {
    const current = session;
    session = null;
    if (current) {
      try {
        await disconnectSftp(current);
      } catch {
        // The session is gone either way.
      }
    }
  };

  const call = async <T>(run: (id: string) => Promise<T>): Promise<T> => {
    const id = session ?? (await open());
    try {
      return await run(id);
    } catch (error) {
      if (!isClosedSession(error)) throw error;
      await invalidate();
      return run(await open());
    }
  };

  const base = connection.base.replace(/\/+$/, '');
  const full = (relative: string): string => {
    const clean = relative.replace(/^\/+/, '');
    return clean ? `${base}/${clean}` : base || '/';
  };

  return {
    async readFile(relative) {
      const path = full(relative);
      const data = await call((id) =>
        invokeFs<number[] | null>('sftp_read', { session: id, path }),
      );
      if (data === null) throw new Error(`ENOENT: ${relative}`);
      return new Uint8Array(data);
    },
    async writeFile(relative, data) {
      const path = full(relative);
      await call((id) =>
        invokeFs<null>('sftp_write', { session: id, path, data: Array.from(data) }),
      );
    },
    async exists(relative) {
      const path = full(relative);
      return call((id) => invokeFs<boolean>('sftp_exists', { session: id, path }));
    },
    async remove(relative) {
      const path = full(relative);
      await call((id) => invokeFs<null>('sftp_remove', { session: id, path }));
    },
    async list(relative) {
      const path = full(relative);
      return call((id) => invokeFs<string[]>('sftp_list', { session: id, path }));
    },
    async mkdir(relative) {
      const path = full(relative);
      await call((id) => invokeFs<null>('sftp_mkdir', { session: id, path }));
    },
  };
};
