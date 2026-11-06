import type { BookRecord } from '@hamesh/storage';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { persistReadingState } from '../../services/libraryPersistence';
import { type AudioSpeed, audioSpeeds, useAudioStore } from '../../stores/audioStore';
import { useReadingStore } from '../../stores/readingStore';
import { PauseIcon, PlayIcon } from './icons';

export interface PlayerBarProps {
  book: BookRecord;
  file: File;
  /** Persist-and-stop callback; runs on close and on unmount. */
  onClose: () => void;
}

const SAVE_INTERVAL_MS = 5000;

/** Module-level so hooks never depend on an unstable closure (ADR-0021). */
const saveAudioPosition = (bookId: string, atSeconds: number, total: number): void => {
  if (!(atSeconds > 0) || !Number.isFinite(atSeconds)) return;
  const fraction = total > 0 ? Math.min(1, atSeconds / total) : 0;
  const state = {
    bookId,
    locator: { kind: 'audio', seconds: atSeconds, fraction } as const,
    fraction,
    status: 'reading' as const,
    updatedAt: Date.now(),
  };
  useReadingStore.getState().save(state);
  void persistReadingState(state);
};

const formatTime = (seconds: number, locale: string): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const digits = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  return `${digits.format(minutes)}:${digits.format(rest).padStart(2, '0')}`;
};

/**
 * Persistent audio player bar (ADR-0021 MVP): a fixed strip above the app
 * chrome with native `<audio>` playback over an object URL. The position
 * saves as an audio locator through the same reading-state path the reader
 * uses, so it syncs like any reading progress.
 */
export const PlayerBar = ({ book, file, onClose }: PlayerBarProps) => {
  const { t, i18n } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSaveRef = useRef(0);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const speed = useAudioStore((state) => state.speed);
  const setSpeed = useAudioStore((state) => state.setSpeed);
  const numberFormat = new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US');

  // Saved position from the reading store; applied once the metadata loads
  // (currentTime is unreliable before that).
  const pendingSeekRef = useRef(0);

  // The object URL is created and revoked in the same effect so StrictMode's
  // double mount never leaves the <audio> pointing at a revoked blob.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // Restore the saved position and re-save on teardown. saveAudioPosition is
  // a stable module function, so the effect needs no extra dependencies.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const state = useReadingStore.getState().states[book.id];
    const start = state?.locator?.kind === 'audio' ? state.locator.seconds : 0;
    pendingSeekRef.current = Number.isFinite(start) && start > 0 ? start : 0;
    return () => {
      saveAudioPosition(book.id, audio.currentTime, audio.duration || 0);
    };
  }, [book.id]);

  // Speed is a device preference: apply it whenever it changes.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const onTimeUpdate = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    setSeconds(audio.currentTime);
    const now = Date.now();
    if (now - lastSaveRef.current >= SAVE_INTERVAL_MS) {
      lastSaveRef.current = now;
      saveAudioPosition(book.id, audio.currentTime, audio.duration || 0);
    }
  };

  const toggle = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else {
      audio.pause();
      saveAudioPosition(book.id, audio.currentTime, audio.duration || 0);
    }
  };

  const skip = (delta: number): void => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
  };

  const seek = (value: number): void => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = value * audio.duration;
  };

  const seekFraction = duration > 0 ? seconds / duration : 0;

  return (
    <section className="player-bar" aria-label={t('player.title')}>
      {/* biome-ignore lint/a11y/useMediaCaption: audio-only playback has no captions to provide */}
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setDuration(audio.duration || 0);
          if (pendingSeekRef.current > 0 && pendingSeekRef.current < (audio.duration || 0)) {
            audio.currentTime = pendingSeekRef.current;
            pendingSeekRef.current = 0;
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          const audio = audioRef.current;
          if (audio) saveAudioPosition(book.id, audio.currentTime, audio.duration || 0);
          setPlaying(false);
        }}
      />
      <div className="player-meta">
        {book.coverPath ? <img src={book.coverPath} alt="" /> : null}
        <div className="player-titles">
          <p className="player-title" dir="auto">
            {book.title}
          </p>
          <p className="player-time">
            {formatTime(seconds, i18n.language)} / {formatTime(duration, i18n.language)}
          </p>
        </div>
      </div>
      <div className="player-controls">
        <button
          type="button"
          className="player-skip"
          onClick={() => skip(-15)}
          aria-label={t('player.back15')}
          title={t('player.back15')}
        >
          −{numberFormat.format(15)}s
        </button>
        <button
          type="button"
          className="player-toggle"
          onClick={toggle}
          aria-label={playing ? t('player.pause') : t('player.play')}
          title={playing ? t('player.pause') : t('player.play')}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="player-skip"
          onClick={() => skip(15)}
          aria-label={t('player.forward15')}
          title={t('player.forward15')}
        >
          +{numberFormat.format(15)}s
        </button>
        <input
          type="range"
          className="reader-seek"
          aria-label={t('player.seek')}
          min={0}
          max={1000}
          value={Math.round(seekFraction * 1000)}
          onChange={(event) => seek(Number(event.currentTarget.value) / 1000)}
        />
        <select
          className="player-speed"
          aria-label={t('player.speed')}
          value={speed}
          onChange={(event) => setSpeed(Number(event.currentTarget.value) as AudioSpeed)}
        >
          {audioSpeeds.map((option) => (
            <option key={option} value={option}>
              ×{numberFormat.format(option)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="reader-action player-close"
          onClick={() => {
            const audio = audioRef.current;
            if (audio) saveAudioPosition(book.id, audio.currentTime, audio.duration || 0);
            onClose();
          }}
          aria-label={t('player.close')}
          title={t('player.close')}
        >
          {t('player.close')}
        </button>
      </div>
    </section>
  );
};
