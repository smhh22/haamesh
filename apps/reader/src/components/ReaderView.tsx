import type { Locator, TocItem } from '@hamesh/core';
import {
  applyPdfHighlights,
  asDomElement,
  createTranslationBlock,
  fillTranslationBlock,
  fillTranslationBlockError,
  findAttachedTranslation,
  findTranslatableBlock,
  isCopyTarget,
  isRtlLanguage,
  isSanitizableMediaType,
  PDF_OVERLAY_ID,
  type PdfHighlightDraft,
  pageTurnForKey,
  pdfLocatorMatchesPage,
  pdfOccurrenceIndex,
  profilePdfText,
  removeTranslationBlock,
  sanitizeEpubHtml,
  translationBlockAt,
  translationText,
} from '@hamesh/engine';
import type { BookNoteRecord, BookRecord } from '@hamesh/storage';
import { Overlayer } from 'foliate-js/overlayer.js';
import { type FoliateBook, makeBook } from 'foliate-js/view.js';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { locatorFromRelocate, type RelocateDetail } from '../readerLocator';
import { buildReaderCss } from '../readerStyles';
import { loadAiSettings } from '../services/aiSettings';
import { persistBookLanguage, persistNoteRecord } from '../services/libraryPersistence';
import { translateText } from '../services/translateService';
import { useLibraryStore } from '../stores/libraryStore';
import { notesForBook, useNotesStore } from '../stores/notesStore';
import { type ResolvedReaderTheme, useReaderSettings } from '../stores/readerSettingsStore';
import { useResolvedUiTheme, useUiStore } from '../stores/uiStore';
import { NotesPanel } from './reader/NotesPanel';
import { SearchPanel } from './reader/SearchPanel';
import { SelectionPopover, type SelectionTranslationState } from './reader/SelectionPopover';
import { SettingsPanel } from './reader/SettingsPanel';
import { TocTree } from './reader/TocTree';

interface FoliateRenderer {
  getContents(): Array<{ doc: Document; index: number }>;
  setAttribute(name: string, value: string): void;
  render?(): void;
  /** Repaints the paginator gutter/filter from the document background. */
  setStyles?(styles: string): void;
}

interface FoliateViewElement extends HTMLElement {
  renderer?: FoliateRenderer;
  open(book: FoliateBook): Promise<void>;
  init(options?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<{ index: number; anchor: unknown } | undefined>;
  next(): Promise<void>;
  prev(): Promise<void>;
  close(): void;
  getCFI(index: number, range: Range): string;
  addAnnotation(annotation: {
    value: string;
    [key: string]: unknown;
  }): Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
  search(options: { query: string; index?: number }): AsyncIterable<unknown>;
  clearSearch(): void;
}

export interface ReaderViewProps {
  book: BookRecord;
  file: File;
  initialLocation?: string | null;
  initialPage?: number | null;
  initialFraction?: number;
  onProgress?: (state: { locator: Locator | null; fraction: number }) => void;
  onClose: () => void;
}

import type { SearchResult, SelectionInfo } from './reader/types';

type ReaderPanel = 'toc' | 'notes' | 'search' | 'settings' | null;

const READER_STYLE_ID = 'hamesh-reader-style';
const DEFAULT_HIGHLIGHT = '#f2c94c';

const applyReaderStyle = (doc: Document, css: string): void => {
  let style = doc.getElementById(READER_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = READER_STYLE_ID;
    (doc.head ?? doc.documentElement).append(style);
  }
  style.textContent = css;
};

export const ReaderView = ({
  book,
  file,
  initialLocation,
  initialPage,
  initialFraction = 0,
  onProgress,
  onClose,
}: ReaderViewProps) => {
  const { t, i18n } = useTranslation();
  const settings = useReaderSettings();
  // Docked sidebar on wide windows (device-local preference; design pass).
  const wideWindow = useMediaQuery('(min-width: 64rem)');
  const sidebarOpen = useUiStore((state) => state.readerSidebar);
  const setReaderSidebar = useUiStore((state) => state.setReaderSidebar);
  const sidebarVisible = wideWindow && sidebarOpen;
  const allNotes = useNotesStore((state) => state.notes);
  const addNote = useNotesStore((state) => state.add);
  const updateNote = useNotesStore((state) => state.update);
  const removeNote = useNotesStore((state) => state.remove);
  const bookNotes = useMemo(() => notesForBook(allNotes, book.id), [allNotes, book.id]);
  const isPdf = book.format === 'pdf';
  // 'auto' follows the app theme so a dark app opens a dark book.
  const resolvedAppTheme = useResolvedUiTheme();
  const readerTheme: ResolvedReaderTheme =
    settings.theme === 'auto' ? resolvedAppTheme : settings.theme;

  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const onProgressRef = useRef(onProgress);
  // Latest keydown handler; book iframe documents forward their key events to
  // it because keys pressed inside an iframe never reach the parent window.
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const notesRef = useRef<BookNoteRecord[]>(bookNotes);
  const buildCss = () =>
    buildReaderCss({
      fontSize: settings.fontSize,
      theme: readerTheme,
      justify: settings.justify,
      fontFamily: settings.fontFamily,
      lineHeight: settings.lineHeight,
      hyphenate: settings.hyphenate,
      flow: settings.flow,
      margin: settings.margin,
    });
  const settingsCssRef = useRef(buildCss());
  const flowRef = useRef(settings.flow);
  const marginRef = useRef(settings.margin);
  // Book direction behind a ref, like the settings above: detecting it for a
  // PDF must not reopen the book (the open effect depends on the ref, not the
  // record), while page turns and newly loaded pages pick it up immediately.
  const directionRef = useRef(book.direction);
  const lastCfiRef = useRef<string | null>(null);
  const lastFractionRef = useRef(initialFraction);
  const [progress, setProgress] = useState(initialFraction);
  const [pageInfo, setPageInfo] = useState<{ current: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const [panel, setPanel] = useState<ReaderPanel>(null);
  const panelButtonRefs = useRef<Record<Exclude<ReaderPanel, null>, HTMLButtonElement | null>>({
    toc: null,
    notes: null,
    search: null,
    settings: null,
  });
  const lastPanel = useRef<Exclude<ReaderPanel, null> | null>(null);
  // Latest PDF highlight lookup; called from the open-book effect without
  // re-opening the book when the note set changes.
  const pdfHighlightsRef = useRef<(index: number) => PdfHighlightDraft[]>(() => []);
  // Loaded PDF page documents (the fixed-layout renderer does not expose them
  // through getContents); pruned when their iframe detaches.
  const pdfPageDocsRef = useRef<Map<number, Document>>(new Map());
  // Language/direction detection for PDFs without metadata: the first rendered
  // text layers are sampled once per session and persisted when confident.
  const pdfLanguageAttemptsRef = useRef(0);
  // Latest detection callback; the open-book effect calls it through this ref
  // so a changed definition never reopens the book.
  const pdfLanguageDetectRef = useRef<() => void>(() => {});
  const updateBook = useLibraryStore((state) => state.updateBook);
  // Mirror of the book record for callbacks that must read the latest
  // metadata without reopening the book.
  const bookRef = useRef(book);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    pdfLanguageDetectRef.current = tryDetectPdfLanguage;
  });

  /**
   * Sample the first rendered PDF text layers and fill in language and
   * direction when the record has neither: PDFs rarely carry language
   * metadata, so the importer leaves them unknown. Runs only while the user
   * has not set these fields (language unset, importer default direction) and
   * gives up after a few unconfident samples.
   */
  const tryDetectPdfLanguage = (): void => {
    if (pdfLanguageAttemptsRef.current >= 3) return;
    const current = bookRef.current;
    if (current.language !== null || current.direction !== 'ltr') {
      pdfLanguageAttemptsRef.current = 3;
      return;
    }
    const indices = [...pdfPageDocsRef.current.keys()].sort((a, b) => a - b).slice(0, 2);
    if (indices.length === 0) return;
    const sample = indices
      .map((index) => {
        const layer = pdfPageDocsRef.current.get(index)?.querySelector('.textLayer');
        return layer?.textContent ?? '';
      })
      .join(' ');
    if (sample.trim().length < 40) return;
    pdfLanguageAttemptsRef.current += 1;
    const profile = profilePdfText(sample);
    if (profile.language === null) return;
    pdfLanguageAttemptsRef.current = 3;
    updateBook(current.id, { language: profile.language, direction: profile.direction });
    void persistBookLanguage(current, profile.language, profile.direction);
  };

  // Closing a panel unmounts its close button; return focus to the toolbar
  // button that opened it so keyboard users keep their place.
  useEffect(() => {
    if (panel) {
      lastPanel.current = panel;
      return;
    }
    const previous = lastPanel.current;
    if (!previous) return;
    lastPanel.current = null;
    panelButtonRefs.current[previous]?.focus();
  }, [panel]);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [translation, setTranslation] = useState<SelectionTranslationState | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    notesRef.current = bookNotes;
  }, [bookNotes]);

  useEffect(() => {
    directionRef.current = book.direction;
  }, [book.direction]);

  // Redraw PDF highlights whenever the note set changes; each page's overlay
  // is rebuilt from the live text layer.
  useEffect(() => {
    if (!isPdf || !ready) return;
    for (const [index, doc] of pdfPageDocsRef.current) {
      if (!doc.defaultView) {
        pdfPageDocsRef.current.delete(index);
        continue;
      }
      applyPdfHighlights(doc, pdfHighlightsRef.current(index));
    }
  });

  const pdfHighlightsForPage = (index: number): PdfHighlightDraft[] =>
    bookNotes
      .filter(
        (note) =>
          note.deletedAt === null &&
          note.type !== 'bookmark' &&
          pdfLocatorMatchesPage(note.locator, index),
      )
      .map((note) => {
        const locator = note.locator as Extract<Locator, { kind: 'pdf' }>;
        return {
          id: note.id,
          color: note.color ?? DEFAULT_HIGHLIGHT,
          text: locator.text,
          occurrence: locator.occurrence,
        };
      });
  pdfHighlightsRef.current = pdfHighlightsForPage;

  useEffect(() => {
    const view = viewRef.current;
    if (isPdf) {
      view?.renderer?.setAttribute('zoom', String(settings.pdfZoom));
      return;
    }
    const css = buildReaderCss({
      fontSize: settings.fontSize,
      theme: readerTheme,
      justify: settings.justify,
      fontFamily: settings.fontFamily,
      lineHeight: settings.lineHeight,
      hyphenate: settings.hyphenate,
      flow: settings.flow,
      margin: settings.margin,
    });
    settingsCssRef.current = css;
    flowRef.current = settings.flow;
    marginRef.current = settings.margin;

    if (!view?.renderer) return;

    for (const { doc } of view.renderer.getContents()) {
      applyReaderStyle(doc, css);
    }
    view.renderer.setAttribute('flow', settings.flow);
    // The paginator reads its page margin from this attribute; it must be set
    // before render() measures the columns.
    view.renderer.setAttribute('margin', `${settings.margin}px`);
    view.renderer.render?.();
    // The paginator caches the document background for its gutter and only
    // refreshes it from setStyles(); without this, changing the theme leaves
    // light bands around a dark page.
    view.renderer.setStyles?.('');

    const cfi = lastCfiRef.current;
    if (cfi) {
      requestAnimationFrame(() => {
        void view.goTo(cfi);
      });
    }
  }, [settings, isPdf, readerTheme]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    let parsedBook: FoliateBook | null = null;
    const view = document.createElement('foliate-view') as FoliateViewElement;
    viewRef.current = view;
    stage.append(view);

    const applyNote = (note: BookNoteRecord) => {
      if (isPdf || note.type === 'bookmark' || note.locator.kind !== 'cfi') return;
      viewRef.current
        ?.addAnnotation({
          value: note.locator.cfi,
          color: note.color ?? DEFAULT_HIGHLIGHT,
          id: note.id,
        })
        .catch((error: unknown) => {
          console.error('Failed to redraw annotation', note.id, error);
        });
    };

    const onDrawAnnotation = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          draw: (
            draw: (rects: DOMRect[], options?: { color?: string }) => Element,
            options: { color?: string },
          ) => void;
          annotation: { color?: string | null };
        }>
      ).detail;
      // The overlayer SVG lives in a closed shadow root, so tests observe this
      // counter instead of querying the drawn shapes.
      const stage = stageRef.current;
      if (stage) {
        stage.dataset.annotationsDrawn = String(Number(stage.dataset.annotationsDrawn ?? '0') + 1);
      }
      detail.draw(Overlayer.highlight, { color: detail.annotation.color ?? DEFAULT_HIGHLIGHT });
    };

    const onRelocate = (event: Event) => {
      const detail = (event as CustomEvent<RelocateDetail & { tocItem?: { href?: string } | null }>)
        .detail;

      if (typeof detail?.section?.current === 'number') {
        setPageInfo({
          current: detail.section.current + 1,
          total: detail.section.total ?? 0,
        });
      }

      const locator = detail ? locatorFromRelocate(detail, isPdf) : null;
      if (typeof detail?.fraction === 'number' && Number.isFinite(detail.fraction)) {
        const fraction = Math.min(1, Math.max(0, detail.fraction));
        lastFractionRef.current = fraction;
        setProgress(fraction);
        if (locator) onProgressRef.current?.({ locator, fraction });
      }
      if (locator?.kind === 'cfi') lastCfiRef.current = locator.cfi;
      if (detail?.tocItem?.href) setActiveHref(detail.tocItem.href);
      setSelection(null);
      setTranslation(null);
      setNoteMode(false);
    };

    const onLoad = (event: Event) => {
      setReady(true);
      const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
      const doc = detail?.doc;
      if (!doc) return;
      const pageIndex = detail?.index ?? 0;

      // The iframe owns focus once the reader clicks the text; forward its
      // keydowns for both formats.
      doc.addEventListener('keydown', (event) => keyHandlerRef.current(event));

      if (isPdf) {
        pdfPageDocsRef.current.set(pageIndex, doc);
        applyPdfHighlights(doc, pdfHighlightsRef.current(pageIndex));
        // The text layer renders asynchronously after this load event; redraw
        // whenever it changes, ignoring mutations of our own overlay.
        const layer = doc.querySelector('.textLayer');
        const view_ = doc.defaultView;
        if (layer && view_) {
          const observer = new view_.MutationObserver((records) => {
            const own = records.every((record) => {
              const target = record.target as Element;
              return (
                target.id === PDF_OVERLAY_ID || Boolean(target.closest?.(`#${PDF_OVERLAY_ID}`))
              );
            });
            if (!own) {
              applyPdfHighlights(doc, pdfHighlightsRef.current(pageIndex));
              pdfLanguageDetectRef.current();
            }
          });
          observer.observe(layer, { childList: true, subtree: true });
        }
        pdfLanguageDetectRef.current();
        let pdfSelectionTimer: number | undefined;
        const capturePdfSelection = () => {
          const selected = doc.getSelection();
          if (!selected || selected.isCollapsed || selected.rangeCount === 0) return;
          const range = selected.getRangeAt(0);
          const raw = selected.toString();
          if (!raw.trim()) return;
          const layer = doc.querySelector('.textLayer');
          if (!layer) return;
          const occurrence = pdfOccurrenceIndex(layer, range, raw);
          if (occurrence < 0) return;
          const rect = range.getBoundingClientRect();
          const frameRect = doc.defaultView?.frameElement?.getBoundingClientRect();
          setSelection({
            x: Math.min(window.innerWidth - 260, Math.max(8, (frameRect?.left ?? 0) + rect.left)),
            y: Math.min(
              window.innerHeight - 180,
              Math.max(8, (frameRect?.top ?? 0) + rect.bottom + 8),
            ),
            text: raw.trim(),
            fraction: lastFractionRef.current,
            pdf: { page: pageIndex + 1, text: raw, occurrence },
          });
        };
        const onPdfSelection = () => {
          window.clearTimeout(pdfSelectionTimer);
          pdfSelectionTimer = window.setTimeout(capturePdfSelection, 120);
        };
        doc.addEventListener('selectionchange', onPdfSelection);
        doc.addEventListener('pointerup', onPdfSelection);
        // Right-click over a selection must offer the same actions as the
        // selection popover instead of the browser menu.
        doc.addEventListener('contextmenu', (event) => {
          const selected = doc.getSelection();
          if (!selected || selected.isCollapsed || selected.rangeCount === 0) return;
          if (!selected.toString().trim()) return;
          event.preventDefault();
          capturePdfSelection();
        });
        // Ctrl+wheel zooms the page like the +/- keys; the listener lives on
        // the page document because iframe wheel events never reach the
        // parent window, and it must be cancellable to beat browser zoom.
        doc.addEventListener(
          'wheel',
          (event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            const zoom = useReaderSettings.getState();
            if (event.deltaY < 0) zoom.zoomIn();
            else zoom.zoomOut();
          },
          { passive: false },
        );
        return;
      }

      // Books without their own dir attribute paginate by our resolved
      // direction; this runs before the renderer measures layout. The ref is
      // read at page-load time so a mid-session detection applies to pages
      // opened afterwards without reopening the book.
      if (!doc.documentElement.hasAttribute('dir')) {
        doc.documentElement.dir = directionRef.current;
      }
      applyReaderStyle(doc, settingsCssRef.current);
      for (const note of notesRef.current) applyNote(note);

      let timer: number | undefined;
      const captureSelection = () => {
        const selected = doc.getSelection();
        if (!selected || selected.isCollapsed || selected.rangeCount === 0) return;
        const text = selected.toString().trim();
        if (!text) return;

        const range = selected.getRangeAt(0);
        const content = view.renderer?.getContents().find((item) => item.doc === doc);
        if (!content) return;

        const cfi = view.getCFI(content.index, range);
        const rect = range.getBoundingClientRect();
        const frameRect = doc.defaultView?.frameElement?.getBoundingClientRect();

        setSelection({
          x: Math.min(window.innerWidth - 260, Math.max(8, (frameRect?.left ?? 0) + rect.left)),
          y: Math.min(
            window.innerHeight - 180,
            Math.max(8, (frameRect?.top ?? 0) + rect.bottom + 8),
          ),
          cfi,
          text,
          fraction: lastFractionRef.current,
        });
      };
      const onChange = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(captureSelection, 120);
      };

      doc.addEventListener('selectionchange', onChange);
      doc.addEventListener('pointerup', onChange);
      // Right-click over a selection must offer the same actions as the
      // selection popover instead of the browser menu.
      doc.addEventListener('contextmenu', (event) => {
        const selected = doc.getSelection();
        if (!selected || selected.isCollapsed || selected.rangeCount === 0) return;
        if (!selected.toString().trim()) return;
        event.preventDefault();
        captureSelection();
      });

      // Tap-to-translate: only a tap that neither moved (a drag selecting text)
      // nor left a selection behind, and not a link/media/control tap. The
      // small delay lets selectionchange settle first.
      let tapStart: { x: number; y: number } | null = null;
      let tapTimer: number | undefined;
      doc.addEventListener('pointerdown', (event) => {
        tapStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
      });
      doc.addEventListener('pointerup', (event) => {
        const start = tapStart;
        tapStart = null;
        if (!start || event.button !== 0) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
        const target = event.target;
        window.clearTimeout(tapTimer);
        tapTimer = window.setTimeout(() => {
          const selected = doc.getSelection();
          if (selected && !selected.isCollapsed && selected.toString().trim()) return;
          tapTranslateRef.current(target);
        }, 60);
      });
    };

    const onShowAnnotation = (event: Event) => {
      if (isPdf) return;
      const detail = (event as CustomEvent<{ value?: string }>).detail;
      if (!detail?.value) return;
      const note = notesRef.current.find(
        (item) => item.locator.kind === 'cfi' && item.locator.cfi === detail.value,
      );
      if (!note) return;
      setPanel('notes');
      setEditingNoteId(note.id);
      setEditDraft(note.note ?? '');
    };

    const onData = (event: Event) => {
      const detail = (event as CustomEvent<{ data: string | Promise<string>; type: string }>)
        .detail;
      // Normalize media types: spine items may carry parameters or differ in
      // case, and SVG documents can run script too. Every such document must
      // pass through the sanitizer.
      if (isSanitizableMediaType(detail.type)) {
        detail.data = Promise.resolve(detail.data).then(sanitizeEpubHtml);
      }
    };

    const blockExternalLink = (event: Event) => {
      event.preventDefault();
    };

    view.addEventListener('draw-annotation', onDrawAnnotation);
    view.addEventListener('relocate', onRelocate);
    view.addEventListener('load', onLoad);
    view.addEventListener('show-annotation', onShowAnnotation);
    view.addEventListener('external-link', blockExternalLink);

    void (async () => {
      try {
        const parsed = await makeBook(file);
        if (cancelled) {
          parsed.destroy();
          return;
        }
        parsedBook = parsed;
        parsed.transformTarget?.addEventListener('data', onData);
        setToc((parsed.toc ?? []) as TocItem[]);

        await view.open(parsed);
        await view.init({
          lastLocation:
            isPdf && initialPage != null ? initialPage - 1 : initialLocation || undefined,
          showTextStart: true,
        });

        if (!isPdf) {
          view.renderer?.setAttribute('flow', flowRef.current);
          view.renderer?.setAttribute('margin', `${marginRef.current}px`);
          for (const { doc } of view.renderer?.getContents() ?? []) {
            applyReaderStyle(doc, settingsCssRef.current);
          }
          for (const note of notesRef.current) applyNote(note);
        }
      } catch (error) {
        console.error('Failed to open book', error);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      view.removeEventListener('draw-annotation', onDrawAnnotation);
      view.removeEventListener('relocate', onRelocate);
      view.removeEventListener('load', onLoad);
      view.removeEventListener('show-annotation', onShowAnnotation);
      view.removeEventListener('external-link', blockExternalLink);
      try {
        view.close();
      } catch {
        // The view may not have finished opening; removing the element is enough.
      }
      // foliate's close() destroys the renderer but not the parsed book; for
      // PDFs book.destroy() terminates the pdf.js worker and frees the
      // document, and EPUB sections release their documents/blobs.
      try {
        parsedBook?.destroy();
      } catch {
        // Already destroyed (cancelled while opening).
      }
      parsedBook = null;
      view.remove();
      viewRef.current = null;
    };
  }, [file, initialLocation, initialPage, isPdf]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Dialogs (for example the shortcut map) own Escape and typing keys.
      if (target?.closest('[role="dialog"]')) return;

      if (event.key === 'Escape') {
        if (panel && !sidebarVisible) {
          setPanel(null);
          viewRef.current?.clearSearch();
          event.preventDefault();
        } else if (sidebarVisible) {
          setReaderSidebar(false);
          setPanel(null);
          viewRef.current?.clearSearch();
          event.preventDefault();
        } else {
          onClose();
        }
        return;
      }

      if (target?.closest('input, select, textarea, button')) return;

      if (
        isPdf &&
        (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_')
      ) {
        event.preventDefault();
        if (event.key === '+' || event.key === '=') useReaderSettings.getState().zoomIn();
        else useReaderSettings.getState().zoomOut();
        return;
      }

      if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const view = viewRef.current;
        if (!view) return;
        void (event.shiftKey ? view.prev() : view.next());
        return;
      }

      const turn = pageTurnForKey(event.key, book.direction);
      if (!turn) return;
      event.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      void (turn === 'next' ? view.next() : view.prev());
    };
    keyHandlerRef.current = onKeyDown;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel, onClose, book.direction, isPdf, sidebarVisible, setReaderSidebar]);

  const turn = (action: 'next' | 'prev') => {
    const view = viewRef.current;
    if (!view) return;
    void (action === 'next' ? view.next() : view.prev());
  };

  const goToToc = (href: string) => {
    const view = viewRef.current;
    if (!view) return;
    setActiveHref(href);
    void view.goTo(href);
  };

  const togglePanel = (next: Exclude<ReaderPanel, null>) => {
    if (panel === 'search' && next !== 'search') viewRef.current?.clearSearch();
    if (sidebarVisible) {
      // Docked mode: the toolbar switches tabs; clicking the active tab
      // hides the sidebar.
      if (panel === next) setReaderSidebar(false);
      else setPanel(next);
      return;
    }
    if (panel === next && next === 'search') viewRef.current?.clearSearch();
    if (panel === next) {
      setPanel(null);
      return;
    }
    // Re-opening on a wide window docks it again.
    setPanel(next);
    if (wideWindow) setReaderSidebar(true);
  };

  const closePanel = () => {
    if (panel === 'search') viewRef.current?.clearSearch();
    // Hiding the dock also clears the active tab so the focus-return effect
    // (panel -> null) hands focus back to the toolbar button.
    setReaderSidebar(false);
    setPanel(null);
  };

  const createNoteRecord = (input: {
    type: BookNoteRecord['type'];
    color: string | null;
    text: string | null;
    note: string | null;
    locator: Locator;
  }): BookNoteRecord => ({
    id: crypto.randomUUID(),
    bookId: book.id,
    type: input.type,
    locator: input.locator,
    color: input.color,
    text: input.text,
    note: input.note,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  });

  const applyAnnotation = (note: BookNoteRecord) => {
    if (note.type === 'bookmark' || note.locator.kind !== 'cfi') return;
    void viewRef.current?.addAnnotation({
      value: note.locator.cfi,
      color: note.color ?? DEFAULT_HIGHLIGHT,
      id: note.id,
    });
  };

  const selectionLocator = (): Locator | null => {
    if (!selection) return null;
    if (selection.pdf) {
      return {
        kind: 'pdf',
        page: selection.pdf.page,
        text: selection.pdf.text,
        occurrence: selection.pdf.occurrence,
        fraction: selection.fraction,
      };
    }
    return selection.cfi ? { kind: 'cfi', cfi: selection.cfi, fraction: selection.fraction } : null;
  };

  const saveSelectionHighlight = (color: string) => {
    if (!selection) return;
    const locator = selectionLocator();
    if (!locator) return;
    const note = createNoteRecord({
      type: 'highlight',
      color,
      text: selection.text,
      note: null,
      locator,
    });
    addNote(note);
    applyAnnotation(note);
    void persistNoteRecord(note);
    setSelection(null);
    setNoteMode(false);
    setNoteDraft('');
  };

  const translateSelection = async () => {
    if (!selection) return;
    setTranslation({ status: 'loading' });
    const settings = loadAiSettings(useUiStore.getState().locale);
    try {
      const outcome = await translateText({
        text: selection.text,
        sourceLang: book.language ?? 'auto',
        targetLang: settings.targetLang,
        bookTitle: book.title,
        bookAuthor: book.authors[0] ?? null,
      });
      setTranslation({
        status: 'done',
        text: outcome.text,
        providerLabel: outcome.providerLabel,
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'PROVIDER_ERROR';
      setTranslation({ status: 'error', errorCode: code });
    }
  };

  const copySelectionTranslation = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
    }
  };

  /**
   * Opt-in tap-to-translate (ADR-0016): a plain tap on a paragraph inserts its
   * translation below it. Tapping the paragraph again (or the block itself)
   * removes the block. The setting is read per tap so enabling it in settings
   * does not require reopening the book.
   */
  const tapTranslateRef = useRef<(target: EventTarget | null) => void>(() => {});
  const handleParagraphTap = (target: EventTarget | null): void => {
    // Book iframe nodes belong to another realm; `instanceof Element` fails.
    const element = asDomElement(target);
    if (!element?.isConnected) return;
    const settings = loadAiSettings(useUiStore.getState().locale);
    if (!settings.tapToTranslate || isPdf) return;

    if (isCopyTarget(target)) {
      const block = translationBlockAt(target);
      const text = block ? translationText(block) : '';
      if (text) copySelectionTranslation(text);
      return;
    }

    const attached = translationBlockAt(target);
    if (attached) {
      removeTranslationBlock(attached);
      return;
    }

    const block = findTranslatableBlock(target);
    if (!block) return;
    const existing = findAttachedTranslation(block);
    if (existing) {
      removeTranslationBlock(existing);
      return;
    }

    const text = block.textContent?.trim() ?? '';
    if (!text) return;
    const targetLang = settings.targetLang;
    const current = bookRef.current;
    const aside = createTranslationBlock(block, {
      lang: targetLang,
      dir: isRtlLanguage(targetLang) ? 'rtl' : 'ltr',
      labels: {
        loading: i18n.t('reader.translating'),
        heading: i18n.t('reader.translation'),
        copy: i18n.t('reader.copy'),
      },
    });
    void translateText({
      text,
      sourceLang: current.language ?? 'auto',
      targetLang,
      bookTitle: current.title,
      bookAuthor: current.authors[0] ?? null,
    })
      .then((outcome) => {
        // The section may have unloaded while the request was in flight.
        if (!aside.isConnected) return;
        fillTranslationBlock(aside, { text: outcome.text, provider: outcome.providerLabel });
      })
      .catch((error: unknown) => {
        if (!aside.isConnected) return;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code: unknown }).code)
            : 'PROVIDER_ERROR';
        fillTranslationBlockError(
          aside,
          i18n.t(`ai.errors.${code}`, { defaultValue: i18n.t('ai.errors.PROVIDER_ERROR') }),
        );
      });
  };
  tapTranslateRef.current = handleParagraphTap;

  const saveSelectionNote = () => {
    if (!selection || !noteDraft.trim()) return;
    const locator = selectionLocator();
    if (!locator) return;
    const note = createNoteRecord({
      type: 'note',
      color: DEFAULT_HIGHLIGHT,
      text: selection.text,
      note: noteDraft.trim(),
      locator,
    });
    addNote(note);
    applyAnnotation(note);
    void persistNoteRecord(note);
    setSelection(null);
    setNoteMode(false);
    setNoteDraft('');
  };

  const addBookmark = () => {
    // PDFs have no CFI: bookmark the page (ADR-0006 page locators).
    const locator: Locator | null = isPdf
      ? pageInfo
        ? { kind: 'page', page: pageInfo.current, fraction: lastFractionRef.current }
        : null
      : lastCfiRef.current
        ? { kind: 'cfi', cfi: lastCfiRef.current, fraction: lastFractionRef.current }
        : null;
    if (!locator) return;
    const note = createNoteRecord({
      type: 'bookmark',
      color: null,
      text: null,
      note: null,
      locator,
    });
    addNote(note);
    void persistNoteRecord(note);
    setPanel('notes');
  };

  const jumpToNote = (note: BookNoteRecord) => {
    if (note.locator.kind === 'cfi') void viewRef.current?.goTo(note.locator.cfi);
    if (note.locator.kind === 'page' || note.locator.kind === 'pdf') {
      // foliate's PDF renderer indexes pages from zero.
      void viewRef.current?.goTo(Math.max(0, note.locator.page - 1));
    }
  };

  const deleteBookNote = (note: BookNoteRecord) => {
    removeNote(note.id);
    if (note.type !== 'bookmark' && note.locator.kind === 'cfi') {
      void viewRef.current?.deleteAnnotation({ value: note.locator.cfi });
    }
    if (editingNoteId === note.id) setEditingNoteId(null);
    const tombstoned = useNotesStore.getState().notes.find((item) => item.id === note.id);
    if (tombstoned) void persistNoteRecord(tombstoned);
  };

  const saveNoteEdit = (note: BookNoteRecord) => {
    updateNote(note.id, { color: note.color, note: editDraft.trim() || null });
    setEditingNoteId(null);
    const updated = useNotesStore.getState().notes.find((item) => item.id === note.id);
    if (updated) void persistNoteRecord(updated);
  };

  const exportNotes = (format: 'markdown' | 'json') => {
    const content =
      format === 'json'
        ? JSON.stringify({ book: book.title, notes: bookNotes }, null, 2)
        : [
            `# ${book.title}`,
            '',
            ...bookNotes.map((note) => {
              if (note.type === 'bookmark') {
                if (note.locator.kind === 'page') {
                  return `- ${t('reader.noteTypes.bookmark')} (${t('reader.pageNumber', {
                    page: note.locator.page,
                  })})`;
                }
                return `- ${t('reader.noteTypes.bookmark')} (${Math.round(
                  note.locator.fraction * 100,
                )}%)`;
              }
              const lines = [`## ${t(`reader.noteTypes.${note.type}`)}`];
              if (note.text) lines.push('', `> ${note.text.replaceAll('\n', '\n> ')}`);
              if (note.note) lines.push('', note.note);
              return lines.join('\n');
            }),
          ].join('\n\n');

    const blob = new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeTitle = book.title.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'notes';
    link.href = url;
    link.download = `${safeTitle}.${format === 'json' ? 'json' : 'md'}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const query = searchQuery.trim();
    const view = viewRef.current;
    if (!view || !query) return;

    setSearching(true);
    setSearchResults([]);
    try {
      for await (const item of view.search({ query })) {
        if (item === 'done') break;
        if (item && typeof item === 'object' && 'subitems' in item) {
          const section = item as {
            label?: string;
            subitems: Array<{
              cfi: string;
              excerpt: string | { pre?: string; match?: string; post?: string };
            }>;
          };
          setSearchResults((current) => [
            ...current,
            ...section.subitems.map((sub) => {
              const parts =
                typeof sub.excerpt === 'string'
                  ? { pre: sub.excerpt, match: '', post: '' }
                  : {
                      pre: sub.excerpt.pre ?? '',
                      match: sub.excerpt.match ?? '',
                      post: sub.excerpt.post ?? '',
                    };
              return { cfi: sub.cfi, label: section.label ?? '', ...parts };
            }),
          ]);
        }
      }
    } catch (error) {
      console.error('Search failed', error);
    } finally {
      setSearching(false);
    }
  };

  const numberFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US');
  const percent = numberFormat.format(Math.round(progress * 100));

  return (
    <div
      className="reader-shell"
      data-format={book.format}
      data-ready={ready ? 'true' : 'false'}
      data-failed={failed ? 'true' : 'false'}
      data-theme={readerTheme}
      data-flow={settings.flow}
      data-font-size={settings.fontSize}
      data-font-family={settings.fontFamily}
      data-line-height={settings.lineHeight}
      data-margin={settings.margin}
      data-hyphenate={settings.hyphenate ? 'true' : 'false'}
      data-brightness={settings.brightness}
      data-zoom={String(settings.pdfZoom)}
    >
      {settings.brightness < 100 ? (
        <div
          className="reader-dim"
          style={{ opacity: (100 - settings.brightness) / 100 }}
          aria-hidden="true"
        />
      ) : null}
      <header className="reader-header">
        <button type="button" className="text-button" onClick={onClose}>
          {t('reader.back')}
        </button>
        <div className="reader-title">
          <h1 dir="auto">{book.title}</h1>
          <p dir="auto">{book.authors.join('، ') || t('library.unknownAuthor')}</p>
        </div>
        <div className="reader-actions">
          <button
            type="button"
            ref={(node) => {
              panelButtonRefs.current.toc = node;
            }}
            className="reader-action"
            aria-expanded={panel === 'toc'}
            onClick={() => togglePanel('toc')}
          >
            {t('reader.contents')}
          </button>
          <button
            type="button"
            ref={(node) => {
              panelButtonRefs.current.notes = node;
            }}
            className="reader-action"
            aria-expanded={panel === 'notes'}
            onClick={() => togglePanel('notes')}
          >
            {t('reader.notes')}
          </button>
          {!isPdf ? (
            <button
              type="button"
              ref={(node) => {
                panelButtonRefs.current.search = node;
              }}
              className="reader-action"
              aria-expanded={panel === 'search'}
              onClick={() => togglePanel('search')}
            >
              {t('reader.search')}
            </button>
          ) : null}
          <button type="button" className="reader-action" onClick={addBookmark}>
            {t('reader.bookmark')}
          </button>
          <button
            type="button"
            ref={(node) => {
              panelButtonRefs.current.settings = node;
            }}
            className="reader-action"
            aria-expanded={panel === 'settings'}
            onClick={() => togglePanel('settings')}
          >
            {t('reader.settings')}
          </button>
        </div>
        <span className="reader-progress">
          {isPdf && pageInfo
            ? t('reader.pageOf', {
                current: numberFormat.format(pageInfo.current),
                total: numberFormat.format(pageInfo.total),
              })
            : t('reader.progress', { percent })}
        </span>
      </header>

      {panel === 'toc' && !sidebarVisible ? (
        <aside className="reader-panel toc-panel" aria-label={t('reader.contents')}>
          <div className="panel-header">
            <h2>{t('reader.contents')}</h2>
            <button type="button" className="text-button" onClick={closePanel}>
              {t('reader.close')}
            </button>
          </div>
          {toc.length > 0 ? (
            <TocTree items={toc} activeHref={activeHref} onSelect={goToToc} />
          ) : (
            <p className="hint">{t('reader.noToc')}</p>
          )}
        </aside>
      ) : null}

      {panel === 'notes' && !sidebarVisible ? (
        <NotesPanel
          notes={bookNotes}
          editingNoteId={editingNoteId}
          editDraft={editDraft}
          onEditDraftChange={setEditDraft}
          onEdit={(note) => {
            setEditingNoteId(note.id);
            setEditDraft(note.note ?? '');
          }}
          onSaveEdit={saveNoteEdit}
          onCancelEdit={() => {
            setEditingNoteId(null);
            setEditDraft('');
          }}
          onDelete={(noteId: string) => {
            const note = bookNotes.find((item) => item.id === noteId);
            if (note) deleteBookNote(note);
          }}
          onJump={jumpToNote}
          onExportMarkdown={() => exportNotes('markdown')}
          onExportJson={() => exportNotes('json')}
          onClose={closePanel}
        />
      ) : null}

      {panel === 'search' && !sidebarVisible ? (
        <SearchPanel
          query={searchQuery}
          results={searchResults}
          searching={searching}
          onQueryChange={setSearchQuery}
          onSubmit={runSearch}
          onGoTo={(cfi) => void viewRef.current?.goTo(cfi)}
          onClose={closePanel}
        />
      ) : null}

      {panel === 'settings' ? (
        <SettingsPanel settings={settings} isPdf={isPdf} onClose={closePanel} />
      ) : null}

      {selection ? (
        <SelectionPopover
          selection={selection}
          noteMode={noteMode}
          noteDraft={noteDraft}
          translation={translation}
          onHighlight={saveSelectionHighlight}
          onTranslate={() => void translateSelection()}
          onCopyTranslation={copySelectionTranslation}
          onStartNote={() => setNoteMode(true)}
          onSaveNote={saveSelectionNote}
          onCancelNote={() => {
            setNoteMode(false);
            setNoteDraft('');
          }}
          onDraftChange={setNoteDraft}
          onDismiss={() => {
            setSelection(null);
            setTranslation(null);
            setNoteMode(false);
          }}
        />
      ) : null}

      <div className="reader-main">
        {sidebarVisible ? (
          <aside
            className={`reader-sidebar${panel ? ` is-${panel}` : ' is-toc'}`}
            aria-label={t('reader.contents')}
          >
            <div className="sidebar-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={panel === 'toc'}
                className={panel === 'toc' ? 'reader-action is-selected' : 'reader-action'}
                onClick={() => setPanel('toc')}
              >
                {t('reader.contents')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panel === 'notes'}
                className={panel === 'notes' ? 'reader-action is-selected' : 'reader-action'}
                onClick={() => setPanel('notes')}
              >
                {t('reader.notes')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panel === 'search'}
                className={panel === 'search' ? 'reader-action is-selected' : 'reader-action'}
                onClick={() => setPanel('search')}
              >
                {t('reader.search')}
              </button>
              <button
                type="button"
                className="text-button sidebar-close"
                aria-label={t('reader.close')}
                onClick={closePanel}
              >
                {t('reader.close')}
              </button>
            </div>
            <div className="sidebar-body">
              {panel === 'notes' ? (
                <NotesPanel
                  notes={bookNotes}
                  editingNoteId={editingNoteId}
                  editDraft={editDraft}
                  onEditDraftChange={setEditDraft}
                  onEdit={(note) => {
                    setEditingNoteId(note.id);
                    setEditDraft(note.note ?? '');
                  }}
                  onSaveEdit={saveNoteEdit}
                  onCancelEdit={() => {
                    setEditingNoteId(null);
                    setEditDraft('');
                  }}
                  onDelete={(noteId: string) => {
                    const note = bookNotes.find((item) => item.id === noteId);
                    if (note) deleteBookNote(note);
                  }}
                  onJump={jumpToNote}
                  onExportMarkdown={() => exportNotes('markdown')}
                  onExportJson={() => exportNotes('json')}
                  onClose={closePanel}
                />
              ) : null}
              {panel === 'search' ? (
                <SearchPanel
                  query={searchQuery}
                  results={searchResults}
                  searching={searching}
                  onQueryChange={setSearchQuery}
                  onSubmit={runSearch}
                  onGoTo={(cfi) => void viewRef.current?.goTo(cfi)}
                  onClose={closePanel}
                />
              ) : null}
              {panel === 'toc' || panel === null ? (
                toc.length > 0 ? (
                  <TocTree items={toc} activeHref={activeHref} onSelect={goToToc} />
                ) : (
                  <p className="hint">{t('reader.noToc')}</p>
                )
              ) : null}
            </div>
          </aside>
        ) : null}
        <div className="reader-stage" ref={stageRef}>
          {failed ? (
            <p className="error" role="alert">
              {t('reader.error')}
            </p>
          ) : null}
        </div>
      </div>

      <footer className="reader-footer">
        <button type="button" className="reader-turn" onClick={() => turn('prev')}>
          {t('reader.previous')}
        </button>
        <button type="button" className="reader-turn" onClick={() => turn('next')}>
          {t('reader.next')}
        </button>
      </footer>
    </div>
  );
};
