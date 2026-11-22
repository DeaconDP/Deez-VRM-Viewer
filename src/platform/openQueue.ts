/** Fan-out channel that holds events until the first listener subscribes, so nothing sent at startup is lost. */
export function createOpenQueue<T>() {
  const queued: T[] = [];
  const listeners = new Set<(value: T) => void>();
  return {
    deliver(value: T) {
      if (listeners.size === 0) queued.push(value);
      else listeners.forEach(listener => listener(value));
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      while (queued.length) listener(queued.shift()!);
      return () => { listeners.delete(listener); };
    }
  };
}

/** Turns anything thrown or rejected (Tauri invoke rejects with a plain string) into a readable message. */
export function errorMessage(reason: unknown, fallback = 'The model could not be opened.') {
  if (typeof reason === 'string') return reason.trim() || fallback;
  if (reason instanceof Error) return reason.message.trim() || fallback;
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' && reason.message.trim()) return reason.message.trim();
  return fallback;
}
