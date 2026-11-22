use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::plugin::Builder as PluginBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

#[cfg(all(windows, not(debug_assertions)))]
use std::path::Path;

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

fn emit_model_path(app: &AppHandle, path: PathBuf) {
    let _ = app.emit("open-model-path", path.to_string_lossy().to_string());
}

fn queue_or_emit_model(app: &AppHandle, pending: &PendingModel, path: PathBuf) {
    if app.get_webview_window("main").is_some() {
        emit_model_path(app, path);
    } else if let Ok(mut guard) = pending.0.lock() {
        *guard = Some(path);
    }
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

#[tauri::command]
fn write_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if !is_export_path(&path) {
        return Err("Exports must be saved as .vrm, .png, .webm, or .mp4.".into());
    }
    if bytes.is_empty() {
        return Err("Refusing to write an empty export.".into());
    }
    let path = PathBuf::from(&path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    std::fs::write(&path, bytes).map_err(|error| error.to_string())
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
            write_export_file
        ]);

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main_window(app);
            if let Some(path) = model_path_from_args(&args) {
                if let Some(pending) = app.try_state::<PendingModel>() {
                    queue_or_emit_model(app, pending.inner(), path);
                } else {
                    emit_model_path(app, path);
                }
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
        .on_page_load(|window, _payload| {
            let app = window.app_handle();
            if let Some(pending) = app.try_state::<PendingModel>() {
                if let Ok(mut guard) = pending.0.lock() {
                    if let Some(path) = guard.take() {
                        emit_model_path(app, path);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
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

    #[test]
    fn write_export_file_rejects_non_export_paths() {
        for name in ["out.glb", "out.exe", "out.vrm.exe", "spin.webm.exe"] {
            let path = unique_temp_path(name);
            let result = write_export_file(path_string(&path), vec![1, 2, 3]);
            assert_eq!(
                result,
                Err("Exports must be saved as .vrm, .png, .webm, or .mp4.".to_string()),
                "for {name}"
            );
            assert!(!path.exists());
        }
    }

    #[test]
    fn write_export_file_rejects_empty_bytes() {
        let path = unique_temp_path("empty.png");
        let result = write_export_file(path_string(&path), Vec::new());
        assert_eq!(result, Err("Refusing to write an empty export.".to_string()));
        assert!(!path.exists());
    }

    #[test]
    fn write_export_file_creates_nested_dirs_and_writes_bytes() {
        let root = unique_temp_path("export-dir");
        let path = root.join("nested").join("deeper").join("out.vrm");
        assert!(!root.exists());
        let content = vec![0u8, 1, 2, 3, 254, 255];
        let result = write_export_file(path_string(&path), content.clone());
        let written = std::fs::read(&path);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(result, Ok(()));
        assert_eq!(written.expect("read back export"), content);
        assert!(!root.exists());
    }

    #[test]
    fn write_export_file_writes_video_files() {
        let root = unique_temp_path("video-dir");
        for name in ["spin.webm", "clip.MP4"] {
            let path = root.join(name);
            let content = vec![0x1a, 0x45, 0xdf, 0xa3, 1, 2];
            assert_eq!(
                write_export_file(path_string(&path), content.clone()),
                Ok(()),
                "for {name}"
            );
            assert_eq!(std::fs::read(&path).expect("read back video"), content);
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
