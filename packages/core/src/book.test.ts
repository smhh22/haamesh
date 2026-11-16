import { describe, expect, it } from 'vitest';
import { clampFraction, isLocator, type Locator, locatorFraction } from './book';

describe('clampFraction', () => {
  it('keeps values inside 0..1', () => {
    expect(clampFraction(0)).toBe(0);
    expect(clampFraction(0.42)).toBe(0.42);
    expect(clampFraction(1)).toBe(1);
    expect(clampFraction(-0.1)).toBe(0);
    expect(clampFraction(1.1)).toBe(1);
  });

  it('treats non-finite values as zero', () => {
    expect(clampFraction(Number.NaN)).toBe(0);
    expect(clampFraction(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampFraction(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('locatorFraction', () => {
  it('returns zero without a locator', () => {
    expect(locatorFraction(null)).toBe(0);
  });

  it('clamps the locator fraction', () => {
    expect(locatorFraction({ kind: 'cfi', cfi: '/6/2', fraction: 0.25 })).toBe(0.25);
    expect(locatorFraction({ kind: 'page', page: 10, fraction: 2 })).toBe(1);
  });
});

describe('isLocator — the whole union passes (EPUB, PDF, text, audio, video)', () => {
  const locators: Locator[] = [
    { kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2)', fraction: 0.5 },
    { kind: 'page', page: 3, fraction: 0.5 },
    { kind: 'pdf', page: 12, text: 'some selected text', occurrence: 1, fraction: 0.75 },
    { kind: 'offset', offset: 2048, fraction: 0.1 },
    { kind: 'audio', seconds: 3661.5, fraction: 0.9 },
    { kind: 'time', seconds: 0, fraction: 0 },
  ];

  it.each(locators.map((locator) => [locator.kind, locator] as const))(
    'accepts %s',
    (_, locator) => {
      expect(isLocator(locator)).toBe(true);
      // The wire path serializes positions as plain JSON; the guard must
      // accept exactly what comes back.
      expect(isLocator(JSON.parse(JSON.stringify(locator)))).toBe(true);
    },
  );

  it('accepts a pdf locator with empty text and occurrence zero', () => {
    expect(isLocator({ kind: 'pdf', page: 1, text: '', occurrence: 0, fraction: 0 })).toBe(true);
  });
});

describe('isLocator — corrupted or hostile records are rejected', () => {
  const invalid: unknown[] = [
    null,
    42,
    'epubcfi(/6/4)',
    {},
    // Unknown discriminant.
    { kind: 'chapter', label: 'One', fraction: 0.5 },
    // A bare discriminant without its payload.
    { kind: 'cfi' },
    { kind: 'page' },
    { kind: 'pdf' },
    { kind: 'audio' },
    { kind: 'time' },
    // Payload of the wrong type or shape.
    { kind: 'cfi', cfi: 7, fraction: 0.5 },
    { kind: 'cfi', cfi: '', fraction: 0.5 },
    { kind: 'page', page: '3', fraction: 0.5 },
    { kind: 'page', page: -1, fraction: 0.5 },
    { kind: 'pdf', page: 1, text: 9, occurrence: 0, fraction: 0.5 },
    { kind: 'pdf', page: 1, text: 'x', occurrence: 1.5, fraction: 0.5 },
    { kind: 'pdf', page: 1, text: 'x', occurrence: -1, fraction: 0.5 },
    { kind: 'offset', offset: -5, fraction: 0.5 },
    { kind: 'audio', seconds: '90', fraction: 0.5 },
    { kind: 'time', seconds: Number.NaN, fraction: 0.5 },
    // Fraction must be a finite number on every variant.
    { kind: 'cfi', cfi: '/6/4' },
    { kind: 'cfi', cfi: '/6/4', fraction: Number.NaN },
    { kind: 'page', page: 1, fraction: 'half' },
    { kind: 'audio', seconds: 90 },
  ];

  it.each(invalid.map((value, index) => [index, value] as const))('rejects case %i', (_, value) => {
    expect(isLocator(value)).toBe(false);
  });
});
