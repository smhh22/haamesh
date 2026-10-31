// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDropboxProvider } from './dropbox';
import { createLocalFolderProvider, type FolderFs } from './localFolder';
import { createS3Provider } from './s3';
import { createWebDavProvider } from './webdav';

const fetchStub = async (): Promise<Response> => new Response(null, { status: 204 });

const emptyFs: FolderFs = {
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  exists: async () => false,
  remove: async () => {},
  list: async () => [],
};

describe('provider report ids', () => {
  it('uses a supplied id and otherwise falls back to the kind', () => {
    expect(
      createWebDavProvider({ baseUrl: 'https://dav.example.com', id: 'replica-a' }, fetchStub).id,
    ).toBe('replica-a');
    expect(createWebDavProvider({ baseUrl: 'https://dav.example.com' }, fetchStub).id).toBe(
      'webdav',
    );

    const s3 = {
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'b',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
    };
    expect(createS3Provider({ ...s3, id: 'replica-b' }, fetchStub).id).toBe('replica-b');
    expect(createS3Provider(s3, fetchStub).id).toBe('s3');

    const dropbox = { appKey: 'k', appSecret: 's', refreshToken: 'r' };
    expect(createDropboxProvider({ ...dropbox, id: 'replica-c' }, fetchStub).id).toBe('replica-c');
    expect(createDropboxProvider(dropbox, fetchStub).id).toBe('dropbox');

    expect(createLocalFolderProvider(emptyFs, '', 'replica-d').id).toBe('replica-d');
    expect(createLocalFolderProvider(emptyFs).id).toBe('local-folder');
  });
});
