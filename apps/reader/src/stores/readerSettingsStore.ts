import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFlow = 'paginated' | 'scrolled';
export type PdfZoom = 'fit-page' | 'fit-width' | number;

export interface ReaderSettings {
  fontSize: number;
  theme: ReaderTheme;
  justify: boolean;
  flow: ReaderFlow;
  pdfZoom: PdfZoom;
  increaseFont: () => void;
  decreaseFont: () => void;
  setTheme: (theme: ReaderTheme) => void;
  toggleJustify: () => void;
  setFlow: (flow: ReaderFlow) => void;
  setPdfZoom: (zoom: PdfZoom) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

/**
 * Device-local reader preferences. These never enter sync (ADR-0005); the
 * persist middleware keeps them in localStorage across launches.
 */
export const useReaderSettings = create<ReaderSettings>()(
  persist(
    (set) => ({
      fontSize: 100,
      theme: 'light',
      justify: true,
      flow: 'paginated',
      pdfZoom: 'fit-page',
      increaseFont: () => set((state) => ({ fontSize: Math.min(180, state.fontSize + 10) })),
      decreaseFont: () => set((state) => ({ fontSize: Math.max(70, state.fontSize - 10) })),
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
    { name: 'hamesh.reader-settings' },
  ),
);
