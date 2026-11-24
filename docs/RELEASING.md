# Releasing the desktop app

`.github/workflows/release.yml` builds the Windows installer and the macOS app and attaches
them to a **draft** GitHub release. Nothing is published until you press Publish.
By deac online · Worldbuild.io

| Runner | Output |
| --- | --- |
| `windows-latest` | `Deez VRM Viewer_<version>_x64-setup.exe` (per-user NSIS installer) |
| `macos-latest` | `Deez VRM Viewer_<version>_universal.dmg` (Apple Silicon + Intel, built with `--target universal-apple-darwin`) |

Windows bundling comes from `bundle.targets: ["nsis"]` in `src-tauri/tauri.conf.json`. On macOS
Tauri also merges `src-tauri/tauri.macos.conf.json`, which switches the targets to
`["app", "dmg"]`, so a local `npm run tauri build` works on a Mac too. The workflow also passes
`--bundles` explicitly.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json` (and keep `package.json` / `src-tauri/Cargo.toml`
   in step). The release tag is always `v<version>`.
2. Commit, then tag and push:
   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```
   You can also run **Actions → Release → Run workflow** on a branch. That creates (or
   reuses) the draft `v<version>` at that commit without you pushing a tag.
3. The `draft` job fails early if the tag doesn't match `v<version>`, or if `v<version>` is
   already published. Re-running on an existing draft reuses it and replaces its assets.
4. Wait for both build jobs, check the draft's assets (download and launch each one), then edit
   the notes and press **Publish release**. Publishing creates the git tag if the run was
   manual.

Each job logs a warning when its signing secrets are missing. The build still succeeds and
uploads an unsigned artifact.

## Signing secrets

Add these under **Settings → Secrets and variables → Actions → Repository secrets**. Each
platform is all-or-nothing: if one secret in a group is missing, that part is skipped.

### Windows (Authenticode)

| Secret | What it is |
| --- | --- |
| `WINDOWS_CERTIFICATE` | Your code-signing certificate and private key as a `.pfx`, **base64-encoded**. |
| `WINDOWS_CERTIFICATE_PASSWORD` | The password of that `.pfx`. |

Optional repository **variable** (not secret) `WINDOWS_TIMESTAMP_URL`: RFC 3161 timestamp server.
Default `http://timestamp.digicert.com`. Use your CA's server if it has one.

How to produce them:

1. Buy an OV or EV code-signing certificate (or export an existing one) and export it with its
   private key: `certmgr.msc` → Personal → Certificates → right-click → All Tasks → Export →
   "Yes, export the private key" → `.pfx` with a strong password.
   (EV certificates on hardware tokens or cloud HSMs can't be exported. For those, replace the
   import step with your vendor's `signCommand`, e.g. Azure Trusted Signing or SSL.com eSigner.)
2. Base64-encode it (PowerShell):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("codesign.pfx")) | Set-Clipboard
   ```
   and paste it as `WINDOWS_CERTIFICATE`.

In CI the workflow imports the PFX into the runner's `CurrentUser\My` store, then deletes the
file. It passes `bundle.windows.certificateThumbprint`, `digestAlgorithm: sha256` and
`timestampUrl` to `tauri build` through a temporary `--config` override, so
`tauri.conf.json` never contains signing details and local builds stay unsigned. Tauri then signs
the app exe, the NSIS installer and its uninstaller with `signtool`.

Without these secrets the installer is unsigned and SmartScreen will warn ("Windows protected
your PC → More info → Run anyway").

### macOS (Developer ID signing and notarisation)

Signing, all three required:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | Your **Developer ID Application** certificate and private key as a `.p12`, base64-encoded. |
| `APPLE_CERTIFICATE_PASSWORD` | The password of that `.p12`. |
| `APPLE_SIGNING_IDENTITY` | The certificate's name, e.g. `Developer ID Application: Your Name (TEAMID1234)`. |

Notarisation, all three required. Only used when the signing secrets are also set:

| Secret | What it is |
| --- | --- |
| `APPLE_ID` | The Apple ID email of an account in your developer team. |
| `APPLE_PASSWORD` | An **app-specific password** for that Apple ID (appleid.apple.com → Sign-In and Security → App-Specific Passwords), not the account password. |
| `APPLE_TEAM_ID` | Your 10-character Team ID (developer.apple.com → Membership details). |

How to produce them:

1. On a Mac, create a **Developer ID Application** certificate (Xcode → Settings → Accounts →
   Manage Certificates → + → Developer ID Application, or developer.apple.com → Certificates).
   You need a paid Apple Developer Program membership.
2. In Keychain Access, find the certificate under *My Certificates*, expand it so the private key is
   included, right-click → Export → `.p12` with a password.
3. Base64-encode it: `base64 -i certificate.p12 | pbcopy` and paste as `APPLE_CERTIFICATE`.
4. Get the exact identity string with `security find-identity -v -p codesigning`.

These are the standard variables `tauri build` reads (via `tauri-apps/tauri-action`). The
workflow exports each one only when it is actually set, because Tauri treats a present but empty
variable as configured and would fail.

Without signing secrets the app is **ad-hoc signed** (`APPLE_SIGNING_IDENTITY=-`) so the
universal binary still runs on Apple Silicon. Gatekeeper will block it on first launch: right-click
→ Open, or run `xattr -dr com.apple.quarantine "/Applications/Deez VRM Viewer.app"`. With signing
secrets but no notarisation secrets, the app is signed but not notarised, and Gatekeeper still
warns.

## Notes

- `tauri-apps/tauri-action` is pinned to the v1.0.0 commit SHA. Bump it on purpose and read its
  changelog first.
- The Windows release exe has an in-repo updater hand-off (`try_handoff_to_updater` in
  `src-tauri/src/lib.rs`). It only runs when the exe sits inside a git clone with
  `scripts/launch.ps1`, so installed copies are unaffected and CI never runs the exe.
- The updater JSON (`latest.json`) is not generated. The app has no auto-updater plugin.
