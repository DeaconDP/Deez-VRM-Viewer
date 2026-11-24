import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { EXPORT_FILTERS, desktopSaveArgs, saveLocalFile } = await import('./exportFile');

const bytes = new Uint8Array([1, 2, 3]);

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

describe('desktopSaveArgs', () => {
  it('never carries a destination path, only a default name and allowed extensions', () => {
    const args = desktopSaveArgs({ bytes, fileName: 'avatar-spin.webm', title: 'Save video', filters: [EXPORT_FILTERS.webm] });
    expect(args).toEqual({ title: 'Save video', defaultName: 'avatar-spin.webm', filterName: 'WebM video', extensions: ['webm'], bytes });
    expect(Object.keys(args)).not.toContain('path');
  });

  it('merges the extensions of every filter', () => {
    expect(desktopSaveArgs({ bytes, fileName: 'a.png', filters: [EXPORT_FILTERS.webm, EXPORT_FILTERS.mp4] }).extensions).toEqual(['webm', 'mp4']);
  });
});

describe('saveLocalFile on desktop', () => {
  const options = { bytes, fileName: 'shot.png', mimeType: 'image/png', title: 'Save screenshot', filters: [EXPORT_FILTERS.png] };

  it('asks Rust to show the dialog and returns the saved path', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue({ saved: true, path: 'C:\\Users\\me\\shot.png' });
    expect(await saveLocalFile(options)).toEqual({ saved: true, path: 'C:\\Users\\me\\shot.png' });
    expect(invoke).toHaveBeenCalledWith('save_export_file', desktopSaveArgs(options));
  });

  it('reports a cancelled dialog as not saved', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue({ saved: false });
    expect(await saveLocalFile(options)).toEqual({ saved: false });
  });

  it('refuses empty bytes before reaching Rust', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    await expect(saveLocalFile({ ...options, bytes: new Uint8Array() })).rejects.toThrow(/empty/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
