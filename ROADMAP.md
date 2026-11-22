# Roadmap

Deez VRM Viewer: a private, local-first VRM 0.x / 1.0 viewer for Windows, macOS and the web (PWA).
Concrete next tasks live in [TODO.md](TODO.md).

## Shipped (1.0)

- Local open (picker, drag and drop, file association, single instance) for `.vrm` / `.glb` / `.gltf`
- Scene explorer, inspector, VRM metadata, diagnostics, expression preview
- Studio lighting, solid or image background, PNG capture (1× and transparent 2×)
- 86 bundled Quaternius motions, local `.vrma` import, loop / speed / in-place controls
- Bake Meshes (beta): rebuilt bind poses, reconnected detached skins, optional mesh merge
- Random CC0 freebie loader (ToxSam open-source avatars)
- Tauri 2 desktop shell with native save dialogs and a navigation guard

## E1 · Honest UI (Next)

Every visible control must do what it says, and every failure must reach the user.

- Reload model re-opens the current source (local file or URL)
- Status bar FPS is measured, and reads "Idle" when the render loop is asleep
- Explorer "•••" menu: expand all / collapse all groups
- Desktop open, drop and file-association errors show in the viewport instead of only the console
- Rust unit tests for the path guards in `src-tauri/src/lib.rs`

## E2 · Inspect deeper

- Selecting a mesh or bone in the explorer highlights it in the viewport
- Material inspector: shader (MToon / PBR), textures with thumbnails, alpha mode
- Spring bone and collider visualisation toggle
- VRM licence fields shown in full (allowed users, commercial use, redistribution)
- Explorer lists beyond 250 items per group (virtualised list)

## E3 · Look dev and capture

- Persist scene settings between sessions (local only)
- Camera presets: portrait, full body, VRChat-style thumbnail framing
- Transparent capture at custom resolutions
- Short turntable or animation capture to WebM/GIF

## E4 · Release and trust

- Signed Windows installer and notarised macOS build from CI
- Content Security Policy for the Tauri shell (`security.csp` is currently `null`)
- Restrict `write_export_file` to paths the save dialog returned
- Split the 560 kB viewer chunk (three / three-vrm) for faster first load
- Playwright smoke test that loads a fixture VRM in the web build

## Deferred

- FBX / BVH motion import (convert to VRMA externally for now)
- Editing and re-exporting VRM metadata
- Multi-model scenes
