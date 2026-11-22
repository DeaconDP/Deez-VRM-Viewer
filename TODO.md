# TODO

Current epic: **E2 · Inspect deeper** (see [ROADMAP.md](ROADMAP.md)).

## E2 · Inspect deeper

- [x] Selecting a mesh, bone, node or material in the explorer highlights it in the viewport (double-click or Inspector "Frame selection" frames it; click again or Escape clears)
- [ ] Material inspector: shader (MToon / PBR), textures with thumbnails, alpha mode
- [ ] Spring bone and collider visualisation toggle
- [ ] VRM licence fields shown in full (allowed users, commercial use, redistribution)
- [ ] Explorer lists beyond 250 items per group (virtualised list)

## E1 · Honest UI (done, awaiting merge in PR #7)

- [x] Reload model button re-opens the current local file or URL
- [x] Real FPS meter in the status bar ("Idle" when not rendering continuously)
- [x] Explorer "•••" menu: expand all / collapse all
- [x] Surface desktop open / drop / association errors in the viewport error card
- [x] Rust unit tests for `is_model_path`, `is_export_path`, `model_path_from_args`
