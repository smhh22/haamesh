import { describe, expect, it } from 'vitest';
import { clampFraction, locatorFraction } from './book';

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
