# TODO

Current epic: **E3 · Look dev and capture** (see [ROADMAP.md](ROADMAP.md)). E2 is done, awaiting merge in PRs #8 and #9.

## E3 · Look dev and capture

- [x] Persist scene settings between sessions (local only): lighting, exposure, background colour and grid are saved in this browser (`deez-vrm-viewer:scene:v1`); background images are never stored; "Reset scene" clears the saved value
- [x] Camera presets: full body, portrait, VRChat-style thumbnail framing (Scene panel "Camera" or keys `1` / `2` / `3`; humanoid bones for VRM, bounding box for glTF)
- [ ] Transparent capture at custom resolutions
- [ ] Short turntable or animation capture to WebM/GIF

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
