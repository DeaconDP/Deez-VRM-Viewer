declare module '*.md?url' {
  const url: string;
  export default url;
}

declare module '*?url' {
  const url: string;
  export default url;
}

interface Window {
  desktop?: {
    onOpenModel: (listener: (payload: { name: string; bytes: Uint8Array }) => void) => () => void;
    /** Open, drop and file-association failures; queued until a listener subscribes. */
    onOpenError: (listener: (message: string) => void) => () => void;
  };
}
