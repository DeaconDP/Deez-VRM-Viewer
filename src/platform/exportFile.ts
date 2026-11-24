import { invoke } from '@tauri-apps/api/core';

export type SaveFilter = { name: string; extensions: string[] };

/** Save dialog filters for every export type `save_export_file` accepts on desktop. */
export const EXPORT_FILTERS: Record<'vrm' | 'png' | 'webm' | 'mp4', SaveFilter> = {
  vrm: { name: 'VRM', extensions: ['vrm'] },
  png: { name: 'PNG image', extensions: ['png'] },
  webm: { name: 'WebM video', extensions: ['webm'] },
  mp4: { name: 'MP4 video', extensions: ['mp4'] }
};

export type SaveLocalFileResult =
  | { saved: true; path?: string }
  | { saved: false };

function isTauriRuntime() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function downloadInBrowser(bytes: Uint8Array, fileName: string, mimeType: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Arguments for the desktop `save_export_file` command. There is deliberately no
 * path: the Rust side opens the native Save dialog and writes only where the user chose.
 */
export function desktopSaveArgs(options: { bytes: Uint8Array; fileName: string; title?: string; filters: SaveFilter[] }) {
  return {
    title: options.title ?? null,
    defaultName: options.fileName,
    filterName: options.filters[0]?.name ?? 'Export',
    extensions: options.filters.flatMap(filter => filter.extensions),
    bytes: options.bytes
  };
}

/** Save bytes via a native Save dialog on Tauri, or a browser download otherwise. */
export async function saveLocalFile(options: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  title?: string;
  filters: SaveFilter[];
}): Promise<SaveLocalFileResult> {
  if (!options.bytes.byteLength) throw new Error('Refusing to save an empty file.');

  if (!isTauriRuntime()) {
    downloadInBrowser(options.bytes, options.fileName, options.mimeType);
    return { saved: true };
  }

  const result = await invoke<{ saved: boolean; path?: string }>('save_export_file', desktopSaveArgs(options));
  return result.saved ? { saved: true, path: result.path } : { saved: false };
}
