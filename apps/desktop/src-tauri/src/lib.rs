use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;

fn resolve_under_root(root: &str, relative: &str) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(root.trim());
    if !root_path.is_dir() {
        return Err("Workspace folder does not exist".into());
    }
    let root_canon = root_path
        .canonicalize()
        .map_err(|err| format!("Invalid workspace folder: {err}"))?;

    let rel = relative.trim().trim_start_matches(['/', '\\']);
    if rel.is_empty() {
        return Ok(root_canon);
    }
    if rel.contains('\0') {
        return Err("Invalid path".into());
    }

    let candidate = root_canon.join(rel);
    let mut cleaned = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::ParentDir => {
                if !cleaned.pop() {
                    return Err("Path escapes workspace".into());
                }
            }
            Component::CurDir => {}
            other => cleaned.push(other.as_os_str()),
        }
    }

    let canon = if cleaned.exists() {
        cleaned
            .canonicalize()
            .map_err(|err| format!("Invalid path: {err}"))?
    } else {
        let parent = cleaned
            .parent()
            .ok_or_else(|| "Invalid path".to_string())?
            .canonicalize()
            .map_err(|err| format!("Invalid path: {err}"))?;
        let name = cleaned
            .file_name()
            .ok_or_else(|| "Invalid path".to_string())?;
        parent.join(name)
    };

    if !canon.starts_with(&root_canon) {
        return Err("Path escapes workspace".into());
    }
    Ok(canon)
}

#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Choose workspace folder")
        .pick_folder();
    Ok(folder.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn list_dir(root: String, relative: Option<String>) -> Result<serde_json::Value, String> {
    let path = resolve_under_root(&root, relative.as_deref().unwrap_or(""))?;
    if !path.is_dir() {
        return Err("Not a directory".into());
    }

    let mut entries = Vec::new();
    let read = fs::read_dir(&path).map_err(|err| err.to_string())?;
    for item in read.flatten() {
        let meta = item.metadata().ok();
        let file_type = meta.as_ref().map(|m| {
            if m.is_dir() {
                "dir"
            } else if m.is_file() {
                "file"
            } else {
                "other"
            }
        });
        let name = item.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" || name == "target" || name == "dist" {
            // still show, but keep listing bounded below
        }
        let rel = {
            let root_canon = PathBuf::from(root.trim())
                .canonicalize()
                .map_err(|err| err.to_string())?;
            item.path()
                .strip_prefix(&root_canon)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or(name.clone())
        };
        entries.push(serde_json::json!({
            "name": name,
            "path": rel,
            "kind": file_type.unwrap_or("other"),
            "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
        }));
    }

    entries.sort_by(|a, b| {
        let ak = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let bk = b.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        match (ak, bk) {
            ("dir", "file") => std::cmp::Ordering::Less,
            ("file", "dir") => std::cmp::Ordering::Greater,
            _ => a
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase()
                .cmp(
                    &b.get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_lowercase(),
                ),
        }
    });

    Ok(serde_json::json!({
        "path": relative.unwrap_or_default(),
        "entries": entries.into_iter().take(200).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
fn read_text_file(root: String, relative: String) -> Result<serde_json::Value, String> {
    let path = resolve_under_root(&root, &relative)?;
    if !path.is_file() {
        return Err("Not a file".into());
    }
    let meta = fs::metadata(&path).map_err(|err| err.to_string())?;
    if meta.len() > 400_000 {
        return Err("File is too large to open in Cowork (400KB max)".into());
    }
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    if bytes.iter().any(|b| *b == 0) {
        return Err("Binary files are not supported in the editor".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8".to_string())?;
    Ok(serde_json::json!({
        "path": relative.replace('\\', "/"),
        "content": content,
        "size": meta.len(),
    }))
}

#[tauri::command]
fn write_text_file(root: String, relative: String, content: String) -> Result<serde_json::Value, String> {
    if content.len() > 800_000 {
        return Err("Content is too large to save".into());
    }
    let path = resolve_under_root(&root, &relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&path, content.as_bytes()).map_err(|err| err.to_string())?;
    let meta = fs::metadata(&path).map_err(|err| err.to_string())?;
    Ok(serde_json::json!({
        "path": relative.replace('\\', "/"),
        "size": meta.len(),
        "savedAt": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
    }))
}

#[tauri::command]
fn run_local_command(command: String, cwd: Option<String>) -> Result<serde_json::Value, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Command is empty".into());
    }
    if trimmed.len() > 4000 {
        return Err("Command is too long".into());
    }

    let workdir = match cwd {
        Some(path) => {
            let trimmed_cwd = path.trim();
            if trimmed_cwd.is_empty() {
                return Err("Working directory is empty".into());
            }
            let buf = PathBuf::from(trimmed_cwd);
            if !buf.is_dir() {
                return Err("Working directory does not exist".into());
            }
            Some(buf)
        }
        None => None,
    };

    let mut process = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", trimmed]);
        cmd
    } else {
        // Cap runaway commands so the desk stays responsive.
        let mut cmd = Command::new("sh");
        cmd.args(["-lc", &format!("ulimit -t 120; {}", trimmed)]);
        cmd
    };

    if let Some(dir) = workdir.as_ref() {
        process.current_dir(dir);
    }

    let output = process.output().map_err(|err| err.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);

    Ok(serde_json::json!({
        "code": code,
        "stdout": stdout,
        "stderr": stderr,
        "ranAt": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
    }))
}

#[tauri::command]
fn search_workspace(
    root: String,
    query: String,
    relative: Option<String>,
    glob: Option<String>,
    case_sensitive: Option<bool>,
) -> Result<serde_json::Value, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Query is empty".into());
    }
    if q.len() > 200 {
        return Err("Query is too long".into());
    }
    let start = resolve_under_root(&root, relative.as_deref().unwrap_or(""))?;
    if !start.exists() {
        return Err("Search path does not exist".into());
    }
    let case_sensitive = case_sensitive.unwrap_or(false);
    let needle = if case_sensitive {
        q.to_string()
    } else {
        q.to_lowercase()
    };
    let glob_filter = glob
        .as_ref()
        .map(|g| g.trim().trim_start_matches("*.").to_lowercase())
        .filter(|g| !g.is_empty());

    let root_canon = PathBuf::from(root.trim())
        .canonicalize()
        .map_err(|err| err.to_string())?;

    let skip_dirs = [
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        "coverage",
        ".turbo",
        "vendor",
        "__pycache__",
    ];

    let mut matches = Vec::new();
    let mut files_scanned = 0usize;
    let mut stack = vec![start];

    while let Some(dir) = stack.pop() {
        if matches.len() >= 40 || files_scanned >= 2500 {
            break;
        }
        let read = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for item in read.flatten() {
            if matches.len() >= 40 || files_scanned >= 2500 {
                break;
            }
            let path = item.path();
            let name = item.file_name().to_string_lossy().to_string();
            let meta = match item.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                if skip_dirs.iter().any(|skip| name == *skip) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            if meta.len() > 400_000 {
                continue;
            }
            if let Some(ext_filter) = glob_filter.as_ref() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ext != *ext_filter && !name.to_lowercase().ends_with(ext_filter) {
                    continue;
                }
            }
            files_scanned += 1;
            let bytes = match fs::read(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            if bytes.iter().any(|b| *b == 0) {
                continue;
            }
            let Ok(content) = String::from_utf8(bytes) else {
                continue;
            };
            let haystack = if case_sensitive {
                content.clone()
            } else {
                content.to_lowercase()
            };
            if !haystack.contains(&needle) {
                continue;
            }
            let rel = path
                .strip_prefix(&root_canon)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());

            let mut line_hits = Vec::new();
            for (idx, line) in content.lines().enumerate() {
                let cmp = if case_sensitive {
                    line.to_string()
                } else {
                    line.to_lowercase()
                };
                if cmp.contains(&needle) {
                    line_hits.push(serde_json::json!({
                        "line": idx + 1,
                        "text": line.chars().take(240).collect::<String>(),
                    }));
                    if line_hits.len() >= 5 {
                        break;
                    }
                }
            }
            matches.push(serde_json::json!({
                "path": rel,
                "hits": line_hits,
            }));
        }
    }

    Ok(serde_json::json!({
        "query": q,
        "filesScanned": files_scanned,
        "matchCount": matches.len(),
        "matches": matches,
    }))
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    window
        .set_always_on_top(enabled)
        .map_err(|err| err.to_string())
}

fn sanitize_segment(value: &str, what: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 180 {
        return Err(format!("Invalid {what}"));
    }
    if trimmed.contains("..")
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(format!("Invalid {what}"));
    }
    Ok(trimmed.to_string())
}

fn namespace_dir(app: &tauri::AppHandle, namespace: &str) -> Result<PathBuf, String> {
    let ns = sanitize_segment(namespace, "namespace")?;
    if ns != "cache" && ns != "chats" && ns != "incognito" && ns != "secure" {
        return Err("Unknown store namespace".into());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("store")
        .join(ns);
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    Ok(root)
}

/// Default workspace for Arrab Assistant deliverables (PDF / HTML / CSV) when no folder is attached.
#[tauri::command]
fn ensure_assistant_desk(app: tauri::AppHandle) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("desk");
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    Ok(root.to_string_lossy().to_string())
}

fn store_file(app: &tauri::AppHandle, namespace: &str, key: &str) -> Result<PathBuf, String> {
    Ok(namespace_dir(app, namespace)?.join(format!(
        "{}.json",
        sanitize_segment(key, "key")?
    )))
}

#[tauri::command]
fn device_store_get(
    app: tauri::AppHandle,
    namespace: String,
    key: String,
) -> Result<Option<String>, String> {
    let path = store_file(&app, &namespace, &key)?;
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(path).map_err(|err| err.to_string())?))
}

#[tauri::command]
fn device_store_set(
    app: tauri::AppHandle,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    if value.len() > 8_000_000 {
        return Err("Value is too large to store on this device".into());
    }
    let path = store_file(&app, &namespace, &key)?;
    fs::write(path, value.as_bytes()).map_err(|err| err.to_string())
}

#[tauri::command]
fn device_store_remove(app: tauri::AppHandle, namespace: String, key: String) -> Result<(), String> {
    let path = store_file(&app, &namespace, &key)?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn device_store_keys(
    app: tauri::AppHandle,
    namespace: String,
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    let dir = namespace_dir(&app, &namespace)?;
    let prefix = prefix.unwrap_or_default();
    let mut keys = Vec::new();
    let read = fs::read_dir(&dir).map_err(|err| err.to_string())?;
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if !name.ends_with(".json") {
            continue;
        }
        let key = name.trim_end_matches(".json").to_string();
        if prefix.is_empty() || key.starts_with(&prefix) {
            keys.push(key);
        }
    }
    keys.sort();
    Ok(keys)
}

#[tauri::command]
fn device_store_clear(app: tauri::AppHandle, namespace: String) -> Result<(), String> {
    let dir = namespace_dir(&app, &namespace)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|err| err.to_string())?;
        fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_macos_accessory(app: &tauri::AppHandle) {
    // Menu-bar utility mode: no Arrab Studio name / File-Edit menus on the left.
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[cfg(target_os = "macos")]
fn set_macos_regular(app: &tauri::AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
}

#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    set_macos_regular(&app);

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let _ = window.unminimize();
    let _ = window.show();
    window.set_focus().map_err(|err| err.to_string())
}

fn hide_main_to_companion(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    set_macos_accessory(app);
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentPresencePayload {
    id: String,
    agent_name: String,
    #[serde(default)]
    agent_photo: Option<String>,
    #[serde(default)]
    hue: Option<u16>,
    #[serde(default)]
    face_seed: Option<u64>,
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    preview: Option<String>,
    #[serde(default)]
    progress: Option<f64>,
    state: String,
    #[serde(default)]
    href: Option<String>,
    #[serde(default)]
    approval_id: Option<String>,
}

fn place_agent_presence(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_w = size.width as f64 / scale;
        let win_w = 480.0;
        let x = (logical_w - win_w - 18.0).max(12.0);
        let y = 46.0;
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    }
}

fn size_agent_presence(window: &tauri::WebviewWindow, payload: &AgentPresencePayload) {
    // Full readable square for approvals (not a tiny truncated strip).
    let has_preview = payload
        .preview
        .as_deref()
        .map(|p| !p.trim().is_empty())
        .unwrap_or(false)
        || payload
            .body
            .as_deref()
            .map(|b| b.contains('\n') || b.len() > 80)
            .unwrap_or(false)
        || payload.title.to_lowercase().contains("writ")
        || payload.title.to_lowercase().contains("write")
        || payload.title.to_lowercase().contains("run");
    let (width, height) = if payload.approval_id.is_some() {
        if has_preview {
            (480.0, 520.0)
        } else {
            (480.0, 360.0)
        }
    } else {
        (400.0, 240.0)
    };
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
}

fn ensure_agent_presence_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window("agent-presence") {
        return Ok(existing);
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "agent-presence",
        tauri::WebviewUrl::App("agent-presence.html".into()),
    )
    .title("Arrab Agent")
    .inner_size(480.0, 360.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .shadow(false);

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.transparent(true);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    let window = builder.build().map_err(|err| err.to_string())?;
    place_agent_presence(&window);
    Ok(window)
}

#[tauri::command]
fn agent_presence_show(app: tauri::AppHandle, payload: AgentPresencePayload) -> Result<(), String> {
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if !main_visible {
        #[cfg(target_os = "macos")]
        set_macos_accessory(&app);
    }

    let window = ensure_agent_presence_window(&app)?;
    size_agent_presence(&window, &payload);
    place_agent_presence(&window);
    let _ = window.show();
    // Do not focus — HUD should not steal the front app / menu bar.
    let _ = app.emit_to("agent-presence", "agent-presence:update", payload.clone());
    let _ = app.emit("agent-presence:update", payload.clone());
    let handle = app.clone();
    let again = payload;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(280));
        let _ = handle.emit_to("agent-presence", "agent-presence:update", again.clone());
        let _ = handle.emit("agent-presence:update", again);
    });
    Ok(())
}

#[tauri::command]
fn agent_presence_update(app: tauri::AppHandle, payload: AgentPresencePayload) -> Result<(), String> {
    if app.get_webview_window("agent-presence").is_none() {
        return agent_presence_show(app, payload);
    }
    if let Some(window) = app.get_webview_window("agent-presence") {
        size_agent_presence(&window, &payload);
    }
    let _ = app.emit_to("agent-presence", "agent-presence:update", payload.clone());
    let _ = app.emit("agent-presence:update", payload);
    Ok(())
}

#[tauri::command]
fn agent_presence_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("agent-presence") {
        let _ = window.hide();
    }
    let _ = app.emit("agent-presence:hide", ());
    let _ = app.emit_to("agent-presence", "agent-presence:hide", ());
    Ok(())
}

#[tauri::command]
fn agent_presence_focus_studio(app: tauri::AppHandle) -> Result<(), String> {
    focus_main_window(app)
}

fn companion_panel_size() -> (f64, f64) {
    (400.0, 640.0)
}

fn place_companion_panel(window: &tauri::WebviewWindow, tray_rect: Option<&tauri::Rect>) {
    let (win_w, win_h) = companion_panel_size();
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: win_w,
        height: win_h,
    }));

    let scale = window.scale_factor().unwrap_or(1.0);
    let mut x = 12.0_f64;
    let mut y = 28.0_f64;

    if let Some(rect) = tray_rect {
        let (px, py) = match rect.position {
            tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
            tauri::Position::Logical(p) => (p.x * scale, p.y * scale),
        };
        let (pw, ph) = match rect.size {
            tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
            tauri::Size::Logical(s) => (s.width * scale, s.height * scale),
        };
        let icon_center_x = (px + pw / 2.0) / scale;
        let icon_bottom = (py + ph) / scale;
        x = icon_center_x - win_w / 2.0;
        y = icon_bottom + 8.0;
    } else if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let logical_w = size.width as f64 / scale;
        x = (logical_w - win_w - 20.0).max(12.0);
        y = 28.0;
    }

    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        x = x.clamp(8.0, (logical_w - win_w - 8.0).max(8.0));
        y = y.clamp(24.0, (logical_h - win_h - 8.0).max(24.0));
    }

    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
}

fn ensure_companion_panel(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window("companion-panel") {
        return Ok(existing);
    }

    let (win_w, win_h) = companion_panel_size();
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "companion-panel",
        tauri::WebviewUrl::App("companion-panel.html".into()),
    )
    .title("Companion")
    .inner_size(win_w, win_h)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .shadow(true)
    .background_color(tauri::window::Color(0x17, 0x17, 0x1f, 0xff));

    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    // Opaque panel — no glass / transparency.
    let window = builder.build().map_err(|err| err.to_string())?;
    place_companion_panel(&window, None);
    Ok(window)
}

fn show_companion_panel(app: &tauri::AppHandle, tray_rect: Option<&tauri::Rect>) -> Result<(), String> {
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    // Only use menu-bar accessory mode when Studio is already hidden.
    // Never hide/close the main window just because the companion opened.
    if !main_visible {
        #[cfg(target_os = "macos")]
        set_macos_accessory(app);
    }

    let window = ensure_companion_panel(app)?;
    place_companion_panel(&window, tray_rect);
    let _ = window.show();
    if main_visible {
        // Keep Studio open; don't steal app activation / menu bar.
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_focus();
    }
    let _ = app.emit_to("companion-panel", "companion-panel:refresh", ());
    Ok(())
}

#[tauri::command]
fn companion_panel_toggle(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_companion_panel(&app)?;
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        Ok(())
    } else {
        show_companion_panel(&app, None)
    }
}

#[tauri::command]
fn companion_panel_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("companion-panel") {
        let _ = window.hide();
    }
    Ok(())
}

fn install_tray(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open_studio =
        MenuItem::with_id(app, "open_studio", "Open Studio", true, None::<&str>)
            .map_err(|err| err.to_string())?;
    let open_item =
        MenuItem::with_id(app, "open_panel", "Companion", true, None::<&str>)
            .map_err(|err| err.to_string())?;
    let quit_item =
        MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|err| err.to_string())?;
    let menu = Menu::with_items(app, &[&open_item, &open_studio, &quit_item])
        .map_err(|err| err.to_string())?;

    // Arrab "A" monochrome template — system tints it white in the menu bar.
    let icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))
        .map_err(|err| format!("Tray template icon failed to load: {err}"))?;

    let handle = app.clone();
    let mut builder = TrayIconBuilder::with_id("arrab-companion")
        .icon(icon)
        .tooltip("Companion")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open_panel" => {
                let rect = app
                    .tray_by_id("arrab-companion")
                    .and_then(|tray| tray.rect().ok().flatten());
                let _ = match &rect {
                    Some(r) => show_companion_panel(app, Some(r)),
                    None => companion_panel_toggle(app.clone()),
                };
            }
            "open_studio" => {
                let _ = focus_main_window(app.clone());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                // Tray click only toggles the companion panel — never opens Studio.
                let window = ensure_companion_panel(&handle).ok();
                if let Some(window) = window {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = show_companion_panel(&handle, Some(&rect));
                    }
                }
            }
        });

    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder.build(app).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Only http(s) URLs are allowed".into());
    }
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(trimmed).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .status()
    } else {
        Command::new("xdg-open").arg(trimmed).status()
    }
    .map_err(|err| err.to_string())?;
    if !status.success() {
        return Err("Failed to open browser".into());
    }
    Ok(())
}

#[tauri::command]
fn delete_path(root: String, relative: String) -> Result<serde_json::Value, String> {
    let path = resolve_under_root(&root, &relative)?;
    if !path.exists() {
        return Err("Path does not exist".into());
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|err| err.to_string())?;
    } else {
        fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    Ok(serde_json::json!({
        "path": relative.replace('\\', "/"),
        "deleted": true,
    }))
}

#[tauri::command]
fn rename_path(root: String, from: String, to: String) -> Result<serde_json::Value, String> {
    let src = resolve_under_root(&root, &from)?;
    let dest = resolve_under_root(&root, &to)?;
    if !src.exists() {
        return Err("Source path does not exist".into());
    }
    if dest.exists() {
        return Err("Destination already exists".into());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::rename(&src, &dest).map_err(|err| err.to_string())?;
    Ok(serde_json::json!({
        "from": from.replace('\\', "/"),
        "to": to.replace('\\', "/"),
    }))
}

#[tauri::command]
fn create_dir(root: String, relative: String) -> Result<serde_json::Value, String> {
    let path = resolve_under_root(&root, &relative)?;
    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(serde_json::json!({
        "path": relative.replace('\\', "/"),
        "created": true,
    }))
}

#[tauri::command]
fn open_path(root: String, relative: Option<String>) -> Result<serde_json::Value, String> {
    let path = resolve_under_root(&root, relative.as_deref().unwrap_or(""))?;
    if !path.exists() {
        return Err("Path does not exist".into());
    }
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(&path).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .status()
    } else {
        Command::new("xdg-open").arg(&path).status()
    }
    .map_err(|err| err.to_string())?;
    if !status.success() {
        return Err("Failed to open path".into());
    }
    Ok(serde_json::json!({
        "path": relative.unwrap_or_else(|| ".".into()).replace('\\', "/"),
        "opened": true,
    }))
}

const AGENTS_OFFICE_URL: &str = "http://127.0.0.1:4520";
static AGENTS_OFFICE_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn agents_office_root() -> Result<PathBuf, String> {
    let from_manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../apps/agents-office");
    if from_manifest.join("serve.mjs").exists() {
        return from_manifest
            .canonicalize()
            .map_err(|err| format!("Agents Office path invalid: {err}"));
    }
    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
    for candidate in [
        cwd.join("apps/agents-office"),
        cwd.join("../apps/agents-office"),
        cwd.join("../../apps/agents-office"),
        cwd.join("agents-office"),
    ] {
        if candidate.join("serve.mjs").exists() {
            return candidate
                .canonicalize()
                .map_err(|err| format!("Agents Office path invalid: {err}"));
        }
    }
    Err("apps/agents-office not found".into())
}

fn agents_office_up() -> bool {
    TcpStream::connect_timeout(
        &"127.0.0.1:4520".parse().expect("static addr"),
        Duration::from_millis(200),
    )
    .is_ok()
}

#[tauri::command]
fn ensure_agents_office() -> Result<String, String> {
    if agents_office_up() {
        return Ok(AGENTS_OFFICE_URL.to_string());
    }

    let root = agents_office_root()?;
    let html = root.join("dist/command-centre-v2.html");
    if !html.exists() {
        return Err("Build agents-office first: cd apps/agents-office && npm install && npm run build".into());
    }

    let mut child = Command::new("node")
        .arg("serve.mjs")
        .current_dir(&root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Failed to start Agents Office: {err}"))?;

    for _ in 0..50 {
        if agents_office_up() {
            if let Ok(mut slot) = AGENTS_OFFICE_CHILD.lock() {
                *slot = Some(child);
            } else {
                let _ = child.kill();
            }
            return Ok(AGENTS_OFFICE_URL.to_string());
        }
        thread::sleep(Duration::from_millis(120));
    }

    let _ = child.kill();
    Err("Agents Office did not become ready on port 4520".into())
}

#[tauri::command]
fn agents_office_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "url": AGENTS_OFFICE_URL,
        "up": agents_office_up(),
        "root": agents_office_root().ok().map(|p| p.to_string_lossy().to_string()),
    }))
}

/// Ephemeral LAN preview so a real phone can open Studio designs on the same Wi‑Fi.
static PHONE_PREVIEW_HTML: Mutex<Option<Arc<String>>> = Mutex::new(None);
static PHONE_PREVIEW_PORT: Mutex<Option<u16>> = Mutex::new(None);

fn lan_ipv4() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        for iface in ["en0", "en1", "en2"] {
            if let Ok(output) = Command::new("ipconfig").args(["getifaddr", iface]).output() {
                if output.status.success() {
                    let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !ip.is_empty() {
                        return Some(ip);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress)",
            ])
            .output()
        {
            if output.status.success() {
                let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !ip.is_empty() {
                    return Some(ip);
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("hostname").args(["-I"]).output() {
            if output.status.success() {
                let ips = String::from_utf8_lossy(&output.stdout);
                if let Some(ip) = ips.split_whitespace().next() {
                    if !ip.is_empty() && ip != "127.0.0.1" {
                        return Some(ip.to_string());
                    }
                }
            }
        }
    }
    None
}

fn ensure_phone_preview_server() -> Result<u16, String> {
    if let Some(port) = *PHONE_PREVIEW_PORT.lock().map_err(|_| "Preview lock poisoned")? {
        return Ok(port);
    }
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|err| format!("Preview bind failed: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("Preview addr failed: {err}"))?
        .port();
    *PHONE_PREVIEW_PORT.lock().map_err(|_| "Preview lock poisoned")? = Some(port);
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = handle_phone_preview_request(stream);
        }
    });
    Ok(port)
}

fn handle_phone_preview_request(mut stream: TcpStream) -> Result<(), String> {
    let mut buf = [0u8; 1024];
    let _ = stream.read(&mut buf);
    let html = PHONE_PREVIEW_HTML
        .lock()
        .map_err(|_| "Preview lock poisoned".to_string())?
        .clone()
        .unwrap_or_else(|| {
            Arc::new(
                "<!doctype html><html><body style=\"font-family:system-ui;padding:2rem\">No preview yet.</body></html>"
                    .into(),
            )
        });
    let body = html.as_bytes();
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .map_err(|err| format!("Preview write failed: {err}"))?;
    stream
        .write_all(body)
        .map_err(|err| format!("Preview write failed: {err}"))?;
    Ok(())
}

#[tauri::command]
fn start_phone_preview(html: String) -> Result<serde_json::Value, String> {
    let trimmed = html.trim();
    if trimmed.is_empty() {
        return Err("Preview HTML is empty".into());
    }
    if trimmed.len() > 2_000_000 {
        return Err("Preview is too large".into());
    }
    *PHONE_PREVIEW_HTML.lock().map_err(|_| "Preview lock poisoned")? = Some(Arc::new(html));
    let port = ensure_phone_preview_server()?;
    let lan = lan_ipv4().unwrap_or_else(|| "127.0.0.1".into());
    let lan_url = format!("http://{lan}:{port}/");
    let local_url = format!("http://127.0.0.1:{port}/");
    Ok(serde_json::json!({
        "port": port,
        "lanUrl": lan_url,
        "localUrl": local_url,
        "lanIp": lan,
    }))
}

fn install_native_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};

    // First submenu becomes the macOS app menu (under "Arrab Studio").
    let app_menu = SubmenuBuilder::new(app, "Arrab Studio")
        .about(None)
        .separator()
        .text("nav-settings", "Settings…")
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .text("file-connect-folder", "Connect Folder…")
        .text("file-new-chat", "New Chat")
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .text("view-reload", "Reload")
        .separator()
        .fullscreen()
        .build()?;

    // App destinations — these show as native macOS menu-bar tabs next to File/Edit.
    let go = SubmenuBuilder::new(app, "Go")
        .text("nav-hq", "HQ")
        .text("nav-workplace", "Workplace")
        .text("nav-chat", "Chat")
        .text("nav-workforce", "Workforce")
        .text("nav-connectors", "Connectors")
        .text("nav-activity", "Activity")
        .separator()
        .text("nav-settings", "Settings")
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .text("help-getting-started", "Getting Started")
        .text("help-website", "Arrab Website")
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&go)
        .item(&window)
        .item(&help)
        .build()?;

    app.set_menu(menu)?;

    let handle = app.handle().clone();
    app.on_menu_event(move |_app, event| {
        let id = event.id().as_ref();
        match id {
            "nav-hq"
            | "nav-workplace"
            | "nav-chat"
            | "nav-workforce"
            | "nav-connectors"
            | "nav-activity"
            | "nav-settings"
            | "file-connect-folder"
            | "file-new-chat"
            | "view-reload"
            | "help-getting-started"
            | "help-website" => {
                let _ = handle.emit("arrab:menu", id);
            }
            _ => {}
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = focus_main_window(app.clone());
        }));
    }

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            run_local_command,
            list_dir,
            read_text_file,
            write_text_file,
            search_workspace,
            delete_path,
            rename_path,
            create_dir,
            open_path,
            set_always_on_top,
            ensure_assistant_desk,
            device_store_get,
            device_store_set,
            device_store_remove,
            device_store_keys,
            device_store_clear,
            open_external_url,
            focus_main_window,
            agent_presence_show,
            agent_presence_update,
            agent_presence_hide,
            agent_presence_focus_studio,
            companion_panel_toggle,
            companion_panel_hide,
            ensure_agents_office,
            agents_office_status,
            start_phone_preview
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
                // Only compiled when the optional `devtools` Cargo feature is on.
                #[cfg(feature = "devtools")]
                {
                    let _ = window.close_devtools();
                }
            }

            if let Err(error) = install_native_menu(app) {
                eprintln!("Arrab Studio menu setup failed: {error}");
            }
            if let Err(error) = install_tray(app.handle()) {
                eprintln!("Arrab Studio tray setup failed: {error}");
            }

            // Drop any stale companion window so the opaque panel is used next open.
            if let Some(panel) = app.get_webview_window("companion-panel") {
                let _ = panel.close();
            }

            // Closing the main window hides to the menu-bar companion — Quit only from tray.
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main_to_companion(&handle);
                    }
                });
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                let _ = app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let _ = handle.emit("arrab:deep-link", url.as_str());
                    }
                    let _ = focus_main_window(handle.clone());
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Arrab Studio");

    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                // Keep the menu-bar companion alive when windows are hidden.
                // Tray "Quit" calls app.exit(0) and sets a code — allow that.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::Reopen { .. } => {
                let _ = focus_main_window(app_handle.clone());
            }
            _ => {}
        }
    });
}
