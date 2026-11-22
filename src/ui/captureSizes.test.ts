import { describe, expect, it } from 'vitest';
import { CAPTURE_PRESETS, captureFileName, captureLimits, clampDuration, exportBaseName, fitSize, parseDimension, presetSize, validateCaptureSize, videoSize } from './captureSizes';

const limits = { maxDimension: 8192, maxPixels: 8192 * 8192 };
const viewport = { width: 1000, height: 600, pixelRatio: 2 };

describe('captureLimits', () => {
  it('takes the smallest WebGL cap and never exceeds 8192', () => {
    expect(captureLimits({ maxTextureSize: 16384, maxRenderbufferSize: 16384, maxViewportDims: [32767, 32767] })).toEqual({ maxDimension: 8192, maxPixels: 8192 ** 2 });
    expect(captureLimits({ maxTextureSize: 4096, maxRenderbufferSize: 8192, maxViewportDims: [8192, 8192] })).toEqual({ maxDimension: 4096, maxPixels: 4096 ** 2 });
    expect(captureLimits({ maxTextureSize: 8192, maxRenderbufferSize: 8192, maxViewportDims: new Int32Array([8192, 2048]) }).maxDimension).toBe(2048);
  });
  it('ignores missing or zero caps', () => {
    expect(captureLimits({ maxTextureSize: 0, maxRenderbufferSize: NaN, maxViewportDims: [] }).maxDimension).toBe(8192);
  });
});

describe('presetSize', () => {
  it('lists every requested preset', () => {
    expect(CAPTURE_PRESETS.map(p => p.id)).toEqual(['current', 'x1', 'x2', 'x4', 'hd', 'uhd', 'square', 'vrchat', 'custom']);
  });
  it('uses the drawing buffer for the current view and CSS pixels for multiples', () => {
    expect(presetSize('current', viewport, limits)).toEqual({ width: 2000, height: 1200 });
    expect(presetSize('x1', viewport, limits)).toEqual({ width: 1000, height: 600 });
    expect(presetSize('x2', viewport, limits)).toEqual({ width: 2000, height: 1200 });
    expect(presetSize('x4', viewport, limits)).toEqual({ width: 4000, height: 2400 });
  });
  it('returns fixed sizes for named presets', () => {
    expect(presetSize('hd', viewport, limits)).toEqual({ width: 1920, height: 1080 });
    expect(presetSize('uhd', viewport, limits)).toEqual({ width: 3840, height: 2160 });
    expect(presetSize('square', viewport, limits)).toEqual({ width: 2048, height: 2048 });
    expect(presetSize('vrchat', viewport, limits)).toEqual({ width: 1200, height: 900 });
    expect(presetSize('custom', viewport, limits)).toBeNull();
  });
  it('scales presets down to the device limit keeping the aspect', () => {
    const small = { maxDimension: 2048, maxPixels: 2048 * 2048 };
    expect(presetSize('uhd', viewport, small)).toEqual({ width: 2048, height: 1152 });
    expect(presetSize('x4', { width: 2560, height: 1440, pixelRatio: 1 }, limits)).toEqual({ width: 8192, height: 4608 });
  });
  it('honours a pixel budget smaller than the square of the max dimension', () => {
    const size = presetSize('uhd', viewport, { maxDimension: 8192, maxPixels: 4_000_000 });
    expect(size!.width * size!.height).toBeLessThanOrEqual(4_000_000);
    expect(size!.width / size!.height).toBeCloseTo(16 / 9, 2);
  });
});

describe('fitSize and videoSize', () => {
  it('leaves sizes that fit alone', () => {
    expect(fitSize({ width: 800, height: 600 }, { maxWidth: 1920, maxHeight: 1080 })).toEqual({ width: 800, height: 600 });
  });
  it('caps video output to 1920×1080 with even dimensions', () => {
    expect(videoSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
    expect(videoSize({ width: 2048, height: 2048 })).toEqual({ width: 1080, height: 1080 });
    expect(videoSize({ width: 1201, height: 901 })).toEqual({ width: 1200, height: 900 });
    expect(videoSize({ width: 1001, height: 601 })).toEqual({ width: 1000, height: 600 });
  });
});

describe('validateCaptureSize', () => {
  it('accepts whole numbers in range', () => {
    expect(validateCaptureSize(64, 64, limits)).toBe('');
    expect(validateCaptureSize(8192, 8192, limits)).toBe('');
  });
  it('rejects fractions, NaN and out-of-range values', () => {
    expect(validateCaptureSize(100.5, 100, limits)).toMatch(/whole numbers/);
    expect(validateCaptureSize(NaN, 100, limits)).toMatch(/whole numbers/);
    expect(validateCaptureSize(63, 100, limits)).toMatch(/between 64 and 8192/);
    expect(validateCaptureSize(100, 8193, limits)).toMatch(/between 64 and 8192/);
  });
  it('rejects sizes beyond the device limits', () => {
    expect(validateCaptureSize(5000, 100, { maxDimension: 4096, maxPixels: 4096 ** 2 })).toMatch(/at most 4096/);
    expect(validateCaptureSize(4000, 4000, { maxDimension: 8192, maxPixels: 10_000_000 })).toMatch(/exceeds/);
  });
});

describe('parseDimension', () => {
  it('parses whole numbers only', () => {
    expect(parseDimension(' 1920 ')).toBe(1920);
    expect(parseDimension('19.5')).toBeNaN();
    expect(parseDimension('')).toBeNaN();
    expect(parseDimension('1e3')).toBeNaN();
  });
});

describe('file names', () => {
  it('includes the size and strips unsafe characters', () => {
    expect(captureFileName('Alicia', { width: 1920, height: 1080 })).toBe('Alicia-1920x1080.png');
    expect(captureFileName('a/b:c*?', { width: 64, height: 64 })).toBe('abc-64x64.png');
    expect(exportBaseName(undefined)).toBe('deez-vrm');
    expect(exportBaseName('  ...  ')).toBe('deez-vrm');
    expect(exportBaseName('Model. ')).toBe('Model');
  });
});

describe('clampDuration', () => {
  it('keeps durations between 2 and 20 seconds', () => {
    expect(clampDuration(6)).toBe(6);
    expect(clampDuration(1)).toBe(2);
    expect(clampDuration(99)).toBe(20);
    expect(clampDuration(NaN)).toBe(6);
  });
});
