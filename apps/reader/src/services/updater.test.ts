import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, check } = vi.hoisted(() => ({
  invoke: vi.fn(),
  check: vi.fn(),
}));

vi.mock('./dataStore', () => ({ isTauriRuntime: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.0.0' }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

import { checkForUpdate, installUpdate } from './updater';

const PROXY = 'socks5h://127.0.0.1:2080';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('updater proxy', () => {
  it('passes the app-level proxy to the Tauri updater check', async () => {
    localStorage.setItem('hamesh.network.proxy', PROXY);
    invoke.mockResolvedValue('appimage');
    check.mockResolvedValue(null);

    await expect(checkForUpdate()).resolves.toEqual({ status: 'current' });
    expect(check).toHaveBeenCalledWith({ proxy: PROXY });
  });

  it('passes the proxy when reading latest.json on deb installs', async () => {
    localStorage.setItem('hamesh.network.proxy', PROXY);
    const body = Array.from(
      new TextEncoder().encode(JSON.stringify({ version: '9.9.9', notes: null })),
    );
    invoke.mockImplementation(async (command: string) => {
      if (command === 'install_kind') return 'deb';
      if (command === 'http_request') return { status: 200, body };
      return null;
    });

    await expect(checkForUpdate()).resolves.toMatchObject({
      status: 'available',
      version: '9.9.9',
    });
    expect(invoke).toHaveBeenCalledWith('http_request', expect.objectContaining({ proxy: PROXY }));
  });

  it('hands the proxy to the deb installer', async () => {
    localStorage.setItem('hamesh.network.proxy', PROXY);
    invoke.mockImplementation(async (command: string) => {
      if (command === 'install_kind') return 'deb';
      return null;
    });

    await installUpdate('9.9.9');
    expect(invoke).toHaveBeenCalledWith(
      'install_deb_update',
      expect.objectContaining({ proxy: PROXY }),
    );
  });
});
