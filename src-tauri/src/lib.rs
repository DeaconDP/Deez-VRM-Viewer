use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::plugin::Builder as PluginBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

#[cfg(all(windows, not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(all(windows, not(debug_assertions)))]
fn is_repo_root(path: &Path) -> bool {
    path.join("package.json").is_file()
        && path.join(".git").exists()
        && path.join("scripts").join("launch.ps1").is_file()
}

#[cfg(all(windows, not(debug_assertions)))]
fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        if is_repo_root(&current) {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

#[cfg(all(windows, not(debug_assertions)))]
fn launch_script(root: &Path) -> PathBuf {
    root.join("scripts").join("launch.ps1")
}

/// Returns true when `.run/built-stamp` matches current sources + release exe.
#[cfg(all(windows, not(debug_assertions)))]
fn verify_release_is_fresh(root: &Path) -> bool {
    let script = launch_script(root);
    if !script.is_file() {
        return false;
    }

    let mut command = std::process::Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script)
        .arg("-VerifyOnly")
        .current_dir(root)
        .env_remove("DEEZ_VRM_SKIP_UPDATE");

    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);

    match command.status() {
        Ok(status) => status.code() == Some(0),
        Err(_) => false,
    }
}

#[cfg(all(windows, not(debug_assertions)))]
fn spawn_updater(root: &Path) -> bool {
    let script = launch_script(root);
    let mut command = std::process::Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script)
        .arg("-FromExe")
        .args(std::env::args().skip(1))
        .current_dir(root)
        // Never let a stale parent env force the child to skip rebuild.
        .env_remove("DEEZ_VRM_SKIP_UPDATE");

    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);

    command.spawn().is_ok()
}

/// When the release exe is launched from inside a git clone, hand off to
/// `scripts/launch.ps1` so it can pull/rebuild before relaunching with
/// `DEEZ_VRM_SKIP_UPDATE=1`. Returns true if this process should exit.
///
/// Even with `DEEZ_VRM_SKIP_UPDATE` set, refuse to continue unless
/// `-VerifyOnly` confirms the release binary matches current sources.
#[cfg(all(windows, not(debug_assertions)))]
fn try_handoff_to_updater() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Some(exe_dir) = exe.parent() else {
        return false;
    };
    let Some(root) = find_repo_root(exe_dir) else {
        return false;
    };

    let skip_requested = std::env::var_os("DEEZ_VRM_SKIP_UPDATE").is_some();
    if skip_requested && verify_release_is_fresh(&root) {
        return false;
    }

    // In-repo launches must never continue on a stale binary. If the updater
    // spawn fails, still exit this process rather than opening stale UI.
    let _ = spawn_updater(&root);
    true
}

struct PendingModel(Mutex<Option<PathBuf>>);

#[derive(Clone, Serialize)]
struct ModelFile {
    name: String,
    bytes: Vec<u8>,
}

fn is_model_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".vrm") || lower.ends_with(".glb") || lower.ends_with(".gltf")
}

fn is_export_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [".vrm", ".png", ".webm", ".mp4"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn model_path_from_args(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .find(|argument| is_model_path(argument))
        .map(PathBuf::from)
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Stores the path for the frontend to take and pings it. The ping carries no path: an event sent before the page has
/// registered its listener is dropped, so the frontend always pulls with `take_pending_model_path` (on startup once its
/// listener exists, then on every ping), and no open is lost while the window is still loading. The newest open wins.
fn emit_model_path(app: &AppHandle, path: PathBuf) {
    if let Some(pending) = app.try_state::<PendingModel>() {
        if let Ok(mut guard) = pending.0.lock() {
            *guard = Some(path);
        }
    }
    let _ = app.emit("open-model-pending", ());
}

fn choose_model(app: &AppHandle) {
    let handle = app.clone();
    app.dialog()
        .file()
        .set_title("Open a VRM or glTF model")
        .add_filter("VRM and glTF models", &["vrm", "glb", "gltf"])
        .pick_file(move |file| {
            if let Some(file) = file {
                if let Ok(path) = file.into_path() {
                    emit_model_path(&handle, path);
                }
            }
        });
}

fn open_external(app: &AppHandle, url: &str) {
    if let Err(error) = app.opener().open_url(url, None::<&str>) {
        let _ = app
            .dialog()
            .message(format!("Could not open link:\n{error}"))
            .kind(MessageDialogKind::Error)
            .title("Deez VRM Viewer")
            .blocking_show();
    }
}

#[tauri::command]
fn read_model_file(path: String) -> Result<ModelFile, String> {
    if !is_model_path(&path) {
        return Err("Choose a .vrm, .glb, or .gltf model.".into());
    }
    let path = PathBuf::from(&path);
    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("This file is empty and cannot be opened.".into());
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "model.vrm".into());
    Ok(ModelFile { name, bytes })
}

#[tauri::command]
fn take_pending_model_path(pending: State<'_, PendingModel>) -> Option<String> {
    pending
        .0
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
        .map(|path| path.to_string_lossy().into_owned())
}

/// File extensions the desktop shell will ever write, lowercase and without the dot.
const EXPORT_EXTENSIONS: [&str; 4] = ["vrm", "png", "webm", "mp4"];

/// What the webview asked to save. It never contains a destination path: the
/// path only ever comes from the native save dialog opened on the Rust side.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ExportRequest {
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct SaveExportResult {
    saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

/// Validates a save request before any dialog is shown: non-empty bytes, at
/// least one allowlisted extension, and a bare default file name (any
/// directory part supplied by the webview is dropped so it cannot steer the
/// dialog's starting folder).
fn validate_export_request(
    default_name: &str,
    filter_name: &str,
    extensions: &[String],
    bytes: &[u8],
) -> Result<ExportRequest, String> {
    if bytes.is_empty() {
        return Err("Refusing to write an empty export.".into());
    }
    let mut normalized: Vec<String> = Vec::new();
    for extension in extensions {
        let extension = extension.trim().trim_start_matches('.').to_ascii_lowercase();
        if !EXPORT_EXTENSIONS.contains(&extension.as_str()) {
            return Err("Exports must be saved as .vrm, .png, .webm, or .mp4.".into());
        }
        if !normalized.contains(&extension) {
            normalized.push(extension);
        }
    }
    if normalized.is_empty() {
        return Err("Exports must be saved as .vrm, .png, .webm, or .mp4.".into());
    }
    let base_name = default_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    let default_name = if base_name.is_empty() || base_name == "." || base_name == ".." {
        format!("export.{}", normalized[0])
    } else {
        base_name
    };
    let filter_name = if filter_name.trim().is_empty() {
        "Export".to_string()
    } else {
        filter_name.trim().to_string()
    };
    Ok(ExportRequest {
        default_name,
        filter_name,
        extensions: normalized,
    })
}

fn has_requested_extension(path: &Path, extensions: &[String]) -> bool {
    is_export_path(&path.to_string_lossy())
        && path
            .extension()
            .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
            .is_some_and(|extension| extensions.contains(&extension))
}

/// Writes an export to the path the native dialog returned. `None` means the
/// user cancelled. The path must still carry one of the requested (and
/// allowlisted) extensions, because some platforms let the user type any name.
fn write_dialog_export(
    chosen: Option<PathBuf>,
    request: &ExportRequest,
    bytes: &[u8],
) -> Result<SaveExportResult, String> {
    let Some(path) = chosen else {
        return Ok(SaveExportResult {
            saved: false,
            path: None,
        });
    };
    if bytes.is_empty() {
        return Err("Refusing to write an empty export.".into());
    }
    if !has_requested_extension(&path, &request.extensions) {
        let expected = request
            .extensions
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect::<Vec<_>>()
            .join(" or ");
        return Err(format!("This export must be saved as {expected}."));
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(SaveExportResult {
        saved: true,
        path: Some(path.to_string_lossy().into_owned()),
    })
}

/// Opens the native Save dialog and writes `bytes` only to the path the user
/// picked there; the webview can never name a destination. Async so the
/// blocking dialog never runs on the main thread.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn save_export_file(
    app: AppHandle,
    window: tauri::WebviewWindow,
    title: Option<String>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    bytes: Vec<u8>,
) -> Result<SaveExportResult, String> {
    let request = validate_export_request(&default_name, &filter_name, &extensions, &bytes)?;
    let extension_refs: Vec<&str> = request.extensions.iter().map(String::as_str).collect();
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&request.default_name)
        .add_filter(&request.filter_name, &extension_refs);
    if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
        dialog = dialog.set_title(title);
    }
    #[cfg(desktop)]
    {
        dialog = dialog.set_parent(&window);
    }
    #[cfg(not(desktop))]
    let _ = &window;
    let chosen = match dialog.blocking_save_file() {
        Some(file) => Some(file.into_path().map_err(|error| error.to_string())?),
        None => None,
    };
    write_dialog_export(chosen, &request, &bytes)
}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let open = MenuItemBuilder::with_id("open-model", "Open Model…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&open)
        .separator()
        .item(&quit)
        .build()?;

    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let fullscreen = MenuItemBuilder::with_id("toggle-fullscreen", "Toggle Fullscreen")
        .accelerator("F11")
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&reload)
        .item(&fullscreen)
        .build()?;

    let minimize = PredefinedMenuItem::minimize(app, Some("Minimize"))?;
    let close = PredefinedMenuItem::close_window(app, Some("Close"))?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&minimize)
        .item(&close)
        .build()?;

    MenuBuilder::new(app)
        .item(&file)
        .item(&view)
        .item(&window)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(windows, not(debug_assertions)))]
    {
        if try_handoff_to_updater() {
            return;
        }
    }

    let pending = PendingModel(Mutex::new(model_path_from_args(
        &std::env::args().collect::<Vec<_>>(),
    )));

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            PluginBuilder::<tauri::Wry, ()>::new("navigation-guard")
                .on_navigation(|webview, url| {
                    let scheme = url.scheme();
                    if scheme == "tauri" || scheme == "asset" || scheme.is_empty() {
                        return true;
                    }
                    if scheme == "http" || scheme == "https" {
                        let host = url.host_str().unwrap_or_default();
                        // Allow Vite devUrl and Windows/Android custom-protocol hosts
                        // (https://tauri.localhost/, https://<name>.localhost/).
                        if host == "127.0.0.1"
                            || host == "localhost"
                            || host == "tauri.localhost"
                            || host.ends_with(".localhost")
                        {
                            return true;
                        }
                        open_external(webview.app_handle(), url.as_str());
                        return false;
                    }
                    false
                })
                .build(),
        )
        .manage(pending)
        .invoke_handler(tauri::generate_handler![
            read_model_file,
            take_pending_model_path,
            save_export_file
        ]);

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main_window(app);
            if let Some(path) = model_path_from_args(&args) {
                emit_model_path(app, path);
            }
        }));
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-model" => choose_model(app),
            "reload" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.reload();
                }
            }
            "toggle-fullscreen" => {
                if let Some(window) = app.get_webview_window("main") {
                    let next = !window.is_fullscreen().unwrap_or(false);
                    let _ = window.set_fullscreen(next);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Unique scratch path under the system temp dir; nothing is created yet.
    fn unique_temp_path(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "deez-vrm-test-{}-{nanos}-{n}-{label}",
            std::process::id()
        ))
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn is_model_path_accepts_model_extensions_any_case() {
        for path in [
            "avatar.vrm",
            "avatar.VRM",
            "Avatar.Vrm",
            "scene.glb",
            "scene.GLB",
            "scene.gltf",
            "scene.GlTf",
            r"C:\models\avatar.vrm",
            "/home/user/models/avatar.glb",
        ] {
            assert!(is_model_path(path), "expected {path:?} to be accepted");
        }
    }

    #[test]
    fn is_model_path_rejects_non_model_paths() {
        for path in [
            "",
            "dance.vrma",
            "texture.png",
            "scene.gltf.bak",
            "avatar",
            "foovrm",
            r"C:\models\vrm",
            "/models/glb",
            "avatar.vrm.exe",
        ] {
            assert!(!is_model_path(path), "expected {path:?} to be rejected");
        }
    }

    #[test]
    fn is_export_path_accepts_vrm_png_and_video_any_case() {
        for path in [
            "out.vrm",
            "out.VRM",
            "shot.png",
            "shot.PNG",
            "dir/shot.Png",
            "spin.webm",
            "spin.WEBM",
            "spin.WebM",
            "clip.mp4",
            "clip.MP4",
            r"C:\exports\avatar-turntable.webm",
        ] {
            assert!(is_export_path(path), "expected {path:?} to be accepted");
        }
    }

    #[test]
    fn is_export_path_rejects_other_extensions() {
        for path in [
            "",
            "out.glb",
            "out.gltf",
            "evil.exe",
            "out.vrm.exe",
            "out.png.bak",
            "spin.webm.exe",
            "clip.mp4.bak",
            "clip.mov",
            "anim.gif",
            "webm",
            "foomp4",
        ] {
            assert!(!is_export_path(path), "expected {path:?} to be rejected");
        }
    }

    #[test]
    fn model_path_from_args_skips_argv0_even_if_it_looks_like_a_model() {
        assert_eq!(model_path_from_args(&args(&["viewer.vrm"])), None);
        assert_eq!(
            model_path_from_args(&args(&["viewer.vrm", "real.glb"])),
            Some(PathBuf::from("real.glb"))
        );
    }

    #[test]
    fn model_path_from_args_returns_first_model_and_ignores_flags() {
        let argv = args(&[
            "deez-vrm-viewer.exe",
            "--flag",
            "--verbose=1",
            "notes.txt",
            "first.vrm",
            "second.gltf",
        ]);
        assert_eq!(model_path_from_args(&argv), Some(PathBuf::from("first.vrm")));
    }

    #[test]
    fn model_path_from_args_returns_none_without_models() {
        assert_eq!(model_path_from_args(&[]), None);
        assert_eq!(model_path_from_args(&args(&["app.exe"])), None);
        assert_eq!(
            model_path_from_args(&args(&["app.exe", "--flag", "image.png", "dance.vrma"])),
            None
        );
    }

    #[test]
    fn read_model_file_rejects_non_model_extension_without_touching_fs() {
        // Path does not exist; the extension check must fire before any IO.
        let path = unique_temp_path("not-a-model.png");
        let error = match read_model_file(path_string(&path)) {
            Err(error) => error,
            Ok(_) => panic!("expected an error for a non-model extension"),
        };
        assert_eq!(error, "Choose a .vrm, .glb, or .gltf model.");
        assert!(!path.exists());
    }

    #[test]
    fn read_model_file_rejects_empty_file() {
        let path = unique_temp_path("empty.vrm");
        std::fs::write(&path, b"").expect("create empty temp file");
        let result = read_model_file(path_string(&path));
        let _ = std::fs::remove_file(&path);
        match result {
            Err(error) => assert_eq!(error, "This file is empty and cannot be opened."),
            Ok(_) => panic!("expected an error for an empty file"),
        }
    }

    #[test]
    fn read_model_file_returns_name_and_bytes() {
        let path = unique_temp_path("small.glb");
        let content = b"glTF\x02\x00\x00\x00test-bytes".to_vec();
        std::fs::write(&path, &content).expect("create temp model file");
        let result = read_model_file(path_string(&path));
        let _ = std::fs::remove_file(&path);
        let model = match result {
            Ok(model) => model,
            Err(error) => panic!("expected success, got {error}"),
        };
        let expected_name = path.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(model.name, expected_name);
        assert!(model.name.ends_with("small.glb"));
        assert_eq!(model.bytes, content);
    }

    #[test]
    fn read_model_file_errors_for_missing_file() {
        let path = unique_temp_path("missing.vrm");
        assert!(!path.exists());
        assert!(read_model_file(path_string(&path)).is_err());
    }

    fn strings(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn request(extensions: &[&str]) -> ExportRequest {
        validate_export_request("avatar.png", "Export", &strings(extensions), &[1])
            .expect("valid request")
    }

    #[test]
    fn validate_export_request_rejects_empty_bytes_before_any_dialog() {
        assert_eq!(
            validate_export_request("shot.png", "PNG image", &strings(&["png"]), &[]),
            Err("Refusing to write an empty export.".to_string())
        );
    }

    #[test]
    fn validate_export_request_rejects_non_allowlisted_or_missing_extensions() {
        for extensions in [
            vec![],
            vec!["exe"],
            vec!["png", "exe"],
            vec!["glb"],
            vec!["vrm.exe"],
        ] {
            assert_eq!(
                validate_export_request("out.png", "X", &strings(&extensions), &[1]),
                Err("Exports must be saved as .vrm, .png, .webm, or .mp4.".to_string()),
                "for {extensions:?}"
            );
        }
    }

    #[test]
    fn validate_export_request_normalizes_extensions_and_strips_directories() {
        let request = validate_export_request(
            r"C:\Windows\System32\..\evil/avatar-turntable.webm",
            "  ",
            &strings(&[".WEBM", "webm", "Mp4"]),
            &[1],
        )
        .expect("valid request");
        assert_eq!(request.default_name, "avatar-turntable.webm");
        assert_eq!(request.filter_name, "Export");
        assert_eq!(request.extensions, strings(&["webm", "mp4"]));

        let fallback = validate_export_request("../", "VRM", &strings(&["vrm"]), &[1]).unwrap();
        assert_eq!(fallback.default_name, "export.vrm");
    }

    #[test]
    fn write_dialog_export_cancel_writes_nothing() {
        let result = write_dialog_export(None, &request(&["png"]), &[1, 2, 3]);
        assert_eq!(
            result,
            Ok(SaveExportResult {
                saved: false,
                path: None
            })
        );
    }

    #[test]
    fn write_dialog_export_rejects_dialog_path_with_wrong_extension() {
        let root = unique_temp_path("wrong-ext");
        for name in ["shot.jpg", "shot.png.exe", "shot", "shot.vrm", "spin.webm"] {
            let path = root.join("nested").join(name);
            let result = write_dialog_export(Some(path.clone()), &request(&["png"]), &[1, 2, 3]);
            assert_eq!(
                result,
                Err("This export must be saved as .png.".to_string()),
                "for {name}"
            );
            assert!(!path.exists(), "{name} must not be written");
        }
        assert!(!root.exists(), "no directories are created for a rejected path");
    }

    #[test]
    fn write_dialog_export_rejects_empty_bytes() {
        let path = unique_temp_path("empty.png");
        let result = write_dialog_export(Some(path.clone()), &request(&["png"]), &[]);
        assert_eq!(result, Err("Refusing to write an empty export.".to_string()));
        assert!(!path.exists());
    }

    #[test]
    fn write_dialog_export_creates_nested_dirs_and_writes_bytes() {
        let root = unique_temp_path("export-dir");
        let path = root.join("nested").join("deeper").join("out.VRM");
        assert!(!root.exists());
        let content = vec![0u8, 1, 2, 3, 254, 255];
        let result = write_dialog_export(Some(path.clone()), &request(&["vrm"]), &content);
        let written = std::fs::read(&path);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(
            result,
            Ok(SaveExportResult {
                saved: true,
                path: Some(path_string(&path))
            })
        );
        assert_eq!(written.expect("read back export"), content);
    }

    #[test]
    fn write_dialog_export_writes_any_requested_video_extension() {
        let root = unique_temp_path("video-dir");
        for name in ["spin.webm", "clip.MP4"] {
            let path = root.join(name);
            let content = vec![0x1a, 0x45, 0xdf, 0xa3, 1, 2];
            let result =
                write_dialog_export(Some(path.clone()), &request(&["webm", "mp4"]), &content);
            assert!(
                matches!(result, Ok(SaveExportResult { saved: true, .. })),
                "for {name}"
            );
            assert_eq!(std::fs::read(&path).expect("read back video"), content);
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn save_export_result_serializes_without_path_when_cancelled() {
        let cancelled = serde_json::to_string(&SaveExportResult {
            saved: false,
            path: None,
        })
        .unwrap();
        assert_eq!(cancelled, r#"{"saved":false}"#);
        let saved = serde_json::to_string(&SaveExportResult {
            saved: true,
            path: Some("out.png".into()),
        })
        .unwrap();
        assert_eq!(saved, r#"{"saved":true,"path":"out.png"}"#);
    }
}
