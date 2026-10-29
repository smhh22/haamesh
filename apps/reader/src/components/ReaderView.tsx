import type { Locator, TocItem } from '@hamesh/core';
import { pageTurnForKey, sanitizeEpubHtml } from '@hamesh/engine';
import type { BookRecord } from '@hamesh/storage';
import { useDirection } from '@hamesh/ui';
import { type FoliateBook, makeBook } from 'foliate-js/view.js';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildReaderCss } from '../readerStyles';
import { useReaderSettings } from '../stores/readerSettingsStore';

interface FoliateRenderer {
  getContents(): Array<{ doc: Document }>;
  setAttribute(name: string, value: string): void;
  render?(): void;
}

interface FoliateViewElement extends HTMLElement {
  renderer?: FoliateRenderer;
  open(book: FoliateBook): Promise<void>;
  init(options?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  destroy(): void;
}

export interface ReaderViewProps {
  book: BookRecord;
  file: File;
  initialLocation?: string | null;
  initialFraction?: number;
  onProgress?: (state: { locator: Locator | null; fraction: number }) => void;
  onClose: () => void;
}

const READER_STYLE_ID = 'hamesh-reader-style';

const applyReaderStyle = (doc: Document, css: string): void => {
  let style = doc.getElementById(READER_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = READER_STYLE_ID;
    (doc.head ?? doc.documentElement).append(style);
  }
  style.textContent = css;
};

const TocTree = ({
  items,
  activeHref,
  onSelect,
}: {
  items: TocItem[];
  activeHref: string | null;
  onSelect: (href: string) => void;
}) => (
  <ol className="toc-list">
    {items.map((item) => (
      <li key={`${item.href}-${item.label}`}>
        <button
          type="button"
          className={item.href === activeHref ? 'toc-item is-active' : 'toc-item'}
          onClick={() => onSelect(item.href)}
        >
          {item.label}
        </button>
        {item.subitems?.length ? (
          <TocTree items={item.subitems} activeHref={activeHref} onSelect={onSelect} />
        ) : null}
      </li>
    ))}
  </ol>
);

export const ReaderView = ({
  book,
  file,
  initialLocation,
  initialFraction = 0,
  onProgress,
  onClose,
}: ReaderViewProps) => {
  const { t, i18n } = useTranslation();
  const direction = useDirection();
  const settings = useReaderSettings();
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const onProgressRef = useRef(onProgress);
  const settingsCssRef = useRef(buildReaderCss(settings));
  const flowRef = useRef(settings.flow);
  const lastCfiRef = useRef<string | null>(null);
  const [progress, setProgress] = useState(initialFraction);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    const css = buildReaderCss(settings);
    settingsCssRef.current = css;
    flowRef.current = settings.flow;

    const view = viewRef.current;
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
  }, [settings]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    const view = document.createElement('foliate-view') as FoliateViewElement;
    viewRef.current = view;
    stage.append(view);

    const onRelocate = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          fraction?: number;
          cfi?: string;
          tocItem?: { href?: string } | null;
        }>
      ).detail;

      if (typeof detail?.fraction === 'number' && Number.isFinite(detail.fraction)) {
        const fraction = Math.min(1, Math.max(0, detail.fraction));
        setProgress(fraction);
        onProgressRef.current?.({
          locator: detail.cfi ? { kind: 'cfi', cfi: detail.cfi, fraction } : null,
          fraction,
        });
      }
      if (detail?.cfi) lastCfiRef.current = detail.cfi;
      if (detail?.tocItem?.href) setActiveHref(detail.tocItem.href);
    };

    const onLoad = (event: Event) => {
      setReady(true);
      const detail = (event as CustomEvent<{ doc?: Document }>).detail;
      if (detail?.doc) applyReaderStyle(detail.doc, settingsCssRef.current);
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

    view.addEventListener('relocate', onRelocate);
    view.addEventListener('load', onLoad);
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
          lastLocation: initialLocation || undefined,
          showTextStart: true,
        });

        view.renderer?.setAttribute('flow', flowRef.current);
        for (const { doc } of view.renderer?.getContents() ?? []) {
          applyReaderStyle(doc, settingsCssRef.current);
        }
      } catch (error) {
        console.error('Failed to open book', error);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      view.removeEventListener('relocate', onRelocate);
      view.removeEventListener('load', onLoad);
      view.removeEventListener('external-link', blockExternalLink);
      try {
        view.destroy();
      } catch {
        // The view may not have finished opening; removing the element is enough.
      }
      view.remove();
      viewRef.current = null;
    };
  }, [file, initialLocation]);

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

  const numberFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US');
  const percent = numberFormat.format(Math.round(progress * 100));
  const fontSize = numberFormat.format(settings.fontSize);

  return (
    <div
      className="reader-shell"
      data-ready={ready ? 'true' : 'false'}
      data-failed={failed ? 'true' : 'false'}
      data-theme={settings.theme}
      data-flow={settings.flow}
      data-font-size={settings.fontSize}
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
            aria-expanded={showToc}
            onClick={() => {
              setShowToc((visible) => !visible);
              setShowSettings(false);
            }}
          >
            {t('reader.contents')}
          </button>
          <button
            type="button"
            className="reader-action"
            aria-expanded={showSettings}
            onClick={() => {
              setShowSettings((visible) => !visible);
              setShowToc(false);
            }}
          >
            {t('reader.settings')}
          </button>
          <span className="reader-progress">{t('reader.progress', { percent })}</span>
        </div>
      </header>

      {showToc ? (
        <aside className="reader-panel toc-panel" aria-label={t('reader.contents')}>
          <div className="panel-header">
            <h2>{t('reader.contents')}</h2>
            <button type="button" className="text-button" onClick={() => setShowToc(false)}>
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

      {showSettings ? (
        <aside className="reader-panel settings-panel" aria-label={t('reader.settings')}>
          <div className="panel-header">
            <h2>{t('reader.settings')}</h2>
            <button type="button" className="text-button" onClick={() => setShowSettings(false)}>
              {t('reader.close')}
            </button>
          </div>

          <div className="setting-row">
            <span>{t('reader.fontSize')}</span>
            <div className="setting-controls">
              <button
                type="button"
                className="reader-action"
                aria-label={t('reader.decreaseFont')}
                onClick={settings.decreaseFont}
              >
                A−
              </button>
              <span className="setting-value">{fontSize}%</span>
              <button
                type="button"
                className="reader-action"
                aria-label={t('reader.increaseFont')}
                onClick={settings.increaseFont}
              >
                A+
              </button>
            </div>
          </div>

          <div className="setting-row">
            <span>{t('reader.theme')}</span>
            <div className="setting-controls">
              {(['light', 'sepia', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={
                    settings.theme === theme ? 'reader-action is-selected' : 'reader-action'
                  }
                  onClick={() => settings.setTheme(theme)}
                >
                  {t(`reader.themes.${theme}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-row">
            <span>{t('reader.justify')}</span>
            <button
              type="button"
              className={settings.justify ? 'reader-action is-selected' : 'reader-action'}
              aria-pressed={settings.justify}
              onClick={settings.toggleJustify}
            >
              {settings.justify ? t('reader.on') : t('reader.off')}
            </button>
          </div>

          <div className="setting-row">
            <span>{t('reader.flow')}</span>
            <div className="setting-controls">
              <button
                type="button"
                className={
                  settings.flow === 'paginated' ? 'reader-action is-selected' : 'reader-action'
                }
                onClick={() => settings.setFlow('paginated')}
              >
                {t('reader.paginated')}
              </button>
              <button
                type="button"
                className={
                  settings.flow === 'scrolled' ? 'reader-action is-selected' : 'reader-action'
                }
                onClick={() => settings.setFlow('scrolled')}
              >
                {t('reader.scrolled')}
              </button>
            </div>
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
