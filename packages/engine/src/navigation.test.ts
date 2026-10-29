import { describe, expect, it } from 'vitest';
import { pageTurnForKey } from './navigation';

describe('pageTurnForKey', () => {
  it('maps right and left arrows for LTR', () => {
    expect(pageTurnForKey('ArrowRight', 'ltr')).toBe('next');
    expect(pageTurnForKey('ArrowLeft', 'ltr')).toBe('prev');
  });

  it('swaps the arrows for RTL', () => {
    expect(pageTurnForKey('ArrowLeft', 'rtl')).toBe('next');
    expect(pageTurnForKey('ArrowRight', 'rtl')).toBe('prev');
  });

  it('keeps page up and down forward/backward in both directions', () => {
    expect(pageTurnForKey('PageDown', 'ltr')).toBe('next');
    expect(pageTurnForKey('PageDown', 'rtl')).toBe('next');
    expect(pageTurnForKey('PageUp', 'ltr')).toBe('prev');
    expect(pageTurnForKey('PageUp', 'rtl')).toBe('prev');
  });

  it('ignores unrelated keys', () => {
    expect(pageTurnForKey('Enter', 'ltr')).toBeNull();
    expect(pageTurnForKey('a', 'rtl')).toBeNull();
  });
});
