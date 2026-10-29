import type { Locator } from '@hamesh/core';
import { pageTurnForKey, sanitizeEpubHtml } from '@hamesh/engine';
import type { BookRecord } from '@hamesh/storage';
import { useDirection } from '@hamesh/ui';
import { type FoliateBook, makeBook } from 'foliate-js/view.js';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface FoliateViewElement extends HTMLElement {
  open(book: FoliateBook): Promise<void>;
  init(options?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
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
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const onProgressRef = useRef(onProgress);
  const [progress, setProgress] = useState(initialFraction);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    const view = document.createElement('foliate-view') as FoliateViewElement;
    viewRef.current = view;
    stage.append(view);

    const onRelocate = (event: Event) => {
      const detail = (event as CustomEvent<{ fraction?: number; cfi?: string }>).detail;
      if (typeof detail?.fraction !== 'number' || !Number.isFinite(detail.fraction)) return;
      const fraction = Math.min(1, Math.max(0, detail.fraction));
      setProgress(fraction);
      onProgressRef.current?.({
        locator: detail.cfi ? { kind: 'cfi', cfi: detail.cfi, fraction } : null,
        fraction,
      });
    };
    const onLoad = () => {
      setReady(true);
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
        await view.open(parsed);
        await view.init({
          lastLocation: initialLocation || undefined,
          showTextStart: true,
        });
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

  const percent = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US').format(
    Math.round(progress * 100),
  );

  return (
    <div
      className="reader-shell"
      data-ready={ready ? 'true' : 'false'}
      data-failed={failed ? 'true' : 'false'}
    >
      <header className="reader-header">
        <button type="button" className="text-button" onClick={onClose}>
          {t('reader.back')}
        </button>
        <div className="reader-title">
          <h1 dir="auto">{book.title}</h1>
          <p dir="auto">{book.authors.join('، ') || t('library.unknownAuthor')}</p>
        </div>
        <span className="reader-progress">{t('reader.progress', { percent })}</span>
      </header>

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
