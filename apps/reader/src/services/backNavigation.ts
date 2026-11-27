/**
 * System back (Android) and the browser Back button both surface as history
 * pops. wry's WryActivity delegates BACK to the WebView when it can go back
 * and only finishes the activity otherwise (wry/src/android/kotlin/
 * WryActivity.kt), so a single-page app that never touches history exits the
 * app instead of closing the screen the user is on (ADR-0029).
 *
 * Each armed guard owns exactly one history entry. Popping it closes that
 * screen; closing the screen from the UI disarms the guard and drops the entry
 * again without firing any handler.
 */

type BackHandler = () => void;

interface Entry {
  handler: BackHandler;
  /** True once a history pop has taken this entry, so cleanup must not pop again. */
  popped: boolean;
}

const entries: Entry[] = [];

/** Pops caused by our own disarm; they must not close anything else. */
let programmaticPops = 0;
let listening = false;
/**
 * Disarms are deferred by a tick. React's StrictMode runs an effect, cleans it
 * up and runs it again, so an immediate pop would eat the entry of the screen
 * that just re-armed and close it on its own.
 */
let pendingPop: number | null = null;

const cancelScheduledPop = () => {
  if (pendingPop === null) return;
  window.clearTimeout(pendingPop);
  pendingPop = null;
};

const schedulePop = () => {
  if (pendingPop !== null) return;
  pendingPop = window.setTimeout(() => {
    pendingPop = null;
    programmaticPops += 1;
    window.history.back();
  }, 0);
};

const onPopState = () => {
  if (programmaticPops > 0) {
    programmaticPops -= 1;
    return;
  }
  const entry = entries.pop();
  if (!entry) return;
  entry.popped = true;
  entry.handler();
};

const ensureListener = () => {
  if (listening) return;
  window.addEventListener('popstate', onPopState);
  listening = true;
};

/**
 * Arm a back guard for one screen. Returns the disarm function; calling it
 * after the pop already happened is a no-op, so a screen handled by the back
 * gesture can still run its normal close path.
 */
export const armBackGuard = (onBack: BackHandler): (() => void) => {
  ensureListener();
  // A re-arm in the same tick means the screen never really left.
  cancelScheduledPop();
  const entry: Entry = { handler: onBack, popped: false };
  entries.push(entry);
  window.history.pushState({ hameshBack: entries.length }, '');

  return () => {
    const index = entries.indexOf(entry);
    if (index < 0) return;
    entries.splice(index, 1);
    // The pop that consumed the entry already moved history back; popping
    // again here would leave the app itself (the e2e caught exactly that).
    if (entry.popped) return;
    schedulePop();
  };
};
