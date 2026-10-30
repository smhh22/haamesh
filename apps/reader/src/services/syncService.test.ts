import { describe, expect, it } from 'vitest';
import { isProviderConfigured, newProvider, SYNCTHING_PRESET, WEBDAV_PRESETS } from './syncService';

describe('isProviderConfigured', () => {
  it('requires the minimum details for each provider kind', () => {
    const webdav = newProvider('webdav');
    expect(isProviderConfigured(webdav)).toBe(false);
    expect(isProviderConfigured({ ...webdav, baseUrl: 'https://dav.example.com' })).toBe(true);

    const local = newProvider('local-folder');
    expect(isProviderConfigured(local)).toBe(false);
    expect(isProviderConfigured({ ...local, localFolder: '/tmp/hamesh-sync' })).toBe(true);

    const dropbox = newProvider('dropbox');
    expect(isProviderConfigured(dropbox)).toBe(false);
    expect(
      isProviderConfigured({
        ...dropbox,
        appKey: 'key',
        hasAppSecret: true,
        hasRefreshToken: true,
      }),
    ).toBe(true);
    expect(isProviderConfigured({ ...dropbox, appKey: 'key', hasAppSecret: true })).toBe(false);

    const sftp = newProvider('sftp');
    expect(isProviderConfigured(sftp)).toBe(false);
    expect(
      isProviderConfigured({ ...sftp, baseUrl: 'host', username: 'u', hasPassword: true }),
    ).toBe(true);
    expect(isProviderConfigured({ ...sftp, baseUrl: 'host', username: 'u' })).toBe(false);

    const s3 = newProvider('s3');
    expect(isProviderConfigured(s3)).toBe(false);
    expect(isProviderConfigured({ ...s3, endpoint: 'https://s3.example.com', bucket: 'b' })).toBe(
      false,
    );
    expect(
      isProviderConfigured({
        ...s3,
        endpoint: 'https://s3.example.com',
        bucket: 'b',
        accessKeyId: 'AKID',
      }),
    ).toBe(false);
    expect(
      isProviderConfigured({
        ...s3,
        endpoint: 'https://s3.example.com',
        bucket: 'b',
        accessKeyId: 'AKID',
        hasSecretKey: true,
      }),
    ).toBe(true);
    expect(
      isProviderConfigured({
        ...s3,
        endpoint: 'https://s3.example.com',
        bucket: 'b',
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
      }),
    ).toBe(true);
  });
});

describe('provider presets', () => {
  it('applies overrides for the Syncthing preset', () => {
    const provider = newProvider('local-folder', { preset: SYNCTHING_PRESET });
    expect(provider.kind).toBe('local-folder');
    expect(provider.preset).toBe('syncthing');
  });

  it('carries a URL pattern for every WebDAV preset', () => {
    expect(WEBDAV_PRESETS.length).toBeGreaterThan(0);
    for (const preset of WEBDAV_PRESETS) {
      expect(preset.baseUrl.startsWith('https://')).toBe(true);
    }
  });
});
