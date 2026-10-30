import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ReaderTheme = 'auto' | 'light' | 'sepia' | 'dark';
/** A theme resolved against the app theme; 'auto' maps to light or dark. */
export type ResolvedReaderTheme = Exclude<ReaderTheme, 'auto'>;
export type ReaderFlow = 'paginated' | 'scrolled';
export type ReaderFont = 'vazirmatn' | 'naskh' | 'literata' | 'sans' | 'serif';
export type PdfZoom = 'fit-page' | 'fit-width' | number;

export const READER_SETTINGS_VERSION = 3;

export const FONT_SIZE_MIN = 70;
export const FONT_SIZE_MAX = 180;
export const LINE_HEIGHT_MIN = 1.4;
export const LINE_HEIGHT_MAX = 2.4;
export const MARGIN_MIN = 0;
export const MARGIN_MAX = 64;
export const BRIGHTNESS_MIN = 40;
export const BRIGHTNESS_MAX = 100;

/**
 * v2: 'light' used to be the default, so most persisted readers have it
 * without ever choosing it. Map stored 'light' to 'auto' so the book follows
 * the app's dark mode; anyone who wants plain light re-picks it once.
 * v3 added the typography fields; persisted v2 state merges with the new
 * defaults, so no value conversion is needed here.
 */
export const migrateReaderSettings = (
  persisted: unknown,
  version: number,
): Partial<ReaderSettings> | undefined => {
  if (!persisted || typeof persisted !== 'object') return undefined;
  const state = { ...(persisted as Record<string, unknown>) };
  if (version < 2 && state.theme === 'light') state.theme = 'auto';
  return state as Partial<ReaderSettings>;
};

export interface ReaderSettings {
  fontSize: number;
  fontFamily: ReaderFont;
  /** Multiplier applied to the line height; 1.4–2.4. */
  lineHeight: number;
  /** Page padding in CSS pixels; 0–64. */
  margin: number;
  /** Screen brightness percentage; 40–100. */
  brightness: number;
  hyphenate: boolean;
  theme: ReaderTheme;
  justify: boolean;
  flow: ReaderFlow;
  pdfZoom: PdfZoom;
  increaseFont: () => void;
  decreaseFont: () => void;
  setFontFamily: (font: ReaderFont) => void;
  setLineHeight: (lineHeight: number) => void;
  setMargin: (margin: number) => void;
  setBrightness: (brightness: number) => void;
  toggleHyphenate: () => void;
  setTheme: (theme: ReaderTheme) => void;
  toggleJustify: () => void;
  setFlow: (flow: ReaderFlow) => void;
  setPdfZoom: (zoom: PdfZoom) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Device-local reader preferences. These never enter sync (ADR-0005); the
 * persist middleware keeps them in localStorage across launches.
 */
export const useReaderSettings = create<ReaderSettings>()(
  persist(
    (set) => ({
      fontSize: 100,
      fontFamily: 'vazirmatn',
      lineHeight: 1.9,
      margin: 16,
      brightness: 100,
      hyphenate: false,
      theme: 'auto',
      justify: true,
      flow: 'paginated',
      pdfZoom: 'fit-page',
      increaseFont: () =>
        set((state) => ({ fontSize: clamp(state.fontSize + 10, FONT_SIZE_MIN, FONT_SIZE_MAX) })),
      decreaseFont: () =>
        set((state) => ({ fontSize: clamp(state.fontSize - 10, FONT_SIZE_MIN, FONT_SIZE_MAX) })),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setLineHeight: (lineHeight) =>
        set({ lineHeight: clamp(lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX) }),
      setMargin: (margin) => set({ margin: clamp(margin, MARGIN_MIN, MARGIN_MAX) }),
      setBrightness: (brightness) =>
        set({ brightness: clamp(brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX) }),
      toggleHyphenate: () => set((state) => ({ hyphenate: !state.hyphenate })),
      setTheme: (theme) => set({ theme }),
      toggleJustify: () => set((state) => ({ justify: !state.justify })),
      setFlow: (flow) => set({ flow }),
      setPdfZoom: (pdfZoom) => set({ pdfZoom }),
      zoomIn: () =>
        set((state) => {
          const current = typeof state.pdfZoom === 'number' ? state.pdfZoom : 1;
          return { pdfZoom: Math.min(3, current + 0.25) };
        }),
      zoomOut: () =>
        set((state) => {
          const current = typeof state.pdfZoom === 'number' ? state.pdfZoom : 1;
          return { pdfZoom: Math.max(0.5, current - 0.25) };
        }),
    }),
    {
      name: 'hamesh.reader-settings',
      version: READER_SETTINGS_VERSION,
      migrate: migrateReaderSettings,
    },
  ),
);
