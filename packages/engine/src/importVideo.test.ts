import { describe, expect, it } from 'vitest';
import { importVideo, isVideoFile } from './import';

const makeVideoFile = (name = 'lecture.mp4', type = 'video/mp4'): File =>
  new File([new Uint8Array(64).fill(1)], name, { type });

describe('isVideoFile', () => {
  it('detects video by extension and MIME type', () => {
    expect(isVideoFile(makeVideoFile())).toBe(true);
    expect(isVideoFile(new File([new Uint8Array(1).fill(1)], 'course.mkv'))).toBe(true);
    expect(isVideoFile(new File([new Uint8Array(1).fill(1)], 'clip', { type: 'video/webm' }))).toBe(
      true,
    );
    expect(isVideoFile(new File([new Uint8Array(1).fill(1)], 'book.epub'))).toBe(false);
    expect(isVideoFile(new File([new Uint8Array(1).fill(1)], 'book.mp3'))).toBe(false);
  });
});

describe('importVideo', () => {
  it('imports with the file name as title and records the container', async () => {
    const result = await importVideo(makeVideoFile('Rust Course 01.mp4'));

    expect(result.metadata.format).toBe('video');
    expect(result.metadata.title).toBe('Rust Course 01');
    expect(result.metadata.authors).toEqual([]);
    expect(result.metadata.identifiers.container).toBe('mp4');
    expect(result.metadata.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.cover).toBeNull();
  });

  it('maps containers by extension', async () => {
    const mkv = await importVideo(makeVideoFile('part-2.mkv', 'video/x-matroska'));
    expect(mkv.metadata.identifiers.container).toBe('mkv');
    const webm = await importVideo(makeVideoFile('part-3.webm'));
    expect(webm.metadata.identifiers.container).toBe('webm');
  });

  it('produces the same hash for identical bytes', async () => {
    const first = await importVideo(makeVideoFile());
    const second = await importVideo(makeVideoFile());
    expect(first.metadata.hash).toBe(second.metadata.hash);
  });

  it('rejects an empty file', async () => {
    await expect(
      importVideo(new File([new Uint8Array(0)], 'empty.mp4', { type: 'video/mp4' })),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
});
