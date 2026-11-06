import { describe, expect, it } from 'vitest';
import { importAudio, isAudioFile } from './import';

const isAscii = (value: string): boolean =>
  value.split('').every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) < 127);

const textEncoder = new TextEncoder();

/** UTF-16 little-endian bytes for a BMP string (TextEncoder is UTF-8 only). */
const utf16le = (value: string): Uint8Array => {
  const out = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out[2 * i] = code & 0xff;
    out[2 * i + 1] = code >> 8;
  }
  return out;
};

/**
 * One ID3v2.3 text frame: 10-byte header, encoding byte, body. Latin-1
 * (0x00) for ASCII values; UTF-16 with BOM (0x01) for anything else, which
 * is what real taggers write for non-Latin text in a v2.3 tag.
 */
const textFrame = (id: string, value: string): Uint8Array<ArrayBuffer> => {
  const ascii = isAscii(value);
  const payload = ascii ? textEncoder.encode(value) : utf16le(value);
  const body = new Uint8Array([
    ascii ? 0x00 : 0x01,
    ...payload,
    ...(ascii ? [0x00] : [0x00, 0x00]),
  ]);
  const frame = new Uint8Array(10 + body.length);
  frame.set(textEncoder.encode(id), 0);
  new DataView(frame.buffer).setUint32(4, body.length, false);
  frame.set(body, 10);
  return frame;
};

/** One ID3v2.3 APIC (cover) frame: encoding, MIME, type, empty desc, data. */
const pictureFrame = (mime: string, data: Uint8Array): Uint8Array<ArrayBuffer> => {
  const body = new Uint8Array([0x00, ...textEncoder.encode(mime), 0x00, 0x03, 0x00, ...data]);
  const frame = new Uint8Array(10 + body.length);
  frame.set(textEncoder.encode('APIC'), 0);
  new DataView(frame.buffer).setUint32(4, body.length, false);
  frame.set(body, 10);
  return frame;
};

/** Minimal tagged MP3: ID3v2.3 header + frames + one zero-filled MPEG frame. */
const taggedMp3 = (frames: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const framesLength = frames.reduce((total, frame) => total + frame.length, 0);
  const header = new Uint8Array(10);
  header.set(textEncoder.encode('ID3'), 0);
  header[3] = 3;
  new DataView(header.buffer).setUint32(6, framesLength, false);

  const mpeg = new Uint8Array(417);
  mpeg[0] = 0xff;
  mpeg[1] = 0xfb;
  mpeg[2] = 0x90;

  const out = new Uint8Array(10 + framesLength + mpeg.length);
  out.set(header, 0);
  let offset = 10;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  out.set(mpeg, offset);
  return out;
};

const makeAudioFile = (bytes: Uint8Array<ArrayBuffer>, name = 'sample.mp3'): File =>
  new File([bytes], name, { type: 'audio/mpeg' });

describe('isAudioFile', () => {
  it('detects audio by extension and MIME type', () => {
    expect(isAudioFile(makeAudioFile(taggedMp3([])))).toBe(true);
    expect(isAudioFile(new File([new Uint8Array(1).fill(0)], 'book.m4b'))).toBe(true);
    expect(isAudioFile(new File([new Uint8Array(1)], 'chapter', { type: 'audio/ogg' }))).toBe(true);
    expect(isAudioFile(new File([new Uint8Array(1).fill(0)], 'book.epub'))).toBe(false);
  });
});

describe('importAudio', () => {
  it('reads tags for title, artist, and cover, and records the container', async () => {
    // 1x1 PNG, enough for a Blob without decoding.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const file = makeAudioFile(
      taggedMp3([
        textFrame('TIT2', 'The Grand Design'),
        textFrame('TPE1', 'Stephen Hawking'),
        textFrame('TLAN', 'eng'),
        pictureFrame('image/png', png),
      ]),
    );
    const result = await importAudio(file);

    expect(result.metadata.format).toBe('audio');
    expect(result.metadata.title).toBe('The Grand Design');
    expect(result.metadata.authors).toEqual(['Stephen Hawking']);
    expect(result.metadata.language).toBe('eng');
    expect(result.metadata.direction).toBe('ltr');
    expect(result.metadata.identifiers.container).toBe('mp3');
    expect(result.cover?.type).toBe('image/png');
    // The cover bytes must be the image itself, not shifted by a frame byte.
    const coverHead = new Uint8Array(
      (await result.cover?.arrayBuffer()) ?? new ArrayBuffer(0),
    ).slice(0, 4);
    expect(Array.from(coverHead)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('falls back to the file name and keeps going without tags', async () => {
    const file = makeAudioFile(taggedMp3([]), 'My Audio Book.mp3');
    const result = await importAudio(file);

    expect(result.metadata.title).toBe('My Audio Book');
    expect(result.metadata.authors).toEqual([]);
    expect(result.metadata.language).toBeNull();
    expect(result.cover).toBeNull();
    expect(result.metadata.identifiers.container).toBe('mp3');
  });

  it('prefers a Persian tag for direction and maps containers by extension', async () => {
    const file = makeAudioFile(
      taggedMp3([textFrame('TIT2', 'کتاب صوتی'), textFrame('TLAN', 'fa')]),
      'book.m4b',
    );
    const result = await importAudio(file);

    expect(result.metadata.title).toBe('کتاب صوتی');
    expect(result.metadata.direction).toBe('rtl');
    expect(result.metadata.identifiers.container).toBe('m4b');
  });

  it('rejects an empty file', async () => {
    await expect(importAudio(makeAudioFile(new Uint8Array(0).fill(0)))).rejects.toMatchObject({
      code: 'INVALID_FILE',
    });
  });
});
