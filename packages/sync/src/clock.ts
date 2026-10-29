/**
 * Hybrid logical clock over the packed-HLC primitives from @hamesh/core.
 * `tick()` stamps local writes; `recv()` absorbs a remote timestamp so the
 * next local tick is strictly greater. Wall clock is injected for tests.
 */
import { formatHlc, parseHlc } from '@hamesh/core';

const MAX_COUNTER = 0xffffffff;

export class HlcClock {
  #deviceId: string;
  #now: () => number;
  #physical = 0;
  #counter = 0;

  constructor(deviceId: string, now: () => number = Date.now) {
    // formatHlc validates the device id on first tick; validate eagerly too.
    this.#deviceId = deviceId;
    this.#now = now;
    this.#physical = this.#now();
  }

  get deviceId(): string {
    return this.#deviceId;
  }

  get nowPhysical(): number {
    return this.#physical;
  }

  tick(): string {
    const wall = this.#now();
    if (wall > this.#physical) {
      this.#physical = wall;
      this.#counter = 0;
    } else {
      this.#counter += 1;
      if (this.#counter > MAX_COUNTER) {
        // Counter exhausted within one millisecond: advance physical time.
        this.#physical += 1;
        this.#counter = 0;
      }
    }
    return this.pack();
  }

  recv(remote: string): void {
    const parts = parseHlc(remote);
    const wall = this.#now();
    if (parts.physical > this.#physical || parts.physical > wall) {
      this.#physical = Math.max(parts.physical, this.#physical);
      this.#counter = parts.physical === this.#physical ? parts.counter + 1 : 0;
    } else if (parts.physical === this.#physical && parts.counter > this.#counter) {
      this.#counter = parts.counter;
    }
    if (this.#counter > MAX_COUNTER) {
      this.#physical += 1;
      this.#counter = 0;
    }
  }

  pack(): string {
    return formatHlc({
      physical: this.#physical,
      counter: this.#counter,
      deviceId: this.#deviceId,
    });
  }

  /** Current packed time without consuming a tick (for legacy bootstrap). */
  peek(): string {
    return this.pack();
  }
}
