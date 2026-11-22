/** Pure size maths for still and video capture: presets, validation and clamping to device limits. */

export const CAPTURE_MIN = 64;
export const CAPTURE_MAX = 8192;
/** Video output must fit inside this box (aspect kept). */
export const VIDEO_MAX = { width: 1920, height: 1080 } as const;

export type CaptureSize = { width: number; height: number };
/** Viewport in CSS pixels plus the renderer pixel ratio. */
export type CaptureViewport = CaptureSize & { pixelRatio: number };
/** Largest single dimension and total pixel count the GPU drawing buffer accepts. */
export type CaptureLimits = { maxDimension: number; maxPixels: number };

export type CapturePresetId = 'current' | 'x1' | 'x2' | 'x4' | 'hd' | 'uhd' | 'square' | 'vrchat' | 'custom';
export type CapturePreset = { id: CapturePresetId; label: string; size?: CaptureSize; scale?: number };

export const CAPTURE_PRESETS: readonly CapturePreset[] = [
  { id: 'current', label: 'Current view' },
  { id: 'x1', label: '1× viewport', scale: 1 },
  { id: 'x2', label: '2× viewport', scale: 2 },
  { id: 'x4', label: '4× viewport', scale: 4 },
  { id: 'hd', label: '1080p', size: { width: 1920, height: 1080 } },
  { id: 'uhd', label: '4K', size: { width: 3840, height: 2160 } },
  { id: 'square', label: 'Square', size: { width: 2048, height: 2048 } },
  { id: 'vrchat', label: 'VRChat thumbnail', size: { width: 1200, height: 900 } },
  { id: 'custom', label: 'Custom' }
];

/** Device limits from the WebGL caps, never above CAPTURE_MAX per side. */
export function captureLimits(caps: { maxTextureSize: number; maxRenderbufferSize: number; maxViewportDims: ArrayLike<number> }): CaptureLimits {
  const values = [caps.maxTextureSize, caps.maxRenderbufferSize, caps.maxViewportDims[0], caps.maxViewportDims[1], CAPTURE_MAX].filter(n => Number.isFinite(n) && n > 0);
  const maxDimension = Math.max(CAPTURE_MIN, Math.floor(Math.min(...values)));
  return { maxDimension, maxPixels: maxDimension * maxDimension };
}

/** Scales a size down (aspect kept) until it fits the box and pixel budget, then rounds to whole pixels. */
export function fitSize(size: CaptureSize, box: { maxWidth: number; maxHeight: number; maxPixels?: number; even?: boolean }): CaptureSize {
  const width = Math.max(1, size.width), height = Math.max(1, size.height);
  let scale = Math.min(1, box.maxWidth / width, box.maxHeight / height);
  if (box.maxPixels && width * height * scale * scale > box.maxPixels) scale = Math.sqrt(box.maxPixels / (width * height));
  const round = (n: number, max: number) => {
    let value = Math.max(CAPTURE_MIN, Math.min(max, Math.floor(n)));
    if (box.even && value % 2) value -= 1;
    return value;
  };
  return { width: round(width * scale, box.maxWidth), height: round(height * scale, box.maxHeight) };
}

/** Pixel size a preset produces for this viewport, scaled down to fit device limits. Custom returns null. */
export function presetSize(id: CapturePresetId, viewport: CaptureViewport, limits: CaptureLimits): CaptureSize | null {
  const preset = CAPTURE_PRESETS.find(p => p.id === id);
  if (!preset || id === 'custom') return null;
  const raw = preset.size ?? (id === 'current'
    ? { width: Math.round(viewport.width * viewport.pixelRatio), height: Math.round(viewport.height * viewport.pixelRatio) }
    : { width: Math.round(viewport.width * (preset.scale ?? 1)), height: Math.round(viewport.height * (preset.scale ?? 1)) });
  return fitSize(raw, { maxWidth: limits.maxDimension, maxHeight: limits.maxDimension, maxPixels: limits.maxPixels });
}

/** Fits a still-capture size inside the 1920×1080 video box with even dimensions (encoders need them). */
export function videoSize(size: CaptureSize): CaptureSize {
  return fitSize(size, { maxWidth: VIDEO_MAX.width, maxHeight: VIDEO_MAX.height, even: true });
}

/** Returns an error message for a custom size, or '' when it is valid for this device. */
export function validateCaptureSize(width: number, height: number, limits: CaptureLimits): string {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return 'Width and height must be whole numbers.';
  if (width < CAPTURE_MIN || height < CAPTURE_MIN || width > CAPTURE_MAX || height > CAPTURE_MAX) return `Width and height must be between ${CAPTURE_MIN} and ${CAPTURE_MAX} pixels.`;
  if (width > limits.maxDimension || height > limits.maxDimension) return `This GPU can render at most ${limits.maxDimension} pixels per side.`;
  if (width * height > limits.maxPixels) return `${width}×${height} exceeds this GPU's limit of ${limits.maxPixels.toLocaleString('en-US')} pixels.`;
  return '';
}

/** Parses a text field as a whole number, or NaN when it is not one. */
export function parseDimension(text: string) {
  return /^\s*\d+\s*$/.test(text) ? Number(text) : NaN;
}

/** File-system safe base name for exports. */
export function exportBaseName(name: string | undefined) {
  const cleaned = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return cleaned || 'deez-vrm';
}

export const captureFileName = (name: string | undefined, size: CaptureSize) => `${exportBaseName(name)}-${size.width}x${size.height}.png`;

export const VIDEO_DURATION = { min: 2, max: 20, default: 6 } as const;
export function clampDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return VIDEO_DURATION.default;
  return Math.min(VIDEO_DURATION.max, Math.max(VIDEO_DURATION.min, Math.round(seconds)));
}
