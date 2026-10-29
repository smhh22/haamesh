import { describe, expect, it } from 'vitest';
import { isRtlLanguage, resolveBookDirection } from './direction';

describe('isRtlLanguage', () => {
  it('detects Persian, Arabic, and Hebrew', () => {
    expect(isRtlLanguage('fa')).toBe(true);
    expect(isRtlLanguage('fa-IR')).toBe(true);
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('he')).toBe(true);
  });

  it('treats Latin languages and missing values as LTR', () => {
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage('en-US')).toBe(false);
    expect(isRtlLanguage(null)).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });
});

describe('resolveBookDirection', () => {
  it('trusts the OPF page progression first', () => {
    expect(resolveBookDirection({ pageProgression: 'rtl', language: 'en' })).toBe('rtl');
    expect(resolveBookDirection({ pageProgression: 'ltr', language: 'fa' })).toBe('ltr');
  });

  it('falls back to the book language', () => {
    expect(resolveBookDirection({ pageProgression: 'default', language: 'fa-IR' })).toBe('rtl');
    expect(resolveBookDirection({ language: 'en' })).toBe('ltr');
  });

  it('uses a document direction when language is absent', () => {
    expect(resolveBookDirection({ documentDir: 'rtl' })).toBe('rtl');
    expect(resolveBookDirection({ documentDir: 'ltr' })).toBe('ltr');
  });

  it('defaults to LTR when nothing is known', () => {
    expect(resolveBookDirection({})).toBe('ltr');
    expect(resolveBookDirection({ pageProgression: 'default' })).toBe('ltr');
  });
});
