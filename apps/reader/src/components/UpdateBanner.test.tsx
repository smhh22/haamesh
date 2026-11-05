import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { UpdateBanner } from './UpdateBanner';

const { checkForUpdate } = vi.hoisted(() => ({
  checkForUpdate: vi.fn(async () => ({ status: 'current' }) as const),
}));

vi.mock('../services/updater', () => ({
  checkForUpdate,
  installUpdate: vi.fn(),
  supportsInAppUpdate: () => true,
}));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateBanner', () => {
  it('defers the launch update check instead of running it during startup', async () => {
    render(<UpdateBanner />);
    expect(checkForUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });
});
