import { useEffect, useState } from 'react';
import { create } from 'zustand';

export type UiTheme = 'system' | 'light' | 'dark';
export type UiLocale = 'en' | 'fa';

interface UiStore {
  theme: UiTheme;
  locale: UiLocale;
  setTheme: (theme: UiTheme) => void;
  setLocale: (locale: UiLocale) => void;
}

const STORAGE_KEY = 'hamesh.ui.theme';
const LOCALE_KEY = 'hamesh.ui.locale';

const readTheme = (): UiTheme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // ignore
  }
  return 'system';
};

const readLocale = (): UiLocale => {
  try {
    if (localStorage.getItem(LOCALE_KEY) === 'fa') return 'fa';
  } catch {
    // ignore
  }
  return 'en';
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
  locale: readLocale(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage may be unavailable; the in-memory value still applies
    }
    applyTheme(theme);
    set({ theme });
  },
  setLocale: (locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // storage may be unavailable; the in-memory value still applies
    }
    set({ locale });
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

/** The app theme as it is actually rendered, reactive to system changes. */
export const useResolvedUiTheme = (): 'light' | 'dark' => {
  const theme = useUiStore((state) => state.theme);
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
};
