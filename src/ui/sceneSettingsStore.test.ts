import { describe, expect, it } from 'vitest';
import { clearSceneSettings, DEFAULT_SCENE, loadSceneSettings, sanitizeSceneSettings, saveSceneSettings, SCENE_STORAGE_KEY, type SceneSettings } from './sceneSettingsStore';

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
};
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
const saved = (settings: unknown, version: unknown = 1) => fakeStorage({ [SCENE_STORAGE_KEY]: JSON.stringify({ version, settings }) });
const custom: SceneSettings = { key: 5, fill: 1.5, rim: 0, exposure: 2, backgroundMode: 'color', backgroundColor: '#123abc', backgroundName: '', grid: true };

describe('scene settings store', () => {
  it('round-trips settings', () => {
    const storage = fakeStorage();
    expect(saveSceneSettings(custom, storage)).toBe(true);
    expect(loadSceneSettings(storage)).toEqual(custom);
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadSceneSettings(fakeStorage())).toEqual(DEFAULT_SCENE);
    expect(loadSceneSettings(null)).toEqual(DEFAULT_SCENE);
  });

  it('returns defaults for garbage, non-objects and other versions', () => {
    for (const text of ['not json', 'null', '42', '"text"', '[]', '{}', JSON.stringify({ settings: custom }), JSON.stringify({ version: 2, settings: custom }), JSON.stringify({ version: '1', settings: custom })])
      expect(loadSceneSettings(fakeStorage({ [SCENE_STORAGE_KEY]: text }))).toEqual(DEFAULT_SCENE);
  });

  it('clamps every field to the slider ranges', () => {
    expect(loadSceneSettings(saved({ key: 99, fill: -3, rim: 8.5, exposure: 0.01 }))).toMatchObject({ key: 8, fill: 0, rim: 8, exposure: 0.25 });
    expect(sanitizeSceneSettings({ exposure: 9 }).exposure).toBe(2.5);
  });

  it('replaces invalid fields with defaults and keeps valid ones', () => {
    const result = loadSceneSettings(saved({ key: 'bright', fill: Number.NaN, rim: null, exposure: 1.5, backgroundColor: 'red', grid: 'yes' }));
    expect(result).toEqual({ ...DEFAULT_SCENE, exposure: 1.5 });
    for (const color of ['#fff', '#12345g', '123456', '#1234567', 'rgb(0,0,0)']) expect(sanitizeSceneSettings({ backgroundColor: color }).backgroundColor).toBe(DEFAULT_SCENE.backgroundColor);
    expect(sanitizeSceneSettings({ backgroundColor: '#ABCDEF' }).backgroundColor).toBe('#abcdef');
  });

  it('never stores or restores a background image', () => {
    const storage = fakeStorage();
    saveSceneSettings({ ...custom, backgroundMode: 'image', backgroundName: 'secret.png' }, storage);
    const text = storage.data.get(SCENE_STORAGE_KEY)!;
    expect(text).not.toContain('secret');
    expect(text).not.toContain('image');
    expect(loadSceneSettings(storage)).toMatchObject({ backgroundMode: 'color', backgroundColor: '#123abc', backgroundName: '' });
    expect(loadSceneSettings(saved({ ...custom, backgroundMode: 'image', backgroundName: 'blob:x' }))).toMatchObject({ backgroundMode: 'color', backgroundName: '' });
  });

  it('survives blocked or full storage', () => {
    expect(loadSceneSettings(throwing)).toEqual(DEFAULT_SCENE);
    expect(saveSceneSettings(custom, throwing)).toBe(false);
    expect(saveSceneSettings(custom, null)).toBe(false);
    expect(clearSceneSettings(throwing)).toBe(false);
  });

  it('clears the stored value', () => {
    const storage = fakeStorage();
    saveSceneSettings(custom, storage);
    expect(clearSceneSettings(storage)).toBe(true);
    expect(storage.data.has(SCENE_STORAGE_KEY)).toBe(false);
    expect(loadSceneSettings(storage)).toEqual(DEFAULT_SCENE);
  });

  it('returns fresh default objects', () => {
    const a = loadSceneSettings(null);
    a.key = 0;
    expect(loadSceneSettings(null).key).toBe(DEFAULT_SCENE.key);
  });
});
