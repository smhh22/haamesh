import type { Locator, TocItem } from '@hamesh/core';
import { pageTurnForKey, sanitizeEpubHtml } from '@hamesh/engine';
import type { BookNoteRecord, BookRecord } from '@hamesh/storage';
import { useDirection } from '@hamesh/ui';
import { Overlayer } from 'foliate-js/overlayer.js';
import { type FoliateBook, makeBook } from 'foliate-js/view.js';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { locatorFromRelocate, type RelocateDetail } from '../readerLocator';
import { buildReaderCss } from '../readerStyles';
import { persistNoteRecord } from '../services/libraryPersistence';
import { notesForBook, useNotesStore } from '../stores/notesStore';
import { useReaderSettings } from '../stores/readerSettingsStore';
import { NotesPanel } from './reader/NotesPanel';
import { SelectionPopover } from './reader/SelectionPopover';
import { SettingsPanel } from './reader/SettingsPanel';
import { TocTree } from './reader/TocTree';

interface FoliateRenderer {
  getContents(): Array<{ doc: Document; index: number }>;
  setAttribute(name: string, value: string): void;
  render?(): void;
}

interface FoliateViewElement extends HTMLElement {
  renderer?: FoliateRenderer;
  open(book: FoliateBook): Promise<void>;
  init(options?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<{ index: number; anchor: unknown } | undefined>;
  next(): Promise<void>;
  prev(): Promise<void>;
  destroy(): void;
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

import type { SelectionInfo } from './reader/types';

interface SearchResult {
  cfi: string;
  label: string;
  pre: string;
  match: string;
  post: string;
}

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
  const direction = useDirection();
  const settings = useReaderSettings();
  const allNotes = useNotesStore((state) => state.notes);
  const addNote = useNotesStore((state) => state.add);
  const updateNote = useNotesStore((state) => state.update);
  const removeNote = useNotesStore((state) => state.remove);
  const bookNotes = useMemo(() => notesForBook(allNotes, book.id), [allNotes, book.id]);
  const isPdf = book.format === 'pdf';

  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const onProgressRef = useRef(onProgress);
  const notesRef = useRef<BookNoteRecord[]>(bookNotes);
  const settingsCssRef = useRef(buildReaderCss(settings));
  const flowRef = useRef(settings.flow);
  const lastCfiRef = useRef<string | null>(null);
  const lastFractionRef = useRef(initialFraction);
  const [progress, setProgress] = useState(initialFraction);
  const [pageInfo, setPageInfo] = useState<{ current: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const [panel, setPanel] = useState<ReaderPanel>(null);
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
    const css = buildReaderCss(settings);
    settingsCssRef.current = css;
    flowRef.current = settings.flow;

    if (!view?.renderer) return;

    for (const { doc } of view.renderer.getContents()) {
      applyReaderStyle(doc, css);
    }
    view.renderer.setAttribute('flow', settings.flow);
    view.renderer.render?.();

    const cfi = lastCfiRef.current;
    if (cfi) {
      requestAnimationFrame(() => {
        void view.goTo(cfi);
      });
    }
  }, [settings, isPdf]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
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
      if (detail.type === 'application/xhtml+xml' || detail.type === 'text/html') {
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
        view.destroy();
      } catch {
        // The view may not have finished opening; removing the element is enough.
      }
      view.remove();
      viewRef.current = null;
    };
  }, [file, initialLocation, initialPage, isPdf]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, button, [role="dialog"]')) return;

      const turn = pageTurnForKey(event.key, direction);
      if (!turn) return;
      event.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      void (turn === 'next' ? view.next() : view.prev());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [direction]);

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
    cfi: string;
    fraction: number;
  }): BookNoteRecord => ({
    id: crypto.randomUUID(),
    bookId: book.id,
    type: input.type,
    locator: { kind: 'cfi', cfi: input.cfi, fraction: input.fraction },
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
      cfi: selection.cfi,
      fraction: selection.fraction,
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
      cfi: selection.cfi,
      fraction: selection.fraction,
    });
    addNote(note);
    applyAnnotation(note);
    void persistNoteRecord(note);
    setSelection(null);
    setNoteMode(false);
    setNoteDraft('');
  };

  const addBookmark = () => {
    const cfi = lastCfiRef.current;
    if (!cfi) return;
    const note = createNoteRecord({
      type: 'bookmark',
      color: null,
      text: null,
      note: null,
      cfi,
      fraction: lastFractionRef.current,
    });
    addNote(note);
    void persistNoteRecord(note);
    setPanel('notes');
  };

  const jumpToNote = (note: BookNoteRecord) => {
    if (note.locator.kind === 'cfi') void viewRef.current?.goTo(note.locator.cfi);
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
  const fontSize = numberFormat.format(settings.fontSize);

  return (
    <div
      className="reader-shell"
      data-format={book.format}
      data-ready={ready ? 'true' : 'false'}
      data-failed={failed ? 'true' : 'false'}
      data-theme={settings.theme}
      data-flow={settings.flow}
      data-font-size={settings.fontSize}
      data-zoom={String(settings.pdfZoom)}
    >
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
            className="reader-action"
            aria-expanded={panel === 'toc'}
            onClick={() => togglePanel('toc')}
          >
            {t('reader.contents')}
          </button>
          {!isPdf ? (
            <>
              <button
                type="button"
                className="reader-action"
                aria-expanded={panel === 'notes'}
                onClick={() => togglePanel('notes')}
              >
                {t('reader.notes')}
              </button>
              <button
                type="button"
                className="reader-action"
                aria-expanded={panel === 'search'}
                onClick={() => togglePanel('search')}
              >
                {t('reader.search')}
              </button>
              <button type="button" className="reader-action" onClick={addBookmark}>
                {t('reader.bookmark')}
              </button>
            </>
          ) : null}
          <button
            type="button"
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
        <aside className="reader-panel search-panel" aria-label={t('reader.search')}>
          <div className="panel-header">
            <h2>{t('reader.search')}</h2>
            <button type="button" className="text-button" onClick={closePanel}>
              {t('reader.close')}
            </button>
          </div>
          <form className="search-form" onSubmit={runSearch}>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={t('reader.searchPlaceholder')}
              aria-label={t('reader.searchPlaceholder')}
            />
            <button type="submit" className="reader-action">
              {t('reader.searchButton')}
            </button>
          </form>
          {searching ? <p className="hint">{t('reader.searching')}</p> : null}
          {!searching && searchQuery && searchResults.length === 0 ? (
            <p className="hint">{t('reader.noSearchResults')}</p>
          ) : null}
          <ul className="search-results">
            {searchResults.map((result) => (
              <li key={result.cfi}>
                <button
                  type="button"
                  className="search-result"
                  onClick={() => {
                    void viewRef.current?.goTo(result.cfi);
                  }}
                >
                  {result.label ? <span className="search-label">{result.label}</span> : null}
                  <span>
                    {result.pre}
                    <mark>{result.match}</mark>
                    {result.post}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
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
