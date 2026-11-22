/** MediaRecorder output format selection, kept pure so it can be tested without a browser. */

export type VideoFormat = { mimeType: string; baseType: 'video/webm' | 'video/mp4'; extension: 'webm' | 'mp4'; alpha: boolean };

export const VIDEO_MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'] as const;

/** Describes a recorder mime type. Only explicit VP8/VP9 WebM can carry an alpha channel (Chromium). */
export function describeVideoMime(mimeType: string): VideoFormat {
  const lower = mimeType.toLowerCase();
  const mp4 = lower.startsWith('video/mp4');
  return {
    mimeType,
    baseType: mp4 ? 'video/mp4' : 'video/webm',
    extension: mp4 ? 'mp4' : 'webm',
    alpha: !mp4 && /codecs="?vp[89]/.test(lower)
  };
}

/** First supported candidate, or null when the recorder supports none (or the check throws). */
export function pickVideoFormat(isTypeSupported: (mimeType: string) => boolean): VideoFormat | null {
  for (const mimeType of VIDEO_MIME_CANDIDATES) {
    try { if (isTypeSupported(mimeType)) return describeVideoMime(mimeType); } catch { /* Treat as unsupported. */ }
  }
  return null;
}

/** Bitrate that keeps 1080p30 sharp without huge files: ~0.15 bits per pixel per frame, 2–16 Mbps. */
export function videoBitrate(width: number, height: number, fps: number) {
  return Math.round(Math.min(16_000_000, Math.max(2_000_000, width * height * fps * 0.15)));
}
