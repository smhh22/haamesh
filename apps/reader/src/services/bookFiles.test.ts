import { beforeEach, describe, expect, it } from 'vitest';
import { forgetBookFile, getBookFile, rememberBookFile } from './bookFiles';

const file = (name: string): File => new File([name], `${name}.epub`);

describe('book file cache', () => {
  beforeEach(() => {
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) forgetBookFile(name);
  });

  it('keeps the two most recently used files', () => {
    rememberBookFile('a', file('a'));
    rememberBookFile('b', file('b'));
    // "c" evicts "a"; touching "c" refreshes it, so "d" evicts "b" instead.
    rememberBookFile('c', file('c'));
    expect(getBookFile('a')).toBeNull();
    expect(getBookFile('b')).not.toBeNull();
    expect(getBookFile('c')).not.toBeNull();

    rememberBookFile('d', file('d'));
    expect(getBookFile('b')).toBeNull();
    expect(getBookFile('c')).not.toBeNull();
    expect(getBookFile('d')).not.toBeNull();
  });

  it('evicts the oldest entries beyond the cap', () => {
    for (const name of ['a', 'b', 'c']) rememberBookFile(name, file(name));

    expect(getBookFile('a')).toBeNull();
    expect(getBookFile('c')).not.toBeNull();
  });

  it('forgets a single book without touching the rest', () => {
    rememberBookFile('a', file('a'));
    rememberBookFile('b', file('b'));
    forgetBookFile('a');

    expect(getBookFile('a')).toBeNull();
    expect(getBookFile('b')).not.toBeNull();
  });
});
