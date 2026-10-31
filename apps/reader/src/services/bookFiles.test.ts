import { beforeEach, describe, expect, it } from 'vitest';
import { forgetBookFile, getBookFile, rememberBookFile } from './bookFiles';

const file = (name: string): File => new File([name], `${name}.epub`);

describe('book file cache', () => {
  beforeEach(() => {
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) forgetBookFile(name);
  });

  it('keeps the most recently used files', () => {
    for (const name of ['a', 'b', 'c', 'd']) rememberBookFile(name, file(name));
    // Reading "a" makes "b" the oldest.
    expect(getBookFile('a')).not.toBeNull();
    rememberBookFile('e', file('e'));

    expect(getBookFile('b')).toBeNull();
    expect(getBookFile('a')).not.toBeNull();
    expect(getBookFile('c')).not.toBeNull();
    expect(getBookFile('d')).not.toBeNull();
    expect(getBookFile('e')).not.toBeNull();
  });

  it('evicts the oldest entry beyond the cap', () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) rememberBookFile(name, file(name));

    expect(getBookFile('a')).toBeNull();
    expect(getBookFile('e')).not.toBeNull();
  });

  it('forgets a single book without touching the rest', () => {
    rememberBookFile('a', file('a'));
    rememberBookFile('b', file('b'));
    forgetBookFile('a');

    expect(getBookFile('a')).toBeNull();
    expect(getBookFile('b')).not.toBeNull();
  });
});
