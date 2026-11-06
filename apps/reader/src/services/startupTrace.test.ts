import { beforeEach, describe, expect, it } from 'vitest';
import {
  finishStartupRun,
  formatStartupRun,
  markStartup,
  readLastStartupRun,
} from './startupTrace';

describe('startup trace', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records milestones with monotonically increasing times', () => {
    markStartup('a');
    markStartup('b', 'detail');
    const run = (() => {
      finishStartupRun();
      return readLastStartupRun();
    })();
    expect(run).not.toBeNull();
    expect(run?.entries.length).toBeGreaterThanOrEqual(2);
    const times = run?.entries.map((entry) => entry.ms) ?? [];
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(run?.entries.at(-1)?.note).toBe('detail');
  });

  it('formats a paste-ready block', () => {
    markStartup('boot');
    finishStartupRun();
    const run = readLastStartupRun();
    expect(run).not.toBeNull();
    const text = formatStartupRun(run as NonNullable<ReturnType<typeof readLastStartupRun>>);
    expect(text).toMatch(/^Hāmesh startup trace \(/);
    expect(text).toMatch(/ms {2}boot/);
  });

  it('returns null when nothing was recorded', () => {
    expect(readLastStartupRun()).toBeNull();
  });
});
