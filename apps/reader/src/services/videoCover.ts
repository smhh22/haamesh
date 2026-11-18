/**
 * First-frame covers for imported videos (ADR-0023 follow-up). Video files
 * carry no embedded artwork, so the import pipeline frames a still: load the
 * file into a hidden <video>, seek a little past any black intro, draw one
 * frame onto a canvas and encode a small JPEG.
 *
 * Everything here is best effort. A missing codec (WebKitGTK without
 * gstreamer-libav), a refused seek, an empty canvas or a slow decode all
 * resolve to null — the library keeps its typographic placeholder, and the
 * import never fails because a cover could not be made.
 */

export interface VideoCover {
  blob: Blob;
  mime: string;
}

/** How long one capture may take before the placeholder wins. */
const CAPTURE_TIMEOUT_MS = 6000;
/** Seek this far in to skip black or title frames. */
const FRAME_SECONDS = 0.5;
/** Covers do not need the full frame; keep library thumbnails small. */
const MAX_WIDTH = 640;
/** JPEG quality: a readable thumbnail, not a poster. */
const JPEG_QUALITY = 0.82;

const waitForEvent = (target: HTMLVideoElement, event: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`video ${event} failed`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('video capture timed out'));
    }, CAPTURE_TIMEOUT_MS);
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });

const canvasToJpeg = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob && blob.size > 0 ? blob : null),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });

/**
 * Capture one frame of `file` as a JPEG cover. Returns null when the platform
 * cannot decode the container, the frame is empty, or anything times out.
 */
export const captureVideoCover = async (file: File): Promise<VideoCover | null> => {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    // `loadeddata` means the first frame is decoded and drawable.
    await waitForEvent(video, 'loadeddata');
    if (!video.videoWidth || !video.videoHeight) return null;

    const duration = video.duration;
    const target = Number.isFinite(duration)
      ? Math.min(FRAME_SECONDS, Math.max(0, duration / 4))
      : 0;
    if (target > 0) {
      video.currentTime = target;
      await waitForEvent(video, 'seeked');
    }
    if (!video.videoWidth || !video.videoHeight) return null;

    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToJpeg(canvas);
    return blob ? { blob, mime: 'image/jpeg' } : null;
  } catch {
    return null;
  } finally {
    // Drop the decoder and the object URL even on failure: importing a large
    // video must not pin it in memory.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
};
