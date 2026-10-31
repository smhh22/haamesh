import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import fa from './locales/fa.json';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const flatten = (value: Json, prefix = ''): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [key, entry] of Object.entries(value as Record<string, Json>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'string') {
      out.set(path, entry);
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      for (const [nested, text] of flatten(entry, path)) out.set(nested, text);
    }
  }
  return out;
};

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1] ?? '').sort();

describe('locales', () => {
  const english = flatten(en as unknown as Json);
  const persian = flatten(fa as unknown as Json);

  it('has the same keys in both languages', () => {
    expect([...persian.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('has no empty strings', () => {
    for (const [key, value] of [...english, ...persian]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('uses the same interpolation placeholders', () => {
    for (const [key, value] of english) {
      expect(placeholders(persian.get(key) ?? ''), key).toEqual(placeholders(value));
    }
  });
});
