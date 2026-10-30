import { create } from 'zustand';

export type UiTheme = 'system' | 'light' | 'dark';

interface UiStore {
  theme: UiTheme;
  setTheme: (theme: UiTheme) => void;
}

const STORAGE_KEY = 'hamesh.ui.theme';

const readTheme = (): UiTheme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // ignore
  }
  return 'system';
};

const resolveTheme = (theme: UiTheme): 'light' | 'dark' => {
  if (theme !== 'system') return theme;
  if (typeof matchMedia !== 'function') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** Paint the resolved theme on <html> so CSS variables switch. */
export const applyTheme = (theme: UiTheme): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(theme);
};

export const useUiStore = create<UiStore>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage may be unavailable; the in-memory value still applies
    }
    applyTheme(theme);
    set({ theme });
  },
}));

/** Call once at startup: apply the saved theme and follow the system when set. */
export const initUiTheme = (): void => {
  applyTheme(useUiStore.getState().theme);
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (useUiStore.getState().theme === 'system') applyTheme('system');
    });
  }
};
