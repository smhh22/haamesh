import type { Locator, TocItem } from '@hamesh/core';
import { isSanitizableMediaType, pageTurnForKey, sanitizeEpubHtml } from '@hamesh/engine';
import type { BookNoteRecord, BookRecord } from '@hamesh/storage';
import { Overlayer } from 'foliate-js/overlayer.js';
import { type FoliateBook, makeBook } from 'foliate-js/view.js';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { locatorFromRelocate, type RelocateDetail } from '../readerLocator';
import { buildReaderCss } from '../readerStyles';
import { persistNoteRecord } from '../services/libraryPersistence';
import { notesForBook, useNotesStore } from '../stores/notesStore';
import { type ResolvedReaderTheme, useReaderSettings } from '../stores/readerSettingsStore';
import { useResolvedUiTheme } from '../stores/uiStore';
import { NotesPanel } from './reader/NotesPanel';
import { SearchPanel } from './reader/SearchPanel';
import { SelectionPopover } from './reader/SelectionPopover';
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
    };

    const onLoad = (event: Event) => {
      setReady(true);
      if (isPdf) return;
      const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
      const doc = detail?.doc;
      if (!doc) return;

      // Books without their own dir attribute paginate by our resolved
      // direction; this runs before the renderer measures layout.
      if (!doc.documentElement.hasAttribute('dir')) {
        doc.documentElement.dir = book.direction;
      }
      applyReaderStyle(doc, settingsCssRef.current);
      // The paginator iframes own focus once the reader clicks the text;
      // forward their keydowns so page turns and shortcuts keep working.
      doc.addEventListener('keydown', (event) => keyHandlerRef.current(event));
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
  }, [file, initialLocation, initialPage, isPdf, book.direction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Dialogs (for example the shortcut map) own Escape and typing keys.
      if (target?.closest('[role="dialog"]')) return;

      if (event.key === 'Escape') {
        if (panel) {
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
  }, [panel, onClose, book.direction, isPdf]);

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
    if (panel === next && next === 'search') viewRef.current?.clearSearch();
    setPanel((current) => (current === next ? null : next));
  };

  const closePanel = () => {
    if (panel === 'search') viewRef.current?.clearSearch();
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

  const saveSelectionHighlight = (color: string) => {
    if (!selection) return;
    const note = createNoteRecord({
      type: 'highlight',
      color,
      text: selection.text,
      note: null,
      locator: { kind: 'cfi', cfi: selection.cfi, fraction: selection.fraction },
    });
    addNote(note);
    applyAnnotation(note);
    void persistNoteRecord(note);
    setSelection(null);
    setNoteMode(false);
    setNoteDraft('');
  };

  const saveSelectionNote = () => {
    if (!selection || !noteDraft.trim()) return;
    const note = createNoteRecord({
      type: 'note',
      color: DEFAULT_HIGHLIGHT,
      text: selection.text,
      note: noteDraft.trim(),
      locator: { kind: 'cfi', cfi: selection.cfi, fraction: selection.fraction },
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
    if (note.locator.kind === 'page') {
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
          <span className="reader-progress">
            {isPdf && pageInfo
              ? t('reader.pageOf', {
                  current: numberFormat.format(pageInfo.current),
                  total: numberFormat.format(pageInfo.total),
                })
              : t('reader.progress', { percent })}
          </span>
        </div>
      </header>

      {panel === 'toc' ? (
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

      {panel === 'settings' ? (
        <SettingsPanel settings={settings} isPdf={isPdf} onClose={closePanel} />
      ) : null}

      {selection ? (
        <SelectionPopover
          selection={selection}
          noteMode={noteMode}
          noteDraft={noteDraft}
          onHighlight={saveSelectionHighlight}
          onStartNote={() => setNoteMode(true)}
          onSaveNote={saveSelectionNote}
          onCancelNote={() => {
            setNoteMode(false);
            setNoteDraft('');
          }}
          onDraftChange={setNoteDraft}
          onDismiss={() => setSelection(null)}
        />
      ) : null}

      <div className="reader-stage" ref={stageRef}>
        {failed ? (
          <p className="error" role="alert">
            {t('reader.error')}
          </p>
        ) : null}
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
