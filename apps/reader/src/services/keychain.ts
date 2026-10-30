/**
 * Credential storage. Desktop: the OS secret store through the Rust `keyring`
 * crate (Secret Service/KWallet, Credential Manager, Keychain). Web: there is
 * no OS keychain, so a localStorage fallback keeps parity with a documented
 * caveat in the sync settings.
 */
import { isTauriRuntime } from './dataStore';

const WEB_PREFIX = 'hamesh.keychain.';

const invokeKeychain = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
};

export const keychainGet = async (key: string): Promise<string | null> => {
  if (isTauriRuntime()) return invokeKeychain<string | null>('keychain_get', { key });
  return localStorage.getItem(WEB_PREFIX + key);
};

export const keychainSet = async (key: string, value: string): Promise<void> => {
  if (isTauriRuntime()) {
    await invokeKeychain<null>('keychain_set', { key, value });
    return;
  }
  localStorage.setItem(WEB_PREFIX + key, value);
};

export const keychainDelete = async (key: string): Promise<void> => {
  if (isTauriRuntime()) {
    await invokeKeychain<null>('keychain_delete', { key });
    return;
  }
  localStorage.removeItem(WEB_PREFIX + key);
};
