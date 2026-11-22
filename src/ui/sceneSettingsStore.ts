/** Scene look-dev settings, kept on this device only. Background images are never stored. */
export interface SceneSettings { key: number; fill: number; rim: number; exposure: number; backgroundMode: 'color' | 'image'; backgroundColor: string; backgroundName: string; grid: boolean }

export const SCENE_STORAGE_KEY = 'deez-vrm-viewer:scene:v1';
export const DEFAULT_SCENE: SceneSettings = { key: 3.4, fill: 2.2, rim: 2.4, exposure: 1.05, backgroundMode: 'color', backgroundColor: '#70777d', backgroundName: '', grid: false };
/** Matches the Scene panel slider ranges. */
export const SCENE_LIMITS = { light: [0, 8], exposure: [0.25, 2.5] } as const;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const clampNumber = (value: unknown, [min, max]: readonly [number, number], fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const hexColor = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

/** Coerces any value into valid settings. Image backgrounds come back as the saved solid colour. */
export function sanitizeSceneSettings(value: unknown): SceneSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    key: clampNumber(raw.key, SCENE_LIMITS.light, DEFAULT_SCENE.key),
    fill: clampNumber(raw.fill, SCENE_LIMITS.light, DEFAULT_SCENE.fill),
    rim: clampNumber(raw.rim, SCENE_LIMITS.light, DEFAULT_SCENE.rim),
    exposure: clampNumber(raw.exposure, SCENE_LIMITS.exposure, DEFAULT_SCENE.exposure),
    backgroundMode: 'color',
    backgroundColor: hexColor(raw.backgroundColor, DEFAULT_SCENE.backgroundColor),
    backgroundName: '',
    grid: typeof raw.grid === 'boolean' ? raw.grid : DEFAULT_SCENE.grid
  };
}

const defaultStorage = (): StorageLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** Saved settings, or defaults when nothing valid is stored or storage is unavailable. */
export function loadSceneSettings(storage: StorageLike | null = defaultStorage()): SceneSettings {
  try {
    const text = storage?.getItem(SCENE_STORAGE_KEY);
    if (!text) return { ...DEFAULT_SCENE };
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) return { ...DEFAULT_SCENE };
    return sanitizeSceneSettings((parsed as { settings?: unknown }).settings);
  } catch { return { ...DEFAULT_SCENE }; }
}

/** Stores the settings (image backgrounds are stored as their solid colour). Returns false when storage is unavailable or full. */
export function saveSceneSettings(settings: SceneSettings, storage: StorageLike | null = defaultStorage()) {
  if (!storage) return false;
  const { key, fill, rim, exposure, backgroundColor, grid } = sanitizeSceneSettings(settings);
  try { storage.setItem(SCENE_STORAGE_KEY, JSON.stringify({ version: 1, settings: { key, fill, rim, exposure, backgroundColor, grid } })); return true; }
  catch { return false; }
}

export function clearSceneSettings(storage: StorageLike | null = defaultStorage()) {
  try { storage?.removeItem(SCENE_STORAGE_KEY); return !!storage; }
  catch { return false; }
}
