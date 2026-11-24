import { createOpenQueue, errorMessage } from './openQueue';

type ModelPayload = { name: string; bytes: Uint8Array };

function isTauriRuntime() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function toBytes(value: ArrayBuffer | number[] | Uint8Array) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

function isModelPath(path: string) {
  const lower = path.toLowerCase();
  return lower.endsWith('.vrm') || lower.endsWith('.glb') || lower.endsWith('.gltf');
}

export function installDesktopBridge() {
  if (!isTauriRuntime() || window.desktop) return;

  const models = createOpenQueue<ModelPayload>();
  const errors = createOpenQueue<string>();
  const fail = (reason: unknown) => { console.error(reason); errors.deliver(errorMessage(reason)); };

  window.desktop = { onOpenModel: models.subscribe, onOpenError: errors.subscribe };

  // The Tauri APIs are only fetched inside the desktop shell, so the web build's startup chunk stays free of them.
  // Opens and errors are queued until the app subscribes, so registering the listeners a tick later loses nothing.
  void Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event'), import('@tauri-apps/api/webview')])
    .then(([{ invoke }, { listen }, { getCurrentWebview }]) => wireDesktopEvents(invoke, listen, getCurrentWebview, models.deliver, fail))
    .catch(fail);
}

type TauriCore = typeof import('@tauri-apps/api/core');
type TauriEvent = typeof import('@tauri-apps/api/event');
type TauriWebview = typeof import('@tauri-apps/api/webview');

function wireDesktopEvents(invoke: TauriCore['invoke'], listen: TauriEvent['listen'], getCurrentWebview: TauriWebview['getCurrentWebview'], deliver: (payload: ModelPayload) => void, fail: (reason: unknown) => void) {
  const loadPath = async (path: string) => {
    const result = await invoke<{ name: string; bytes: number[] | Uint8Array }>('read_model_file', { path });
    deliver({ name: result.name, bytes: toBytes(result.bytes) });
  };

  void listen<string>('open-model-path', event => {
    void loadPath(event.payload).catch(fail);
  });

  void getCurrentWebview().onDragDropEvent(event => {
    if (event.payload.type !== 'drop') return;
    const path = event.payload.paths.find(isModelPath);
    if (!path) {
      fail('Drop a .vrm, .glb, or .gltf model.');
      return;
    }
    void loadPath(path).catch(fail);
  }).catch(error => console.error(error));

  void invoke<string | null>('take_pending_model_path')
    .then(path => { if (path) return loadPath(path); })
    .catch(fail);
}
