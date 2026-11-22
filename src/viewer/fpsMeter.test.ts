import { describe, expect, it } from 'vitest';
import { createFpsMeter } from './fpsMeter';

const feed = (meter: ReturnType<typeof createFpsMeter>, fps: number, fromMs: number, toMs: number) => {
  const step = 1000 / fps;
  let t = fromMs;
  for (; t <= toMs; t += step) meter.frame(t);
  return t - step;
};

describe('createFpsMeter', () => {
  it('reports null before any frame', () => {
    expect(createFpsMeter().read(0)).toBeNull();
  });
  it('needs at least two frames for a reading', () => {
    const meter = createFpsMeter();
    meter.frame(0);
    expect(meter.read(0)).toBeNull();
  });
  it('does not spike when the loop-start frame lands just before vsync', () => {
    const meter = createFpsMeter();
    meter.frame(0); meter.frame(2.5); meter.frame(2.5 + 1000 / 60);
    expect(meter.read(20)).toBeNull();
    const last = feed(meter, 60, 2.5 + 2000 / 60, 300);
    const reading = meter.read(last);
    expect(reading).not.toBeNull();
    expect(reading!).toBeGreaterThanOrEqual(58);
    expect(reading!).toBeLessThanOrEqual(64);
  });
  it('measures a steady 60 fps', () => {
    const meter = createFpsMeter();
    const last = feed(meter, 60, 0, 2000);
    expect(meter.read(last)).toBe(60);
  });
  it('measures a steady 30 fps', () => {
    const meter = createFpsMeter();
    const last = feed(meter, 30, 0, 2000);
    expect(meter.read(last)).toBe(30);
  });
  it('only uses the last second of frames', () => {
    const meter = createFpsMeter();
    let last = feed(meter, 120, 0, 3000);
    last = feed(meter, 30, last + 1000 / 30, last + 2000);
    expect(meter.read(last)).toBe(30);
  });
  it('goes idle when no frame arrives for more than 500 ms', () => {
    const meter = createFpsMeter();
    const last = feed(meter, 60, 0, 1000);
    expect(meter.read(last + 400)).toBe(60);
    expect(meter.read(last + 501)).toBeNull();
  });
  it('polls at most twice a second and skips unchanged values', () => {
    const meter = createFpsMeter();
    const emitted: number[] = [];
    for (let t = 0; t <= 3000; t += 1000 / 60) { meter.frame(t); const value = meter.poll(t); if (value !== undefined) emitted.push(value); }
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.length).toBeLessThanOrEqual(6);
    expect(emitted.at(-1)).toBe(60);
    expect(new Set(emitted).size).toBe(emitted.length);
  });
  it('emits again after a reset', () => {
    const meter = createFpsMeter();
    const last = feed(meter, 60, 0, 1000);
    expect(meter.poll(last)).toBe(60);
    meter.reset();
    expect(meter.read(last)).toBeNull();
    const next = feed(meter, 60, last + 2000, last + 3000);
    expect(meter.poll(next)).toBe(60);
  });
});
