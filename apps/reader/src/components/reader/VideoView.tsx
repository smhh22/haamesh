import type { BookRecord } from '@hamesh/storage';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { persistReadingState } from '../../services/libraryPersistence';
import { mediaUrlFor } from '../../services/mediaServer';
import { useReadingStore } from '../../stores/readingStore';
import { ChevronLeftIcon } from './icons';

export interface VideoViewProps {
  book: BookRecord;
  file: File;
  onClose: () => void;
}

const SAVE_INTERVAL_MS = 5000;

/** Module-level so hooks never depend on an unstable callback identity. */
const saveVideoPosition = (bookId: string, atSeconds: number, total: number): void => {
  if (!(atSeconds > 0) || !Number.isFinite(atSeconds)) return;
  const fraction = total > 0 ? Math.min(1, atSeconds / total) : 0;
  const state = {
    bookId,
    locator: { kind: 'time', seconds: atSeconds, fraction } as const,
    fraction,
    status: 'reading' as const,
    updatedAt: Date.now(),
  };
  useReadingStore.getState().save(state);
  void persistReadingState(state);
};

/**
 * Video player view (ADR-0023): a full-screen stage like the reader, with
 * native `<video>` controls over the media server (desktop) or an object URL
 * (web). The position saves as a time locator through the reading-state path.
 * Decode failures surface the platform hint (H.264/AAC need gstreamer-libav
 * on stock Linux).
 */
export const VideoView = ({ book, file, onClose }: VideoViewProps) => {
  const { t, i18n } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSaveRef = useRef(0);
  const pendingSeekRef = useRef(0);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const numberFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US');

  // Restore the saved position once the metadata is available.
  useEffect(() => {
    const state = useReadingStore.getState().states[book.id];
    const start = state?.locator?.kind === 'time' ? state.locator.seconds : 0;
    pendingSeekRef.current = Number.isFinite(start) && start > 0 ? start : 0;
  }, [book.id]);

  // Media origin: the loopback server on the desktop shell, an object URL on
  // the web. Created and revoked in one effect so StrictMode's double mount
  // never leaves the <video> pointing at a revoked blob.
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    void mediaUrlFor(file, book.hash, book.identifiers.container ?? 'mp4').then((url) => {
      objectUrl = url.startsWith('blob:') ? url : null;
      setMediaUrl(url);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, book.hash, book.identifiers.container]);

  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) saveVideoPosition(book.id, video.currentTime, video.duration || 0);
    };
  }, [book.id]);

  const onTimeUpdate = (): void => {
    const video = videoRef.current;
    if (!video) return;
    setSeconds(video.currentTime);
    const now = Date.now();
    if (now - lastSaveRef.current >= SAVE_INTERVAL_MS) {
      lastSaveRef.current = now;
      saveVideoPosition(book.id, video.currentTime, video.duration || 0);
    }
  };

  const percent = numberFormat.format(
    Math.round((duration > 0 ? Math.min(1, seconds / duration) : 0) * 100),
  );

  return (
    <div className="reader-shell video-shell" data-format="video" data-ready="true">
      <header className="reader-header">
        <button type="button" className="text-button" onClick={onClose}>
          {t('reader.back')}
        </button>
        <div className="reader-title">
          <h1 dir="auto">{book.title}</h1>
        </div>
        <span className="reader-progress">{t('reader.progress', { percent })}</span>
      </header>
      <div className="video-stage">
        {/* biome-ignore lint/a11y/useMediaCaption: user-supplied course videos have no caption tracks */}
        <video
          ref={videoRef}
          src={mediaUrl ?? undefined}
          controls
          preload="metadata"
          onLoadedMetadata={() => {
            const video = videoRef.current;
            if (!video) return;
            setDuration(video.duration || 0);
            if (pendingSeekRef.current > 0 && pendingSeekRef.current < (video.duration || 0)) {
              video.currentTime = pendingSeekRef.current;
              pendingSeekRef.current = 0;
            }
          }}
          onTimeUpdate={onTimeUpdate}
          onPause={() => {
            const video = videoRef.current;
            if (video) saveVideoPosition(book.id, video.currentTime, video.duration || 0);
          }}
          onEnded={() => {
            const video = videoRef.current;
            if (video) saveVideoPosition(book.id, video.currentTime, video.duration || 0);
          }}
          onError={() => setFailed(true)}
        />
        {failed ? (
          <p className="hint video-error" role="alert">
            {t('player.videoErrorHint')}
          </p>
        ) : null}
      </div>
      <div className="video-footnote">
        <button type="button" className="reader-action" onClick={onClose}>
          <ChevronLeftIcon />
          {t('reader.back')}
        </button>
      </div>
    </div>
  );
};
