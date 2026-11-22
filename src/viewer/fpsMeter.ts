export interface FpsMeterOptions { windowMs?: number; idleMs?: number; emitMs?: number; minSpanMs?: number }

/**
 * Measures frames per second from frame timestamps (ms). Pure, so it can be tested without a renderer.
 * Needs at least minSpanMs of frames before reporting, so the synchronous first frame of a loop start
 * (rendered only a few ms before the next vsync) cannot produce a spike like "400 FPS".
 */
export function createFpsMeter({ windowMs = 1000, idleMs = 500, emitMs = 500, minSpanMs = 250 }: FpsMeterOptions = {}) {
  let frames: number[] = [];
  let lastEmit = -Infinity;
  let lastValue: number | null = null;

  const prune = (now: number) => { while (frames.length && now - frames[0] > windowMs) frames.shift(); };

  /** Rounded fps over the window, or null when idle (no frame for longer than idleMs) or not enough frames yet. */
  const read = (now: number): number | null => {
    prune(now);
    const last = frames[frames.length - 1];
    if (last === undefined || now - last > idleMs || frames.length < 2) return null;
    const span = last - frames[0];
    return span >= minSpanMs ? Math.round((frames.length - 1) * 1000 / span) : null;
  };

  return {
    read,
    frame(now: number) { frames.push(now); prune(now); },
    /** Returns a value to publish at most once per emitMs, only when it is a real reading that changed. */
    poll(now: number): number | undefined {
      if (now - lastEmit < emitMs) return undefined;
      const value = read(now);
      if (value === null) return undefined;
      lastEmit = now;
      if (value === lastValue) return undefined;
      lastValue = value;
      return value;
    },
    reset() { frames = []; lastEmit = -Infinity; lastValue = null; }
  };
}

export type FpsMeter = ReturnType<typeof createFpsMeter>;
