import { describe, expect, it } from 'vitest';
import { compareHlc, formatHlc, HybridLogicalClock, parseHlc } from './hlc';

describe('formatHlc and parseHlc', () => {
  it('round-trips a timestamp', () => {
    const parts = { physical: 1_700_000_000_000, counter: 7, deviceId: 'device-a' };
    const packed = formatHlc(parts);
    expect(packed).toMatch(/^[0-9a-f]{13}-[0-9a-f]{8}-device-a$/);
    expect(parseHlc(packed)).toEqual(parts);
  });

  it('rejects malformed input', () => {
    expect(() => parseHlc('not-a-clock')).toThrow();
    expect(() => parseHlc('0000000000000-00000000-')).toThrow();
    expect(() => formatHlc({ physical: -1, counter: 0, deviceId: 'dev' })).toThrow();
    expect(() => formatHlc({ physical: 0x10000000000000, counter: 0, deviceId: 'dev' })).toThrow();
    expect(() => formatHlc({ physical: 1, counter: 0, deviceId: 'bad id' })).toThrow();
  });
});

describe('compareHlc', () => {
  it('orders by physical time, then counter, then device id', () => {
    const base = { physical: 1000, counter: 0, deviceId: 'a' };
    const laterCounter = { physical: 1000, counter: 1, deviceId: 'a' };
    const laterDevice = { physical: 1000, counter: 0, deviceId: 'b' };
    const laterPhysical = { physical: 1001, counter: 0, deviceId: 'a' };

    expect(compareHlc(formatHlc(base), formatHlc(laterCounter))).toBe(-1);
    expect(compareHlc(formatHlc(base), formatHlc(laterDevice))).toBe(-1);
    expect(compareHlc(formatHlc(base), formatHlc(laterPhysical))).toBe(-1);
    expect(compareHlc(formatHlc(base), formatHlc(base))).toBe(0);
  });
});

describe('HybridLogicalClock', () => {
  it('stays monotonic while the wall clock stands still', () => {
    const clock = new HybridLogicalClock('device-a', () => 1000);
    const first = clock.now();
    const second = clock.now();
    expect(compareHlc(first, second)).toBe(-1);
  });

  it('stays monotonic when the wall clock regresses', () => {
    let wall = 2000;
    const clock = new HybridLogicalClock('device-a', () => wall);
    const first = clock.now();
    wall = 1000;
    const second = clock.now();
    expect(compareHlc(first, second)).toBe(-1);
  });

  it('absorbs a remote timestamp that is ahead of local time', () => {
    const clock = new HybridLogicalClock('device-a', () => 1000);
    const remote = formatHlc({ physical: 5000, counter: 3, deviceId: 'device-b' });
    const received = clock.observe(remote);
    expect(compareHlc(remote, received)).toBe(-1);

    const next = clock.now();
    expect(compareHlc(received, next)).toBe(-1);
  });

  it('increments the counter when physical times match', () => {
    const clock = new HybridLogicalClock('device-a', () => 5000);
    const remote = formatHlc({ physical: 5000, counter: 2, deviceId: 'device-b' });
    const received = parseHlc(clock.observe(remote));
    expect(received.physical).toBe(5000);
    expect(received.counter).toBe(3);
    expect(received.deviceId).toBe('device-a');
  });
});
