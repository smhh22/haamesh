/**
 * Per-record last-writer-wins envelopes. The timestamp is a packed HLC
 * (physical-counter-device); lexicographic comparison of packed strings is the
 * total order, so all replicas converge without coordination. Pure module.
 */
import { compareHlc } from '@hamesh/core';

export interface Envelope<V = unknown> {
  v: V;
  /** Packed HLC of the write. */
  t: string;
}

export const makeEnvelope = <V>(value: V, timestamp: string): Envelope<V> => ({
  v: value,
  t: timestamp,
});

/** Later timestamp wins; ties are impossible across devices and resolve deterministically via the device-id suffix inside the HLC. */
export const mergeEnvelope = <V>(a: Envelope<V>, b: Envelope<V>): Envelope<V> =>
  compareHlc(a.t, b.t) >= 0 ? a : b;

export const mergeEnvelopeOpt = <V>(
  a: Envelope<V> | null,
  b: Envelope<V> | null,
): Envelope<V> | null => {
  if (a && b) return mergeEnvelope(a, b);
  return a ?? b;
};
