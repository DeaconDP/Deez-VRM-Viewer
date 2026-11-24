# TODO

Current epic: **E4 · Release and trust** (see [ROADMAP.md](ROADMAP.md)). E1–E3 are done, awaiting merge in PRs #7–#10.

## E4 · Release and trust

- [x] Exports go only where the user chose: the `save_export_file` command opens the native Save dialog in Rust and writes only to the path it returns (still .vrm / .png / .webm / .mp4, never empty); `write_export_file` and the frontend `dialog:` permissions are removed; Rust unit tests cover cancel, a dialog path with the wrong extension, empty bytes and nested folders
- [x] Content Security Policy for the Tauri shell (`script-src 'self'`, no inline styles, `https:` only for user-entered models and backgrounds, plus `http://localhost` models); each source is explained in [docs/SECURITY.md](docs/SECURITY.md); checked with zero violations in Chromium and in the real WebView2 window
- [x] Release workflow (`.github/workflows/release.yml`): a `v*` tag or manual run builds the Windows NSIS installer and a universal macOS `.dmg` into a draft GitHub release; Windows (PFX) and macOS (Developer ID + notarisation) signing run only when their secrets are set ([docs/RELEASING.md](docs/RELEASING.md))
- [ ] Follow-up: buy certificates, add the signing secrets and cut the first signed release (the workflow has not run yet)

## E3 · Look dev and capture (done, awaiting merge in PR #10)

- [x] Persist scene settings between sessions (local only): lighting, exposure, background colour and grid are saved in this browser (`deez-vrm-viewer:scene:v1`); background images are never stored; "Reset scene" clears the saved value
- [x] Camera presets: full body, portrait, VRChat-style thumbnail framing (Scene panel "Camera" or keys `1` / `2` / `3`; humanoid bones for VRM, bounding box for glTF)
- [x] Transparent capture at custom resolutions: Capture dialog presets (current view, 1×/2×/4× viewport, 1080p, 4K, 2048 square, VRChat 1200×900) or a custom size from 64 to 8192 px (capped by the GPU), videos up to 1920×1080, with scene or transparent background; selection and spring overlays never appear
- [x] Short turntable or animation capture to WebM (MP4 where the browser can only record that): 2–20 s, one full turn or the loaded clip from its start; Escape cancels; view, animation and shortcuts are restored afterwards. GIF moved to Deferred (needs an encoder dependency)
- [ ] Follow-up: MediaRecorder's realtime encoder drops some frames under load (80 of 90 on an Intel UHD GPU, far more in software rendering); frame-exact export would need WebCodecs

## E2 · Inspect deeper (done, awaiting merge in PRs #8, #9)

- [x] Selecting a mesh, bone, node or material in the explorer highlights it in the viewport (double-click or Inspector "Frame selection" frames it; click again or Escape clears)
- [x] Material inspector: shader (MToon / PBR), textures with thumbnails, alpha mode
- [x] Spring bone and collider visualisation toggle (toolbar or `B`: joints cyan, colliders magenta, hidden in captures)
- [x] VRM licence fields shown in full (allowed users, commercial use, redistribution)
- [x] Explorer lists beyond 250 items per group (virtualised list)

## E1 · Honest UI (done, awaiting merge in PR #7)

- [x] Reload model button re-opens the current local file or URL
- [x] Real FPS meter in the status bar ("Idle" when not rendering continuously)
- [x] Explorer "•••" menu: expand all / collapse all
- [x] Surface desktop open / drop / association errors in the viewport error card
- [x] Rust unit tests for `is_model_path`, `is_export_path`, `model_path_from_args`
