/**
 * pdf.js normally runs its parser in a module Worker. Under Tauri's tauri://
 * scheme the page origin is null, so pdf.js treats the worker as cross-origin:
 * it wraps it in a blob URL (blocked by the app CSP) and its fallback dynamic
 * import of the custom-scheme URL fails too — every PDF then fails to parse in
 * the desktop shell. Preloading the worker module on the main thread makes
 * pdf.js select its supported fake worker before any worker is attempted.
 */
type WorkerModule = { WorkerMessageHandler?: unknown };

let loading: Promise<void> | null = null;

/** Custom-scheme origins (Tauri's tauri://) hit the null-origin worker path. */
const needsMainThreadWorker = (): boolean => {
  if (typeof window === 'undefined') return false;
  const protocol = window.location.protocol;
  return protocol !== 'http:' && protocol !== 'https:';
};

export const ensurePdfWorker = (): Promise<void> => {
  if (!needsMainThreadWorker()) return Promise.resolve();
  loading ??= import('foliate-js/vendor/pdfjs/pdf.worker.mjs')
    .then((module) => {
      (globalThis as { pdfjsWorker?: WorkerModule }).pdfjsWorker = module as WorkerModule;
    })
    .catch((error: unknown) => {
      // Fall back to the regular worker path instead of blocking the import.
      console.warn('pdf.js worker preload failed', error);
    });
  return loading;
};
