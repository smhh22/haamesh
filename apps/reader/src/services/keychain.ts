/**
 * Credential storage. Desktop: the OS secret store through the Rust `keyring`
 * crate (Secret Service/KWallet, Credential Manager, Keychain). Web: there is
 * no OS keychain, so a localStorage fallback keeps parity with a documented
 * caveat in the sync settings.
 */
import { isTauriRuntime } from './dataStore';

const WEB_PREFIX = 'hamesh.keychain.';

/** The OS store can be unavailable (Android has none; a locked session may
 *  deny Secret Service). Fall back to localStorage for the rest of the run so
 *  sync keeps working; the settings hint documents the weaker storage. */
let osStoreUnavailable = false;

const invokeKeychain = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
};

export const keychainGet = async (key: string): Promise<string | null> => {
  if (isTauriRuntime() && !osStoreUnavailable) {
    try {
      return await invokeKeychain<string | null>('keychain_get', { key });
    } catch {
      osStoreUnavailable = true;
    }
  }
  return localStorage.getItem(WEB_PREFIX + key);
};

export const keychainSet = async (key: string, value: string): Promise<void> => {
  if (isTauriRuntime() && !osStoreUnavailable) {
    try {
      await invokeKeychain<null>('keychain_set', { key, value });
      // A previous fallback copy is redundant once the OS store works.
      localStorage.removeItem(WEB_PREFIX + key);
      return;
    } catch {
      osStoreUnavailable = true;
    }
  }
  localStorage.setItem(WEB_PREFIX + key, value);
};

export const keychainDelete = async (key: string): Promise<void> => {
  if (isTauriRuntime() && !osStoreUnavailable) {
    try {
      await invokeKeychain<null>('keychain_delete', { key });
    } catch {
      osStoreUnavailable = true;
    }
  }
  localStorage.removeItem(WEB_PREFIX + key);
};
