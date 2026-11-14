import { describe, expect, it } from 'vitest';
import { limitRangeReads, MAX_CONCURRENT_RANGE_READS } from './pdfRangeLimit';

interface Tracked {
  file: File;
  peak: () => number;
}

/**
 * A file-like object whose `arrayBuffer()` yields a macrotask so overlapping
 * reads are observable. `limitRangeReads` only needs `slice` + size.
 */
const trackedFile = (size: number): Tracked => {
  const data = new Uint8Array(size).map((_, index) => index % 256);
  let inFlight = 0;
  let peak = 0;
  const file = {
    name: 'big.pdf',
    size,
    type: 'application/pdf',
    lastModified: 0,
    slice(start = 0, end = size) {
      const part = data.slice(start, end);
      return {
        size: part.byteLength,
        arrayBuffer: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inFlight -= 1;
          return part.buffer;
        },
      };
    },
  } as unknown as File;
  return { file, peak: () => peak };
};

describe('limitRangeReads', () => {
  it('passes a real File through untouched', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'a.pdf', {
      type: 'application/pdf',
    });
    const limited = limitRangeReads(file);

    expect(limited).toBeInstanceOf(File);
    expect(limited.name).toBe('a.pdf');
    expect(limited.size).toBe(6);
    expect(limited.type).toBe('application/pdf');
    expect([...new Uint8Array(await limited.slice(0, 4).arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(limited.slice(2, 4).size).toBe(2);
    expect([...new Uint8Array(await limited.arrayBuffer())]).toHaveLength(6);
  });

  it('caps concurrent range reads and still serves every one', async () => {
    const { file, peak } = trackedFile(64 * 64);
    const limited = limitRangeReads(file);
    const requests = Array.from({ length: 32 }, (_, index) =>
      limited.slice(index * 32, index * 32 + 32).arrayBuffer(),
    );

    const buffers = await Promise.all(requests);

    expect(buffers).toHaveLength(32);
    expect(peak()).toBeLessThanOrEqual(MAX_CONCURRENT_RANGE_READS);
    expect(peak()).toBeGreaterThan(1);
    expect(new Uint8Array(buffers[31] as ArrayBuffer)[0]).toBe((31 * 32) % 256);
  });

  it('treats a non-positive limit as one', async () => {
    const { file, peak } = trackedFile(1024);
    const limited = limitRangeReads(file, 0);
    await Promise.all(
      Array.from({ length: 5 }, (_, index) => limited.slice(index, index + 1).arrayBuffer()),
    );
    expect(peak()).toBe(1);
  });

  it('frees the slot when a range read fails', async () => {
    let failNext = true;
    const file = {
      name: 'flaky.pdf',
      size: 64,
      type: 'application/pdf',
      slice: () => ({
        arrayBuffer: async () => {
          if (failNext) {
            failNext = false;
            throw new Error('read failed');
          }
          return new ArrayBuffer(8);
        },
      }),
    } as unknown as File;
    const limited = limitRangeReads(file, 1);

    await expect(limited.slice(0, 8).arrayBuffer()).rejects.toThrow('read failed');
    await Promise.all(
      Array.from({ length: 4 }, (_, index) => limited.slice(index, index + 8).arrayBuffer()),
    );
  });
});
