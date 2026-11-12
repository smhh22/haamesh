import { useEffect, useState } from 'react';
import { create } from 'zustand';

export type UiTheme = 'system' | 'light' | 'dark';
export type UiLocale = 'en' | 'fa';
export type LibraryView = 'grid' | 'list' | 'shelves';

interface UiStore {
  theme: UiTheme;
  locale: UiLocale;
  /** Library layout; the cover grid is the default (Readest-style). */
  viewMode: LibraryView;
  setViewMode: (view: LibraryView) => void;
  /**
   * Reader sidebar (Contents / Notes / Search) on wide windows; open by
   * default, remembered per device. Narrow windows always use sheets.
   */
  readerSidebar: boolean;
  setReaderSidebar: (open: boolean) => void;
  /** Library category sections the user collapsed (device-local). */
  collapsedGroups: string[];
  /**
   * Categories created from the library toolbar that no book carries yet;
   * categories are derived from books, so these need their own registry
   * (device-local, like collapsed state).
   */
  extraCategories: string[];
  /** Manual section order (device-local); names missing from it sort last. */
  categoryOrder: string[];
  setTheme: (theme: UiTheme) => void;
  setLocale: (locale: UiLocale) => void;
  toggleGroup: (key: string) => void;
  addExtraCategory: (name: string) => void;
  renameExtraCategory: (from: string, to: string) => void;
  removeExtraCategory: (name: string) => void;
  /** Persist the full displayed sequence (named categories only). */
  setCategoryOrder: (order: string[]) => void;
  renameCategoryOrder: (from: string, to: string) => void;
  purgeCategoryOrder: (name: string) => void;
}

const STORAGE_KEY = 'hamesh.ui.theme';
const LOCALE_KEY = 'hamesh.ui.locale';
const COLLAPSED_KEY = 'hamesh.ui.collapsed-groups';
const EXTRA_CATEGORIES_KEY = 'hamesh.ui.extra-categories';
const CATEGORY_ORDER_KEY = 'hamesh.ui.category-order';
const VIEW_KEY = 'hamesh.ui.view';
const READER_SIDEBAR_KEY = 'hamesh.ui.reader-sidebar';

const readViewMode = (): LibraryView => {
  try {
    // The cover grid is the default; list and shelves are explicit choices.
    const stored = localStorage.getItem(VIEW_KEY);
    return stored === 'list' || stored === 'shelves' ? stored : 'grid';
  } catch {
    return 'grid';
  }
};

const readReaderSidebar = (): boolean => {
  try {
    // Absent key = the default (open); only an explicit 'closed' hides it.
    return localStorage.getItem(READER_SIDEBAR_KEY) !== 'closed';
  } catch {
    return true;
  }
};

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

const readStringList = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
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
  collapsedGroups: readStringList(COLLAPSED_KEY),
  extraCategories: readStringList(EXTRA_CATEGORIES_KEY),
  categoryOrder: readStringList(CATEGORY_ORDER_KEY),
  viewMode: readViewMode(),
  readerSidebar: readReaderSidebar(),
  setViewMode: (view) => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // storage may be unavailable; the in-memory value still applies
    }
    set({ viewMode: view });
  },
  setReaderSidebar: (open) => {
    try {
      localStorage.setItem(READER_SIDEBAR_KEY, open ? 'open' : 'closed');
    } catch {
      // storage may be unavailable; the in-memory value still applies
    }
    set({ readerSidebar: open });
  },
  toggleGroup: (key) =>
    set((state) => {
      const next = state.collapsedGroups.includes(key)
        ? state.collapsedGroups.filter((item) => item !== key)
        : [...state.collapsedGroups, key];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // storage may be unavailable; the in-memory value still applies
      }
      return { collapsedGroups: next };
    }),
  addExtraCategory: (name) =>
    set((state) => {
      const trimmed = name.trim();
      if (trimmed === '' || state.extraCategories.includes(trimmed)) return {};
      const next = [...state.extraCategories, trimmed];
      try {
        localStorage.setItem(EXTRA_CATEGORIES_KEY, JSON.stringify(next));
      } catch {
        // storage may be unavailable; the in-memory value still applies
      }
      return { extraCategories: next };
    }),
  renameExtraCategory: (from, to) =>
    set((state) => {
      if (!state.extraCategories.includes(from)) return {};
      const trimmed = to.trim();
      const next =
        trimmed !== '' && !state.extraCategories.includes(trimmed)
          ? state.extraCategories.map((item) => (item === from ? trimmed : item))
          : state.extraCategories.filter((item) => item !== from);
      try {
        localStorage.setItem(EXTRA_CATEGORIES_KEY, JSON.stringify(next));
      } catch {
        // storage may be unavailable; the in-memory value still applies
      }
      return { extraCategories: next };
    }),
  removeExtraCategory: (name) =>
    set((state) => {
      if (!state.extraCategories.includes(name)) return {};
      const next = state.extraCategories.filter((item) => item !== name);
      try {
        localStorage.setItem(EXTRA_CATEGORIES_KEY, JSON.stringify(next));
      } catch {
        // storage may be unavailable; the in-memory value still applies
      }
      return { extraCategories: next };
    }),
  /** Drop `name` before `before` (null = end of the ordered list). */
  setCategoryOrder: (order) => {
    try {
      localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(order));
    } catch {
      // storage may be unavailable; the in-memory value still applies
    }
    set({ categoryOrder: [...order] });
  },
  renameCategoryOrder: (from, to) =>
    set((state) => {
      if (!state.categoryOrder.includes(from)) return {};
      const trimmed = to.trim();
      const next =
        trimmed !== '' && !state.categoryOrder.includes(trimmed)
          ? state.categoryOrder.map((item) => (item === from ? trimmed : item))
          : state.categoryOrder.filter((item) => item !== from);
      try {
        localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(next));
      } catch {
        // storage may be unavailable; the in-memory value still applies
      }
      return { categoryOrder: next };
    }),
  purgeCategoryOrder: (name) =>
    set((state) => {
      if (!state.categoryOrder.includes(name)) return {};
      const next = state.categoryOrder.filter((item) => item !== name);
      try {
        localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(next));
      } catch {
        // storage may be unavailable; the in-memory value still applies
      }
      return { categoryOrder: next };
    }),
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
