import type * as THREE from 'three';

const MAX_SIZE = 64;

/** Draws a texture's image into a ≤64px canvas and returns a PNG data URL, or null when the image is not drawable (compressed, data texture, tainted). */
export function textureThumbnail(texture: THREE.Texture): string | null {
  const image = texture.image as CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null | undefined;
  const drawable = image && ((typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) || (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement)
    || (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas));
  if (!drawable) return null;
  const width = image.width ?? 0, height = image.height ?? 0;
  if (!width || !height) return null;
  const scale = Math.min(1, MAX_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch { return null; }
}
