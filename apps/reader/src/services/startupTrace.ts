/**
 * Startup trace: lightweight milestones for diagnosing "the app hangs for a
 * few seconds after launch" reports (Windows, in particular). Release builds
 * ship no log plugin, so the trace persists the last run's milestones to
 * localStorage and the About settings section shows them with a copy action.
 *
 * Durations use `performance.now()` deltas — immune to wall-clock changes.
 */

const LAST_RUN_KEY = 'hamesh.startup.trace.last';
const MAX_ENTRIES = 30;

export interface StartupMilestone {
  label: string;
  /** Milliseconds since script start. */
  ms: number;
  /** Optional detail, e.g. the update-check status. */
  note?: string;
}

export interface StartupRun {
  /** Wall-clock ISO time of the last milestone. */
  at: string;
  entries: StartupMilestone[];
}

const t0 = performance.now();
const entries: StartupMilestone[] = [];

/** Record one milestone. No-ops when localStorage is unavailable. */
export const markStartup = (label: string, note?: string): void => {
  if (entries.length >= MAX_ENTRIES) return;
  entries.push({
    label,
    ms: Math.round(performance.now() - t0),
    ...(note ? { note } : {}),
  });
};

/**
 * Heartbeats across the first 90 seconds: each fires a milestone whose drift
 * (actual time minus target) reveals main-thread stalls in a window where
 * the app otherwise records nothing — the reported Windows freeze sits at
 * 40–60 s. Every heartbeat re-persists the run so a crash still leaves the
 * story up to that point.
 */
export const scheduleStartupHeartbeats = (): void => {
  for (const second of [30, 45, 60, 75, 90]) {
    window.setTimeout(() => {
      const drift = Math.round(performance.now() - t0 - second * 1000);
      markStartup(`heartbeat-${second}s`, `drift ${drift}ms`);
      finishStartupRun();
    }, second * 1000);
  }
};

/** Snapshot the current milestones as the "last launch" run. */
export const finishStartupRun = (): void => {
  if (entries.length === 0) return;
  try {
    const run: StartupRun = { at: new Date().toISOString(), entries: [...entries] };
    localStorage.setItem(LAST_RUN_KEY, JSON.stringify(run));
  } catch {
    // Storage can be unavailable (private mode); the trace is best-effort.
  }
};

/** The persisted last launch, or null. */
export const readLastStartupRun = (): StartupRun | null => {
  try {
    const raw = localStorage.getItem(LAST_RUN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return null;
    }
    return parsed as StartupRun;
  } catch {
    return null;
  }
};

/** Human-readable single block for pasting into a bug report. */
export const formatStartupRun = (run: StartupRun): string =>
  [
    `Hāmesh startup trace (${run.at})`,
    ...run.entries.map((e) => `${e.ms} ms  ${e.label}${e.note ? ` — ${e.note}` : ''}`),
  ].join('\n');
