import { describe, expect, it } from 'vitest';
import { isProviderConfigured, newProvider } from './syncService';

describe('isProviderConfigured', () => {
  it('requires the minimum details for each provider kind', () => {
    const webdav = newProvider('webdav');
    expect(isProviderConfigured(webdav)).toBe(false);
    expect(isProviderConfigured({ ...webdav, baseUrl: 'https://dav.example.com' })).toBe(true);

    const local = newProvider('local-folder');
    expect(isProviderConfigured(local)).toBe(false);
    expect(isProviderConfigured({ ...local, localFolder: '/tmp/hamesh-sync' })).toBe(true);

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
