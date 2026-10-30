import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './version';

describe('isNewerVersion', () => {
  it('compares each numeric part', () => {
    expect(isNewerVersion('0.2.0', '0.1.2')).toBe(true);
    expect(isNewerVersion('0.1.3', '0.1.2')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('does not offer equal or older versions', () => {
    expect(isNewerVersion('0.1.2', '0.1.2')).toBe(false);
    expect(isNewerVersion('0.1.1', '0.1.2')).toBe(false);
    expect(isNewerVersion('0.2.0', 'v0.2.0')).toBe(false);
  });

  it('ignores pre-release suffixes for ordering', () => {
    expect(isNewerVersion('v0.2.0-beta.1', '0.1.2')).toBe(true);
    expect(isNewerVersion('0.2.0-beta.1', '0.2.0')).toBe(false);
  });
});
