# Deez VRM Viewer

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/DeaconDP/Deez-VRM-Viewer@PLACEHOLDER/docs/screenshots/hero.png" alt="Deez VRM Viewer" width="720" />
</p>

Private, local-first VRM 0.x / 1.0 viewer — models never leave your device.

![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Platform: Windows · macOS · PWA](https://img.shields.io/badge/platform-Windows%20%20%7C%20%20macOS%20%20%7C%20%20PWA-informational)

## Who it’s for

People who need to inspect VRM models, play VRMA / bundled motions, or bake meshes without uploading files to a cloud viewer.

## Quick start

**Requires** Node.js 20+, Rust. WebView2 on Windows.

| Platform | How |
|--|--|
| Windows | Double-click **`run.bat`** |
| macOS | Double-click **`run.command`** |
| Terminal | `npm install && npm run tauri:dev` |

Sticky Vite (dev): **http://127.0.0.1:5188**

## Features

- Local drag-and-drop / file picker for `.vrm` / `.glb` / `.gltf`
- Orbit camera, expressions, scene tree, diagnostics
- Bundled Quaternius motions + local `.vrma` import
- Optional mesh baking to a separate `-baked.vrm`

## Limitations

- Animation retargeting requires VRM humanoids (not ordinary glTF)
- Bake Meshes is beta with conservative limits

## Development

`npm run tauri:dev` · `npm run build` · `npm test`

## Credit

Created by [deac.online](https://deac.online) @ [worldbuild.io](https://worldbuild.io)

## License

MIT — see [LICENSE](LICENSE).
