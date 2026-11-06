import { create } from 'zustand';

/**
 * Playback state for the one book playing at a time (ADR-0021). The position
 * itself lives in the reading store as an audio locator — this store only
 * drives the player bar UI. Playback speed is a device preference and never
 * syncs; it stays in localStorage.
 */

const SPEED_KEY = 'hamesh.audio.speed';
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export type AudioSpeed = (typeof SPEEDS)[number];

const readSpeed = (): AudioSpeed => {
  try {
    const raw = localStorage.getItem(SPEED_KEY);
    const parsed = raw ? Number(raw) : 1;
    return (SPEEDS as readonly number[]).includes(parsed) ? (parsed as AudioSpeed) : 1;
  } catch {
    return 1;
  }
};

export const audioSpeeds: readonly AudioSpeed[] = SPEEDS;

interface AudioStore {
  bookId: string | null;
  seconds: number;
  duration: number;
  playing: boolean;
  speed: AudioSpeed;
  open: (bookId: string, seconds?: number) => void;
  close: () => void;
  update: (seconds: number, duration: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: AudioSpeed) => void;
}

export const useAudioStore = create<AudioStore>((set) => ({
  bookId: null,
  seconds: 0,
  duration: 0,
  playing: false,
  speed: readSpeed(),
  open: (bookId, seconds = 0) => set({ bookId, seconds, duration: 0, playing: false }),
  close: () => set({ bookId: null, seconds: 0, duration: 0, playing: false }),
  update: (seconds, duration) => set({ seconds, duration }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => {
    try {
      localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      // Speed is a preference; losing it is acceptable.
    }
    set({ speed });
  },
}));
