import { afterEach, describe, expect, it, vi } from 'vitest';
import { armBackGuard } from './backNavigation';

/**
 * The guards hold module-level state, so every test arms and then disarms
 * whatever it armed; jsdom keeps real history between tests in one file.
 */
/**
 * jsdom delivers the history traversal and the resulting popstate across
 * several tasks; a single timer tick is not enough under a loaded suite.
 */
const settle = async () => {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

describe('armBackGuard', () => {
  afterEach(async () => {
    await settle();
  });

  it('closes the screen on a history pop', async () => {
    const close = vi.fn();
    armBackGuard(close);
    window.history.back();
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not close the screen when the UI closed it first', async () => {
    const close = vi.fn();
    const disarm = armBackGuard(close);
    disarm();
    await settle();
    await settle();
    expect(close).not.toHaveBeenCalled();
  });

  it('cancels a disarm when the same screen re-arms in the same tick', async () => {
    const close = vi.fn();
    const disarm = armBackGuard(close);
    disarm();
    // StrictMode's second mount: the pending pop must be dropped.
    armBackGuard(close);
    await settle();
    await settle();
    expect(close).not.toHaveBeenCalled();
  });

  it('pops the most recently armed screen first', async () => {
    const order: string[] = [];
    armBackGuard(() => order.push('library-screen'));
    const disarmSecond = armBackGuard(() => order.push('reader'));
    window.history.back();
    await settle();
    expect(order).toEqual(['reader']);
    expect(disarmSecond).not.toThrow();
  });

  it('does not pop a second entry after the gesture already closed the screen', async () => {
    const underneath = vi.fn();
    armBackGuard(underneath);
    const disarmReader = armBackGuard(() => {});
    window.history.back();
    await settle();
    // The screen's unmount runs its cleanup; it must not eat the entry below.
    disarmReader();
    await settle();
    expect(underneath).not.toHaveBeenCalled();
    window.history.back();
    await settle();
    expect(underneath).toHaveBeenCalledTimes(1);
  });
});
