# Desktop security model

How the Tauri shell limits what the webview can do. By deac online · Worldbuild.io

## Exports: the webview never names a path

Saving a screenshot, video or baked VRM on desktop goes through one Rust command,
`save_export_file { title, defaultName, filterName, extensions, bytes }`
(`src-tauri/src/lib.rs`, called from `src/platform/exportFile.ts`).

1. Rust checks the request before showing anything: the bytes must be non-empty and every
   requested extension must be on the export allowlist (`vrm`, `png`, `webm`, `mp4`).
   Any folder part of `defaultName` is dropped, so the webview can't choose the dialog's
   starting folder either.
2. Rust opens the native Save dialog itself (`tauri-plugin-dialog`, `blocking_save_file` inside
   an async command, so it never blocks the main thread).
3. Rust writes only to the path that dialog returned, and only if that path still ends in one of
   the requested extensions (some platforms let the user type any name). A cancelled dialog
   returns `{ "saved": false }`.

The old `write_export_file(path, bytes)` command and its permission have been removed. The
frontend capability (`src-tauri/capabilities/default.json`) no longer grants any `dialog:`
permission, because the frontend never calls `@tauri-apps/plugin-dialog` directly. The Open Model
menu and export dialogs are opened from Rust. The browser build still saves through a normal
download.

The validation and write steps are pure functions (`validate_export_request`,
`write_dialog_export`) with unit tests in `lib.rs` (`cargo test` in `src-tauri`).

## Content Security Policy

`app.security.csp` in `src-tauri/tauri.conf.json` is a structured object. Tauri serialises it
into the `Content-Security-Policy` header for every page it serves and adds nonces/hashes for
its own scripts. The production policy is:

```
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' blob: data: https:;
connect-src 'self' ipc: http://ipc.localhost https: http://localhost:* blob: data:;
worker-src 'self';
object-src 'none';
frame-src 'none';
base-uri 'self';
form-action 'none';
frame-ancestors 'none'
```

JSON can't hold comments, so this table explains why each source is there:

| Directive | Source | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Fonts, manifest, media and anything not listed below come only from the bundled app. |
| `script-src` | `'self'` | Vite emits hashed module scripts with no inline script. three.js compiles shaders through WebGL, not `eval`, so neither `'unsafe-eval'` nor `'wasm-unsafe-eval'` is needed. Tauri adds hashes for its own injected scripts. |
| `style-src` | `'self'` | The built `index.html` has no `<style>` tag or `style=""` attribute. Preact `style={{…}}` props are set through the CSSOM (`element.style`), which CSP does not block. Legal documents are opened as links, not rendered as HTML. |
| `img-src` | `'self'` | App icons and bundled images. |
| | `blob:` | Background images opened from disk (`URL.createObjectURL`), and textures embedded in a GLB/VRM, which three.js decodes from blob URLs. |
| | `data:` | Material inspector thumbnails (`canvas.toDataURL`). |
| | `https:` | Background image URLs the user types in. Plain `http:` backgrounds are refused on desktop. |
| `connect-src` | `'self'` | Bundled animations (`public/animations/*.vrma`) and other app files fetched at runtime. |
| | `ipc:` `http://ipc.localhost` | Tauri IPC (`ipc:` on macOS/Linux, `http://ipc.localhost` on Windows): opening models, claiming the pending OS-open path, saving exports. |
| | `https:` | Model URLs the user types in, the random freebie loader (registry JSON from `raw.githubusercontent.com`, then model files on whatever HTTPS host the registry lists, e.g. `arweave.net`), and external textures referenced by remote glTF files. A host allowlist isn't possible because both lists are open-ended. |
| | `http://localhost:*` | The Open URL dialog also accepts `http://localhost` for models served from a local dev server. |
| | `blob:` | Local models: the bytes the Rust side reads (or a dropped/chosen file) become a `File`/blob URL that `GLTFLoader` fetches. Also VRMA files opened from disk. |
| | `data:` | PNG capture turns `canvas.toDataURL()` into bytes with `fetch(dataUrl)`. Also covers glTF files with embedded `data:` buffers. |
| `worker-src` | `'self'` | The Bake Meshes worker is a same-origin module worker (`new Worker(new URL('./bake/bake.worker.ts', import.meta.url), { type: 'module' })`), emitted as `assets/bake.worker-*.js`. |
| `object-src` | `'none'` | No plugins. |
| `frame-src` | `'none'` | No iframes. |
| `base-uri` | `'self'` | Stops an injected `<base>` from re-pointing relative URLs. |
| `form-action` | `'none'` | Every form is handled in JavaScript (`preventDefault`). Nothing ever submits. |
| `frame-ancestors` | `'none'` | The app is never embedded. |

Video capture (`canvas.captureStream()` + `MediaRecorder`) produces a `Blob` in memory and needs
no extra source. External links (`target="_blank"`) are navigations handled by the
`navigation-guard` plugin in `lib.rs`, which hands them to the system browser through the
`opener` plugin from Rust. They are not fetches, so CSP doesn't apply to them.

### Development

`app.security.devCsp` is the same policy with two additions for `npm run tauri:dev`:
`ws://127.0.0.1:5188` (Vite HMR) and `'unsafe-inline'` in `style-src` (Vite injects CSS as
`<style>` tags in dev). On desktop, Tauri 2 loads the Vite `devUrl` directly, so in practice
this policy only applies where Tauri proxies the dev server (mobile). It is set so dev never
silently falls back to the stricter production policy.

### How the policy was verified

The desktop web build (`npm run build:desktop`) was served with the production policy as a
response header and driven with headless Chromium (Playwright). The run loaded the public sample
VRM by URL, loaded a random freebie, applied a remote HTTPS background image, saved a PNG,
recorded a 2 s turntable video, opened material inspector thumbnails, opened a local VRM from
disk and ran Bake Meshes in the worker. It recorded zero `securitypolicyviolation` events and no
console errors. A negative check confirmed the policy is enforced: an `http:` image, an
inline `<style>` and an `http:` fetch were all reported as violations.
The real shell was checked too. A debug build with the embedded frontend
(`cargo build --features tauri/custom-protocol`) was launched with an isolated WebView2 profile
(`WEBVIEW2_USER_DATA_FOLDER`) and remote debugging, then driven over CDP. Results:

- Tauri served the policy above as a header, plus hashes for its own scripts.
- IPC worked through it.
- A URL model, a remote background, material thumbnails and the bake worker all loaded with no
  violations.
- The removed `write_export_file` command and `plugin:dialog|save` were both refused.
- Driving the real Save dialog: a normal save wrote the file, Escape returned `{ saved: false }`,
  and typing `evil.bat` was refused with "This export must be saved as .png.". A folder in
  `defaultName` was ignored: the dialog opened in the user's last folder, not the requested one.

Repeat these checks whenever a feature adds a new kind of network, worker or inline resource.
