import type { Direction } from '@hamesh/core';

export type PageTurn = 'next' | 'prev';

/**
 * Map a navigation key to reading order. "Next" is visually left in RTL, so the
 * arrow keys swap there; PageDown/PageUp keep their forward/backward meaning.
 */
export const pageTurnForKey = (key: string, direction: Direction): PageTurn | null => {
  const forwardKey = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backwardKey = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';

  if (key === forwardKey || key === 'PageDown') return 'next';
  if (key === backwardKey || key === 'PageUp') return 'prev';
  return null;
};
