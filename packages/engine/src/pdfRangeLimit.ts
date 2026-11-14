/**
 * Bound PDF range reads (ADR-readest note: foliate's `makePDF` dispatches one
 * `slice().arrayBuffer()` per pdf.js range request without waiting, so a large
 * PDF can fire hundreds at once). Peak memory is one copy per in-flight range;
 * capping keeps that bounded and mirrors a browser's per-host connection limit.
 *
 * Our files are already in-memory `File` objects, so the reads are slices rather
 * than native/network round-trips — the cap is a guard, not a visible fix. It
 * costs nothing when a document reads a handful of ranges at a time.
 */
export const MAX_CONCURRENT_RANGE_READS = 6;

/** Counting semaphore: the task starts as soon as a slot frees up. */
const createLimiter = (limit: number) => {
  let active = 0;
  const waiting: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };

  const release = (): void => {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next();
    }
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
};

/**
 * Wrap a file so every `slice(...).arrayBuffer()` runs through a shared
 * concurrency limit. Property access and other blob methods pass through, and
 * the wrapper keeps `instanceof File` true, so foliate's format detection is
 * unaffected.
 */
export const limitRangeReads = (file: File, limit = MAX_CONCURRENT_RANGE_READS): File => {
  const run = createLimiter(Math.max(1, Math.floor(limit)));

  return new Proxy(file, {
    get(target, property) {
      if (property !== 'slice') {
        // Read with `target` as the receiver: File/Blob accessors are
        // brand-checked and throw when called on a proxy.
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (start?: number, end?: number, contentType?: string): Blob => {
        const part = target.slice(start, end, contentType);
        return new Proxy(part, {
          get(partTarget, partProperty) {
            if (partProperty === 'arrayBuffer') {
              return (): Promise<ArrayBuffer> => run(() => partTarget.arrayBuffer());
            }
            const value = Reflect.get(partTarget, partProperty, partTarget) as unknown;
            return typeof value === 'function' ? value.bind(partTarget) : value;
          },
        });
      };
    },
  });
};
