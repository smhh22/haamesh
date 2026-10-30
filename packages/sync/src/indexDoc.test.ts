import { formatHlc } from '@hamesh/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { IndexDoc, RecordDoc } from './indexDoc';
import {
  decodeIndexDoc,
  diffPull,
  emptyIndexDoc,
  encodeIndexDoc,
  mergeAllIndexDocs,
  mergeIndexDoc,
  SCHEMA_VERSION,
} from './indexDoc';

const deviceArb = fc.constantFrom('device-a', 'device-b', 'device-c');
const hlcArb = fc
  .tuple(fc.nat({ max: 2 ** 40 }), fc.nat({ max: 8 }), deviceArb)
  .map(([physical, counter, deviceId]) => formatHlc({ physical, counter, deviceId }));
const envelopeArb = fc
  .tuple(fc.string({ minLength: 1, maxLength: 12 }), hlcArb)
  .map(([v, t]) => ({ v, t }));

const recordDocArb: fc.Arbitrary<RecordDoc> = fc
  .tuple(
    fc.uniqueArray(fc.tuple(fc.string({ minLength: 1, maxLength: 6 }), envelopeArb), {
      selector: (entry) => entry[0],
      maxLength: 4,
    }),
    fc.option(envelopeArb, { nil: null }),
  )
  .map(([fields, deletedAt]) => ({
    fields: Object.fromEntries(fields),
    deletedAt,
  }));

const indexDocArb: fc.Arbitrary<IndexDoc> = fc
  .tuple(
    fc.uniqueArray(fc.tuple(fc.string({ minLength: 1, maxLength: 8 }), recordDocArb), {
      selector: (entry) => entry[0],
      maxLength: 5,
    }),
    fc.uniqueArray(
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 8 }).map((s) => `n-${s}`),
        recordDocArb,
      ),
      {
        selector: (entry) => entry[0],
        maxLength: 5,
      },
    ),
  )
  .map(([books, notes]) => ({
    schemaVersion: SCHEMA_VERSION,
    devices: {},
    books: Object.fromEntries(books),
    notes: Object.fromEntries(notes),
  }));

describe('index document merge', () => {
  it('is commutative', () => {
    const prop = fc.property(indexDocArb, indexDocArb, (a, b) => {
      expect(mergeIndexDoc(a, b)).toEqual(mergeIndexDoc(b, a));
    });
    expect(fc.assert(prop, { numRuns: 300 })).toBeUndefined();
  });

  it('is associative', () => {
    const prop = fc.property(indexDocArb, indexDocArb, indexDocArb, (a, b, c) => {
      const left = mergeIndexDoc(mergeIndexDoc(a, b), c);
      const right = mergeIndexDoc(a, mergeIndexDoc(b, c));
      expect(left).toEqual(right);
    });
    expect(fc.assert(prop, { numRuns: 300 })).toBeUndefined();
  });

  it('is idempotent', () => {
    const prop = fc.property(indexDocArb, (a) => {
      expect(mergeIndexDoc(a, a)).toEqual(a);
    });
    expect(fc.assert(prop, { numRuns: 300 })).toBeUndefined();
  });

  it('keeps the newest field across arbitrary replica merges', () => {
    const prop = fc.property(fc.array(indexDocArb, { minLength: 2, maxLength: 5 }), (docs) => {
      const merged = mergeAllIndexDocs(docs);
      for (const doc of docs) {
        for (const [id, entry] of Object.entries(doc.books)) {
          const target = merged.books[id];
          expect(target).toBeDefined();
          for (const [field, envelope] of Object.entries(entry.fields)) {
            const mergedEnvelope = target?.fields[field];
            expect(mergedEnvelope).toBeDefined();
            expect(
              (mergedEnvelope?.t ?? '') >= envelope.t || envelope.t >= (mergedEnvelope?.t ?? ''),
            ).toBe(true);
          }
        }
      }
    });
    expect(fc.assert(prop, { numRuns: 100 })).toBeUndefined();
  });

  it('survives an encode/decode round-trip', () => {
    const prop = fc.property(indexDocArb, (doc) => {
      expect(decodeIndexDoc(JSON.parse(encodeIndexDoc(doc)))).toEqual(doc);
    });
    expect(fc.assert(prop, { numRuns: 300 })).toBeUndefined();
  });

  it('rejects unknown schema versions', () => {
    expect(() => decodeIndexDoc({ schemaVersion: 999 })).toThrowError(/schemaVersion/);
  });

  it('rejects malformed records', () => {
    expect(() =>
      decodeIndexDoc({ schemaVersion: 1, books: { b1: { fields: { title: 'nope' } } } }),
    ).toThrowError(/envelope/);
  });
});

describe('diffPull', () => {
  it('pulls records missing locally and fields strictly newer remotely', () => {
    const local = {
      b1: {
        fields: { title: { v: 'old', t: formatHlc({ physical: 10, counter: 0, deviceId: 'a' }) } },
        deletedAt: null,
      },
    };
    const remote = {
      b1: {
        fields: { title: { v: 'new', t: formatHlc({ physical: 20, counter: 0, deviceId: 'b' }) } },
        deletedAt: null,
      },
      b2: {
        fields: { sha256: { v: 'x', t: formatHlc({ physical: 5, counter: 0, deviceId: 'a' }) } },
        deletedAt: null,
      },
    };
    const pull = diffPull(local, remote);
    expect(pull.b1?.fields.title?.v).toBe('new');
    expect(pull.b2?.fields.sha256?.v).toBe('x');
    expect(pull.b1?.fields.sha256).toBeUndefined();
  });

  it('never pulls older remote fields', () => {
    const t = formatHlc({ physical: 30, counter: 0, deviceId: 'a' });
    const older = formatHlc({ physical: 20, counter: 0, deviceId: 'b' });
    const pull = diffPull(
      { b1: { fields: { title: { v: 'mine', t } }, deletedAt: null } },
      { b1: { fields: { title: { v: 'theirs', t: older } }, deletedAt: null } },
    );
    expect(pull.b1).toBeUndefined();
  });

  it('pulls tombstones for records deleted remotely', () => {
    const tombstone = {
      v: formatHlc({ physical: 40, counter: 0, deviceId: 'b' }),
      t: formatHlc({ physical: 40, counter: 0, deviceId: 'b' }),
    };
    const pull = diffPull(
      { b1: { fields: { title: { v: 'x', t: tombstone.t } }, deletedAt: null } },
      { b1: { fields: {}, deletedAt: tombstone } },
    );
    expect(pull.b1?.deletedAt).toEqual(tombstone);
  });

  it('returns nothing for equal documents', () => {
    const prop = fc.property(indexDocArb, (doc) => {
      expect(diffPull(doc.books, doc.books)).toEqual({});
    });
    expect(fc.assert(prop, { numRuns: 200 })).toBeUndefined();
  });

  it('merging an empty doc leaves the other unchanged', () => {
    const prop = fc.property(indexDocArb, (doc) => {
      expect(mergeIndexDoc(doc, emptyIndexDoc())).toEqual(doc);
    });
    expect(fc.assert(prop, { numRuns: 200 })).toBeUndefined();
  });
});
