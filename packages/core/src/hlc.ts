/**
 * Hybrid logical clock (HLC).
 *
 * Packed form: `<physicalMs hex 13>-<counter hex 8>-<deviceId>`.
 * Lexicographic order of the packed string equals temporal order, which is what
 * the sync merge relies on. This module is pure: the wall clock is injected.
 */

export interface HlcParts {
  physical: number;
  counter: number;
  deviceId: string;
}

const PHYSICAL_HEX = 13;
const COUNTER_HEX = 8;
const MAX_PHYSICAL = 0xfffffffffffff;
const MAX_COUNTER = 0xffffffff;
const HLC_PATTERN = /^([0-9a-f]{13})-([0-9a-f]{8})-(.+)$/;
const DEVICE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const assertParts = (parts: HlcParts): void => {
  if (!Number.isSafeInteger(parts.physical) || parts.physical < 0) {
    throw new Error(`Invalid HLC physical time: ${parts.physical}`);
  }
  if (parts.physical > MAX_PHYSICAL) {
    throw new Error(`HLC physical time exceeds 13 hex digits: ${parts.physical}`);
  }
  if (!Number.isInteger(parts.counter) || parts.counter < 0 || parts.counter > MAX_COUNTER) {
    throw new Error(`Invalid HLC counter: ${parts.counter}`);
  }
  if (!DEVICE_PATTERN.test(parts.deviceId)) {
    throw new Error(`Invalid HLC device id: ${parts.deviceId}`);
  }
};

export const formatHlc = (parts: HlcParts): string => {
  assertParts(parts);
  const physical = parts.physical.toString(16).padStart(PHYSICAL_HEX, '0');
  const counter = parts.counter.toString(16).padStart(COUNTER_HEX, '0');
  return `${physical}-${counter}-${parts.deviceId}`;
};

export const parseHlc = (packed: string): HlcParts => {
  const match = HLC_PATTERN.exec(packed);
  const physicalHex = match?.[1];
  const counterHex = match?.[2];
  const deviceId = match?.[3];
  if (!physicalHex || !counterHex || !deviceId) {
    throw new Error(`Invalid HLC: ${packed}`);
  }
  return {
    physical: Number.parseInt(physicalHex, 16),
    counter: Number.parseInt(counterHex, 16),
    deviceId,
  };
};

/** Packed HLCs sort lexicographically, including the device-id tie-break. */
export const compareHlc = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

export class HybridLogicalClock {
  private last: HlcParts;

  constructor(
    private readonly deviceId: string,
    private readonly wallClock: () => number = Date.now,
  ) {
    if (!DEVICE_PATTERN.test(deviceId)) {
      throw new Error(`Invalid device id: ${deviceId}`);
    }
    this.last = { physical: 0, counter: 0, deviceId };
  }

  /** Timestamp for a local event. Monotonic even if the wall clock regresses. */
  now(): string {
    const wall = Math.max(0, Math.floor(this.wallClock()));
    this.last =
      wall > this.last.physical
        ? { physical: wall, counter: 0, deviceId: this.deviceId }
        : { physical: this.last.physical, counter: this.last.counter + 1, deviceId: this.deviceId };
    return formatHlc(this.last);
  }

  /** Absorb a remote timestamp and return the timestamp of the receive event. */
  observe(remote: string): string {
    const incoming = parseHlc(remote);
    const wall = Math.max(0, Math.floor(this.wallClock()));
    const physical = Math.max(wall, this.last.physical, incoming.physical);

    let counter = 0;
    if (physical === this.last.physical && physical === incoming.physical) {
      counter = Math.max(this.last.counter, incoming.counter) + 1;
    } else if (physical === this.last.physical) {
      counter = this.last.counter + 1;
    } else if (physical === incoming.physical) {
      counter = incoming.counter + 1;
    }

    this.last = { physical, counter, deviceId: this.deviceId };
    return formatHlc(this.last);
  }

  peek(): string {
    return formatHlc(this.last);
  }
}
