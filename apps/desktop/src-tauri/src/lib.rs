use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;

/// Menu-bar and presence windows must not reach the desk, shell, or device store.
fn main_window_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    allow_windows(window, &["main"])
}

/// Main Studio and the menu-bar ask panel. The panel sends chat over native HTTP.
fn studio_client_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    allow_windows(window, &["main", "companion-panel"])
}

fn allow_windows(window: &tauri::WebviewWindow, allowed: &[&str]) -> Result<(), String> {
    let label = window.label().to_string();
    if allowed.iter().any(|name| *name == label) {
        return Ok(());
    }
    Err("Blocked: this window cannot use that command".into())
}

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
fn pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    main_window_only(&window)?;
    let folder = rfd::FileDialog::new()
        .set_title("Choose workspace folder")
        .pick_folder();
    Ok(folder.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn list_dir(
    window: tauri::WebviewWindow,
    root: String,
    relative: Option<String>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
fn read_text_file(
    window: tauri::WebviewWindow,
    root: String,
    relative: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
fn write_text_file(
    window: tauri::WebviewWindow,
    root: String,
    relative: String,
    content: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
fn run_local_command(
    window: tauri::WebviewWindow,
    command: String,
    cwd: Option<String>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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

fn companion_sandbox_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("companion-sandbox");
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    root.canonicalize().map_err(|err| err.to_string())
}

fn command_can_wipe(command: &str) -> bool {
    let text = command.trim();
    if text.is_empty() || text.len() > 500 || text.contains('\n') || text.contains('\r') || text.starts_with("```") {
        return true;
    }
    let lower = text.to_ascii_lowercase();
    if lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|word| matches!(word, "mkfs" | "shutdown" | "reboot" | "halt"))
    {
        return true;
    }
    if lower.contains("diskutil") && lower.contains("erase") {
        return true;
    }
    if lower.contains("dd ") && lower.contains("of=/dev/") {
        return true;
    }
    if lower.contains(":(){") || lower.contains(":() {") {
        return true;
    }
    if lower.contains("curl") || lower.contains("wget") {
        if let Some((_, after)) = lower.split_once('|') {
            let next = after.trim_start();
            if next.starts_with("sh") || next.starts_with("bash") {
                return true;
            }
        }
    }
    if lower.contains("rm")
        && (text.contains("$HOME")
            || text.contains("~/")
            || text.contains(" ~")
            || text.contains(" /")
            || text.contains("\t/")
            || text.contains(" /*"))
    {
        return true;
    }
    false
}

fn sandbox_profile(dir: &str) -> String {
    let quoted = dir.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        "(version 1)\n(deny default)\n(allow process*)\n(allow signal (target self))\n(allow sysctl-read)\n(allow mach*)\n(allow ipc-posix*)\n(allow system-socket)\n(allow file-read*)\n(deny file-read* (subpath \"/Users\"))\n(allow file-read* (subpath \"{quoted}\"))\n(allow file-write* (subpath \"{quoted}\"))\n(deny network*)\n"
    )
}

/// One approved command, sealed to the companion folder on this Mac.
#[tauri::command]
fn run_sandbox_command(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    command: String,
    companion: Option<String>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    if !cfg!(target_os = "macos") {
        return Err("The sandbox runs on this Mac".into());
    }
    let trimmed = command.trim();
    if command_can_wipe(trimmed) {
        return Err("That command stays blocked".into());
    }
    let sandbox = match companion.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => machine_dir(&app, id)?.join("Desktop"),
        None => companion_sandbox_dir(&app)?,
    };
    let profile = sandbox_profile(&sandbox.to_string_lossy());
    let quoted = sandbox.to_string_lossy().replace('\'', "'\\''");
    let mut process = Command::new("/usr/bin/sandbox-exec");
    process.arg("-p").arg(profile);
    process.arg("/bin/sh");
    process.args(["-c", &format!("cd '{quoted}' || exit 1; ulimit -t 120; {trimmed}")]);
    process.current_dir(&sandbox);
    let output = process.output().map_err(|err| err.to_string())?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let log_path = sandbox.join("Runs.txt");
    let mut prior = fs::read_to_string(&log_path).unwrap_or_default();
    if prior.len() > 40_000 {
        prior = prior.chars().skip(prior.chars().count().saturating_sub(8_000)).collect();
    }
    let _ = fs::write(
        &log_path,
        format!("{prior}$ {trimmed}\n{stdout}{stderr}exit {code}\n---\n"),
    );
    Ok(serde_json::json!({
        "code": code,
        "stdout": stdout,
        "stderr": stderr,
        "sealed": true,
        "ranAt": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
    }))
}

#[tauri::command]
fn open_companion_sandbox(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    if !cfg!(target_os = "macos") {
        return Err("The sandbox runs on this Mac".into());
    }
    let sandbox = companion_sandbox_dir(&app)?;
    let status = Command::new("open")
        .arg(&sandbox)
        .status()
        .map_err(|err| err.to_string())?;
    if !status.success() {
        return Err("The sandbox folder could not open".into());
    }
    Ok(serde_json::json!({ "opened": true }))
}

fn safe_machine_slug(raw: &str) -> Result<String, String> {
    let slug: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if !(2..=48).contains(&slug.len()) {
        return Err("That computer is not available".into());
    }
    Ok(slug)
}

fn machine_dir(app: &tauri::AppHandle, companion: &str) -> Result<PathBuf, String> {
    let slug = safe_machine_slug(companion)?;
    let root = companion_sandbox_dir(app)?;
    let dir = root.join("machines").join(slug);
    fs::create_dir_all(dir.join("Desktop")).map_err(|err| err.to_string())?;
    let welcome = dir.join("Desktop").join("Welcome.txt");
    if !welcome.exists() {
        fs::write(
            &welcome,
            "This computer is sealed to this companion.\nIt cannot read the rest of this Mac or use the network.\n",
        )
        .map_err(|err| err.to_string())?;
    }
    let canon = dir.canonicalize().map_err(|err| err.to_string())?;
    if !canon.starts_with(&root) {
        return Err("That computer is not available".into());
    }
    Ok(canon)
}

fn desktop_file(machine: &PathBuf, name: &str) -> Result<PathBuf, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 80
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed == "."
        || trimmed == ".."
    {
        return Err("That file stays on this computer".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.ends_with(".txt") || lower.ends_with(".md") || lower.ends_with(".csv") || lower.ends_with(".json")) {
        return Err("This computer keeps text files".into());
    }
    Ok(machine.join("Desktop").join(trimmed))
}

#[tauri::command]
fn sandbox_desktop(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let machine = machine_dir(&app, &companion)?;
    let desktop = machine.join("Desktop");
    let mut files = Vec::new();
    for entry in fs::read_dir(&desktop).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let meta = entry.metadata().map_err(|err| err.to_string())?;
        if !meta.is_file() {
            continue;
        }
        files.push(serde_json::json!({
            "name": name,
            "bytes": meta.len(),
        }));
    }
    files.sort_by(|a, b| {
        a.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .cmp(b.get("name").and_then(|v| v.as_str()).unwrap_or(""))
    });
    Ok(serde_json::json!({ "files": files }))
}

#[tauri::command]
fn sandbox_read_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
    name: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let machine = machine_dir(&app, &companion)?;
    let path = desktop_file(&machine, &name)?;
    let mut file = fs::File::open(&path).map_err(|err| err.to_string())?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).map_err(|err| err.to_string())?;
    if buf.len() > 100_000 {
        buf.truncate(100_000);
    }
    Ok(serde_json::json!({ "text": buf }))
}

#[tauri::command]
fn sandbox_write_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
    name: String,
    text: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    if text.len() > 100_000 {
        return Err("That note is too long".into());
    }
    let machine = machine_dir(&app, &companion)?;
    let path = desktop_file(&machine, &name)?;
    fs::write(&path, text).map_err(|err| err.to_string())?;
    Ok(serde_json::json!({ "saved": true }))
}

fn desktop_filename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 120
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.starts_with('.')
        || trimmed == "."
        || trimmed == ".."
    {
        return Err("That file cannot sit on this desktop".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    const OK: &[&str] = &[
        ".txt", ".md", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".csv", ".json", ".doc",
        ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip",
    ];
    if !OK.iter().any(|ext| lower.ends_with(ext)) {
        return Err("That kind of file cannot sit on this desktop".into());
    }
    Ok(trimmed.to_string())
}

fn copy_onto_desktop(machine: &PathBuf, source: &std::path::Path) -> Result<String, String> {
    let raw_name = source
        .file_name()
        .ok_or("That file cannot sit on this desktop")?
        .to_string_lossy()
        .to_string();
    let name = desktop_filename(&raw_name)?;
    let meta = fs::metadata(source).map_err(|err| err.to_string())?;
    if !meta.is_file() {
        return Err("That file cannot sit on this desktop".into());
    }
    if meta.len() > 30_000_000 {
        return Err("That file is too large for this desktop".into());
    }
    let desktop = machine.join("Desktop");
    let mut dest = desktop.join(&name);
    if dest.exists() {
        let stem = std::path::Path::new(&name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());
        let ext = std::path::Path::new(&name)
            .extension()
            .map(|s| format!(".{}", s.to_string_lossy()))
            .unwrap_or_default();
        dest = desktop.join(format!("{stem}-2{ext}"));
    }
    fs::copy(source, &dest).map_err(|err| err.to_string())?;
    Ok(dest
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or(name))
}

#[tauri::command]
fn sandbox_store_files(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    if paths.len() > 20 {
        return Err("Drop fewer files".into());
    }
    let machine = machine_dir(&app, &companion)?;
    let mut saved = Vec::new();
    for path in paths {
        let name = copy_onto_desktop(&machine, std::path::Path::new(&path))?;
        saved.push(name);
    }
    Ok(serde_json::json!({ "saved": saved }))
}

#[tauri::command]
fn sandbox_import_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let picked = rfd::FileDialog::new().pick_file();
    let Some(path) = picked else {
        return Ok(serde_json::json!({ "saved": false }));
    };
    let machine = machine_dir(&app, &companion)?;
    let name = copy_onto_desktop(&machine, &path)?;
    Ok(serde_json::json!({ "saved": true, "name": name }))
}

fn companion_store_id(slug: &str) -> [u8; 16] {
    let mut id = [0u8; 16];
    for (index, byte) in slug.bytes().enumerate() {
        id[index % 16] ^= byte.wrapping_add(index as u8);
    }
    id
}

fn page_label(slug: &str) -> String {
    format!("desk-{slug}")
}

fn screen_origin(window: &tauri::WebviewWindow, x: f64, y: f64) -> Result<(f64, f64), String> {
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let inner = window.inner_position().map_err(|err| err.to_string())?;
    if scale <= 0.0 {
        return Err("This desktop could not be placed".into());
    }
    Ok((inner.x as f64 / scale + x, inner.y as f64 / scale + y))
}

/// A real browser window for this companion. Sign-in stays on that computer.
#[tauri::command]
fn open_companion_page(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
    url: String,
    title: String,
    chromeless: Option<bool>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let address = browser_url(&url)?;
    let parsed = address.parse::<tauri::Url>().map_err(|err| err.to_string())?;
    let slug = safe_machine_slug(&companion)?;
    let label = page_label(&slug);
    let heading = {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            slug.clone()
        } else {
            trimmed.chars().take(80).collect()
        }
    };
    let embed = chromeless.unwrap_or(false);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.set_title(&heading);
        existing.navigate(parsed).map_err(|err| err.to_string())?;
        if !embed {
            let _ = existing.show();
            let _ = existing.set_focus();
        }
        return Ok(serde_json::json!({ "opened": true }));
    }
    let mut built = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
        .title(heading)
        .decorations(!embed)
        .transparent(false)
        .resizable(!embed)
        .minimizable(!embed)
        .maximizable(!embed)
        .closable(true)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .data_store_identifier(companion_store_id(&slug));
    if embed {
        built = built
            .inner_size(320.0, 240.0)
            .min_inner_size(80.0, 80.0)
            .visible(false)
            .focused(false);
    } else {
        built = built
            .inner_size(1180.0, 780.0)
            .min_inner_size(720.0, 480.0)
            .focused(true)
            .center();
    }
    built.build().map_err(|err| err.to_string())?;
    Ok(serde_json::json!({ "opened": true }))
}

#[tauri::command]
fn place_companion_page(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let slug = safe_machine_slug(&companion)?;
    let Some(existing) = app.get_webview_window(&page_label(&slug)) else {
        return Ok(serde_json::json!({ "placed": false }));
    };
    if width < 80.0 || height < 80.0 {
        return Ok(serde_json::json!({ "placed": false }));
    }
    let (screen_x, screen_y) = screen_origin(&window, x, y)?;
    existing
        .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(screen_x, screen_y)))
        .map_err(|err| err.to_string())?;
    existing
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
        .map_err(|err| err.to_string())?;
    let _ = existing.show();
    Ok(serde_json::json!({ "placed": true }))
}

#[tauri::command]
fn close_companion_page(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let slug = safe_machine_slug(&companion)?;
    if let Some(existing) = app.get_webview_window(&page_label(&slug)) {
        existing.close().map_err(|err| err.to_string())?;
    }
    Ok(serde_json::json!({ "closed": true }))
}

fn browser_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Ok("https://www.google.com".into());
    }
    if url.len() > 500 || url.contains(['\n', '\r', '"', '\'', ' ', '\\']) {
        return Err("That address is not allowed".into());
    }
    if url.starts_with("javascript:") || url.starts_with("file:") || url.starts_with("data:") {
        return Err("Start the address with https://".into());
    }
    if url.starts_with("https://") || url.starts_with("http://") {
        return Ok(url.to_string());
    }
    Ok(format!("https://{url}"))
}

/// Opens this companion's own Chrome profile. Sign-in stays on that computer.
#[tauri::command]
fn open_companion_browser(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    companion: String,
    url: Option<String>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    if !cfg!(target_os = "macos") {
        return Err("Chrome opens on this Mac".into());
    }
    let address = browser_url(url.as_deref().unwrap_or(""))?;
    let chrome = PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    if !chrome.exists() {
        return Err("Google Chrome is not installed on this Mac".into());
    }
    let machine = machine_dir(&app, &companion)?;
    let profile = machine.join("chrome");
    fs::create_dir_all(&profile).map_err(|err| err.to_string())?;
    let child = Command::new(chrome)
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--new-window")
        .arg(address)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| err.to_string())?;
    thread::spawn(move || {
        let _ = child.wait_with_output();
    });
    Ok(serde_json::json!({ "opened": true }))
}

#[tauri::command]
fn sandbox_handoff(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    from: String,
    to: String,
    text: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let note = text.trim();
    if note.len() < 2 || note.len() > 8_000 {
        return Err("Write what they should see".into());
    }
    let from_slug = safe_machine_slug(&from)?;
    let target = machine_dir(&app, &to)?;
    let shared = machine_dir(&app, "shared")?;
    let letter = format!("From {from_slug}\n\n{note}\n");
    let file_name = format!("From-{from_slug}.txt");
    fs::write(desktop_file(&target, &file_name)?, &letter).map_err(|err| err.to_string())?;
    let desk = desktop_file(&shared, "Desk.txt")?;
    let mut previous = fs::read_to_string(&desk).unwrap_or_default();
    if previous.len() > 60_000 {
        previous.truncate(60_000);
    }
    previous.push_str(&format!("\n---\n{letter}"));
    fs::write(desk, previous).map_err(|err| err.to_string())?;
    Ok(serde_json::json!({ "saved": true }))
}

#[tauri::command]
fn search_workspace(
    window: tauri::WebviewWindow,
    root: String,
    query: String,
    relative: Option<String>,
    glob: Option<String>,
    case_sensitive: Option<bool>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
fn set_always_on_top(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    main_window_only(&window)?;
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
fn ensure_assistant_desk(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    main_window_only(&window)?;
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
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    namespace: String,
    key: String,
) -> Result<Option<String>, String> {
    main_window_only(&window)?;
    let path = store_file(&app, &namespace, &key)?;
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(path).map_err(|err| err.to_string())?))
}

#[tauri::command]
fn device_store_set(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    main_window_only(&window)?;
    if value.len() > 8_000_000 {
        return Err("Value is too large to store on this device".into());
    }
    let path = store_file(&app, &namespace, &key)?;
    fs::write(path, value.as_bytes()).map_err(|err| err.to_string())
}

#[tauri::command]
fn device_store_remove(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    namespace: String,
    key: String,
) -> Result<(), String> {
    main_window_only(&window)?;
    let path = store_file(&app, &namespace, &key)?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn device_store_keys(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    namespace: String,
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    main_window_only(&window)?;
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
fn device_store_clear(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    namespace: String,
) -> Result<(), String> {
    main_window_only(&window)?;
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
fn focus_main_window(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    main_window_only(&window)?;
    focus_main_window_inner(app)
}

fn focus_main_window_inner(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    set_macos_regular(&app);

    if app
        .try_state::<AppUpdater>()
        .is_some_and(|state| state.running.load(std::sync::atomic::Ordering::SeqCst))
    {
        return show_updater_window(&app);
    }

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
fn agent_presence_show(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    payload: AgentPresencePayload,
) -> Result<(), String> {
    main_window_only(&window)?;
    agent_presence_show_inner(app, payload)
}

fn agent_presence_show_inner(app: tauri::AppHandle, payload: AgentPresencePayload) -> Result<(), String> {
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
fn agent_presence_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    payload: AgentPresencePayload,
) -> Result<(), String> {
    main_window_only(&window)?;
    if app.get_webview_window("agent-presence").is_none() {
        return agent_presence_show_inner(app, payload);
    }
    if let Some(window) = app.get_webview_window("agent-presence") {
        size_agent_presence(&window, &payload);
    }
    let _ = app.emit_to("agent-presence", "agent-presence:update", payload.clone());
    let _ = app.emit("agent-presence:update", payload);
    Ok(())
}

#[tauri::command]
fn agent_presence_hide(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    allow_windows(&window, &["main", "agent-presence"])?;
    if let Some(window) = app.get_webview_window("agent-presence") {
        let _ = window.hide();
    }
    let _ = app.emit("agent-presence:hide", ());
    let _ = app.emit_to("agent-presence", "agent-presence:hide", ());
    Ok(())
}

#[tauri::command]
fn agent_presence_focus_studio(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    allow_windows(&window, &["main", "agent-presence"])?;
    focus_main_window_inner(app)
}

const COMPANION_PANEL_WIDTH: f64 = 760.0;
const COMPANION_PANEL_BOTTOM_GAP: f64 = 36.0;
/// After the user drags the panel, keep that spot instead of snapping to the dock.
static COMPANION_PANEL_USER_PLACED: AtomicBool = AtomicBool::new(false);
static COMPANION_PANEL_IGNORE_MOVE_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

fn companion_panel_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn companion_panel_ignore_programmatic_move() {
    COMPANION_PANEL_IGNORE_MOVE_UNTIL_MS.store(companion_panel_now_ms().saturating_add(500), Ordering::Relaxed);
}

fn companion_panel_mark_user_moved() {
    if companion_panel_now_ms() > COMPANION_PANEL_IGNORE_MOVE_UNTIL_MS.load(Ordering::Relaxed) {
        COMPANION_PANEL_USER_PLACED.store(true, Ordering::Relaxed);
    }
}

fn companion_panel_size() -> (f64, f64) {
    (COMPANION_PANEL_WIDTH, 232.0)
}

fn companion_panel_monitor(
    window: &tauri::WebviewWindow,
    tray_rect: Option<&tauri::Rect>,
) -> Option<tauri::Monitor> {
    if let Some(rect) = tray_rect {
        let scale = window.scale_factor().unwrap_or(1.0);
        let (px, py) = match rect.position {
            tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
            tauri::Position::Logical(p) => (p.x * scale, p.y * scale),
        };
        if let Ok(Some(monitor)) = window.monitor_from_point(px, py) {
            return Some(monitor);
        }
    }
    if let Ok(Some(monitor)) = window.current_monitor() {
        return Some(monitor);
    }
    window.primary_monitor().ok().flatten()
}

fn resize_companion_panel(window: &tauri::WebviewWindow, height: f64) {
    companion_panel_ignore_programmatic_move();
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: COMPANION_PANEL_WIDTH,
        height,
    }));
}

/// Bottom-center of the monitor's work area, so the bar sits just above the Dock
/// and grows upward when the strip or an approval appears.
fn anchor_companion_panel(window: &tauri::WebviewWindow, monitor: Option<&tauri::Monitor>, height: f64) {
    resize_companion_panel(window, height);
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let area_x = area.position.x as f64;
    let area_y = area.position.y as f64;
    let area_w = area.size.width as f64;
    let area_h = area.size.height as f64;
    let win_w = COMPANION_PANEL_WIDTH * scale;
    let win_h = height * scale;
    let x = area_x + ((area_w - win_w) / 2.0).max(0.0);
    let y = (area_y + area_h - win_h - COMPANION_PANEL_BOTTOM_GAP * scale).max(area_y + 8.0 * scale);
    companion_panel_ignore_programmatic_move();
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: x.round() as i32,
        y: y.round() as i32,
    }));
}

#[tauri::command]
fn companion_panel_fit(window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
    if window.label() != "companion-panel" {
        return Err("Blocked".into());
    }
    let height = height.clamp(120.0, 560.0);
    if COMPANION_PANEL_USER_PLACED.load(Ordering::Relaxed) {
        resize_companion_panel(&window, height);
        return Ok(());
    }
    let monitor = companion_panel_monitor(&window, None);
    anchor_companion_panel(&window, monitor.as_ref(), height);
    Ok(())
}

/// Menu-bar panel may only ask Studio to open a fixed set of screens.
#[tauri::command]
fn companion_panel_open_studio(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    target: String,
) -> Result<(), String> {
    allow_windows(&window, &["companion-panel"])?;
    let menu_id = match target.as_str() {
        "new-companion" => "nav-workplace",
        "chat" => "nav-chat",
        _ => return Err("Unknown Studio screen".into()),
    };
    let _ = window.hide();
    focus_main_window_inner(app.clone())?;
    let _ = app.emit_to("main", "arrab:menu", menu_id);
    Ok(())
}

fn place_companion_panel(window: &tauri::WebviewWindow, tray_rect: Option<&tauri::Rect>) {
    let (_, win_h) = companion_panel_size();
    let current_h = window
        .inner_size()
        .ok()
        .map(|size| size.height as f64 / window.scale_factor().unwrap_or(1.0))
        .filter(|h| *h >= 120.0)
        .unwrap_or(win_h);
    if COMPANION_PANEL_USER_PLACED.load(Ordering::Relaxed) {
        resize_companion_panel(window, current_h);
        return;
    }
    let monitor = companion_panel_monitor(window, tray_rect);
    anchor_companion_panel(window, monitor.as_ref(), current_h);
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
    .shadow(false)
    .transparent(true)
    .background_color(tauri::window::Color(0, 0, 0, 0));

    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    let window = builder.build().map_err(|err| err.to_string())?;
    let _ = window.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Moved(_)) {
            companion_panel_mark_user_moved();
        }
    });
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
fn companion_panel_toggle(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    main_window_only(&window)?;
    companion_panel_toggle_inner(app)
}

fn companion_panel_toggle_inner(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_companion_panel(&app)?;
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        Ok(())
    } else {
        show_companion_panel(&app, None)
    }
}

#[tauri::command]
fn companion_panel_hide(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    allow_windows(&window, &["main", "companion-panel"])?;
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
                    None => companion_panel_toggle_inner(app.clone()),
                };
            }
            "open_studio" => {
                let _ = focus_main_window_inner(app.clone());
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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateProgress {
    phase: String,
    percent: u32,
    detail: String,
}

fn emit_update_progress(app: &tauri::AppHandle, phase: &str, percent: u32, detail: &str) {
    let _ = app.emit(
        "app-update:progress",
        AppUpdateProgress {
            phase: phase.to_string(),
            percent,
            detail: detail.to_string(),
        },
    );
}

fn github_update_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "Invalid update URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Update URL must be https".into());
    }
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    let allowed = host == "github.com"
        || host == "githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
        || host == "arrabai.com"
        || host.ends_with(".arrabai.com");
    if !allowed {
        return Err("Update URL must come from GitHub or arrabai.com".into());
    }
    Ok(parsed)
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn installed_app_bundle() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let macos_dir = exe.parent().ok_or("App bundle not found")?;
    let contents = macos_dir.parent().ok_or("App bundle not found")?;
    let bundle = contents.parent().ok_or("App bundle not found")?;
    if bundle.extension().and_then(|ext| ext.to_str()) != Some("app") {
        return Err("Install Arrab Studio into Applications before using in-app update".into());
    }
    Ok(bundle.to_path_buf())
}

fn stage_macos_relaunch(dmg: &std::path::Path) -> Result<(), String> {
    let bundle = installed_app_bundle()?;
    let script_path = std::env::temp_dir().join("arrab-install-update.sh");
    let script = format!(
        r#"#!/bin/bash
set -euo pipefail
DMG={dmg}
DEST={dest}
PID={pid}
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
MOUNT=$(mktemp -d /tmp/arrab-update.XXXXXX)
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG"
APP=$(find "$MOUNT" -maxdepth 2 -name '*.app' -print -quit)
if [ -z "$APP" ]; then
  hdiutil detach "$MOUNT" || true
  echo "Installer did not contain an app" >&2
  exit 1
fi
rm -rf "$DEST"
ditto "$APP" "$DEST"
hdiutil detach "$MOUNT" || true
rm -rf "$MOUNT" "$DMG"
open "$DEST"
"#,
        dmg = sh_quote(&dmg.to_string_lossy()),
        dest = sh_quote(&bundle.to_string_lossy()),
        pid = std::process::id(),
    );
    fs::write(&script_path, script).map_err(|err| err.to_string())?;
    Command::new("/usr/bin/nohup")
        .arg("/bin/bash")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Could not start the installer: {err}"))?;
    Ok(())
}

#[tauri::command]
async fn install_app_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    main_window_only(&window)?;
    let parsed = github_update_url(&url)?;
    emit_update_progress(&app, "download", 0, "Downloading update");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(8))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|err| err.to_string())?;
    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|err| format!("Download failed: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed ({})", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let dest = std::env::temp_dir().join("arrab-studio-update.dmg");
    let mut file = fs::File::create(&dest).map_err(|err| err.to_string())?;
    let mut got: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
        file.write_all(&chunk).map_err(|err| err.to_string())?;
        got += chunk.len() as u64;
        let percent = if total > 0 {
            ((got.saturating_mul(100)) / total).min(99) as u32
        } else {
            0
        };
        emit_update_progress(&app, "download", percent, "Downloading update");
    }
    file.flush().map_err(|err| err.to_string())?;
    emit_update_progress(&app, "install", 100, "Installing update");
    #[cfg(target_os = "macos")]
    {
        stage_macos_relaunch(&dest)?;
        emit_update_progress(&app, "restart", 100, "Restarting Arrab Studio");
        app.exit(0);
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dest;
        Err("In-app restart is available on macOS. Open the installer to finish.".into())
    }
}

/// Snapshot shown by the standalone updater window (`updater.html`).
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterStatus {
    /// preparing | download | install | restart | error
    phase: String,
    percent: u32,
    received: u64,
    total: u64,
    current_version: String,
    target_version: String,
    message: String,
    fallback_url: String,
}

#[derive(Default)]
struct AppUpdater {
    running: std::sync::atomic::AtomicBool,
    status: Mutex<UpdaterStatus>,
}

const UPDATER_WINDOW: &str = "app-updater";

fn set_updater_status(app: &tauri::AppHandle, apply: impl FnOnce(&mut UpdaterStatus)) {
    let state = app.state::<AppUpdater>();
    let snapshot = match state.status.lock() {
        Ok(mut status) => {
            apply(&mut status);
            status.clone()
        }
        Err(_) => return,
    };
    let _ = app.emit_to(UPDATER_WINDOW, "app-updater:status", snapshot);
}

fn show_updater_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(UPDATER_WINDOW) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        UPDATER_WINDOW,
        tauri::WebviewUrl::App("updater.html".into()),
    )
    .title("Updating Arrab Studio")
    .inner_size(460.0, 262.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(true)
    .closable(false)
    .decorations(false)
    .always_on_top(true)
    .center()
    .focused(true)
    .shadow(false);
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.transparent(true);
    }
    builder.build().map_err(|err| err.to_string())?;
    Ok(())
}

fn hide_app_windows_for_update(app: &tauri::AppHandle) {
    for label in ["main", "companion-panel", "agent-presence"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
}

fn update_percent(received: u64, total: u64) -> u32 {
    if total == 0 {
        0
    } else {
        ((received.saturating_mul(100)) / total).min(99) as u32
    }
}

async fn download_update_installer(
    app: &tauri::AppHandle,
    url: &str,
) -> Result<std::path::PathBuf, String> {
    let parsed = github_update_url(url)?;
    let file_name = parsed
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .unwrap_or("arrab-studio-update")
        .to_string();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(8))
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(90))
        .build()
        .map_err(|err| err.to_string())?;
    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|err| format!("Download failed: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed ({})", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let dir = std::env::temp_dir().join("arrab-studio-update");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let dest = dir.join(file_name.replace(['/', '\\'], "_"));
    let mut file = fs::File::create(&dest).map_err(|err| err.to_string())?;
    let mut received: u64 = 0;
    let mut last_percent = u32::MAX;
    set_updater_status(app, |status| {
        status.phase = "download".into();
        status.total = total;
    });
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("Download interrupted: {err}"))?
    {
        file.write_all(&chunk).map_err(|err| err.to_string())?;
        received += chunk.len() as u64;
        let percent = update_percent(received, total);
        if percent != last_percent || total == 0 {
            last_percent = percent;
            set_updater_status(app, |status| {
                status.percent = percent;
                status.received = received;
            });
        }
    }
    file.flush().map_err(|err| err.to_string())?;
    if total > 0 && received < total {
        return Err("Download was incomplete. Check your connection and try again.".into());
    }
    Ok(dest)
}

/// Hand the installer to a detached helper that waits for this process to exit,
/// installs, and opens the new version.
fn stage_installer_and_relaunch(installer: &std::path::Path) -> Result<(), String> {
    let lower = installer.to_string_lossy().to_ascii_lowercase();
    #[cfg(target_os = "macos")]
    {
        if !lower.ends_with(".dmg") {
            return Err("This release has no macOS installer (.dmg).".into());
        }
        return stage_macos_relaunch(installer);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let ps = |value: &str| format!("'{}'", value.replace('\'', "''"));
        let exe = std::env::current_exe().map_err(|err| err.to_string())?;
        let install = if lower.ends_with(".msi") {
            format!(
                "Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', '\"{}\"', '/passive', '/norestart') -Wait",
                installer.to_string_lossy().replace('\'', "''")
            )
        } else if lower.ends_with(".exe") {
            // NSIS passive mode: progress bar only, no prompts.
            format!("Start-Process -FilePath {} -ArgumentList '/P' -Wait", ps(&installer.to_string_lossy()))
        } else {
            return Err("This release has no Windows installer (.exe or .msi).".into());
        };
        let script = format!(
            "$ErrorActionPreference = 'Continue'\r\nWait-Process -Id {pid} -ErrorAction SilentlyContinue\r\n{install}\r\nStart-Process -FilePath {exe}\r\nRemove-Item -LiteralPath {installer} -ErrorAction SilentlyContinue\r\n",
            pid = std::process::id(),
            install = install,
            exe = ps(&exe.to_string_lossy()),
            installer = ps(&installer.to_string_lossy()),
        );
        let script_path = std::env::temp_dir().join("arrab-install-update.ps1");
        fs::write(&script_path, script).map_err(|err| err.to_string())?;
        Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"])
            .arg(&script_path)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("Could not start the installer: {err}"))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        let target = std::env::var("APPIMAGE")
            .map_err(|_| "In-app update works for the AppImage build. Install the new package from the download page.".to_string())?;
        if !lower.ends_with(".appimage") {
            return Err("This release has no AppImage.".into());
        }
        let staged = format!("{target}.new");
        fs::copy(installer, &staged).map_err(|err| err.to_string())?;
        fs::set_permissions(&staged, fs::Permissions::from_mode(0o755)).map_err(|err| err.to_string())?;
        fs::rename(&staged, &target).map_err(|err| err.to_string())?;
        Command::new(&target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("Could not relaunch: {err}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("In-app update is not supported on this platform.".into())
}

async fn run_app_update(app: tauri::AppHandle, fallback_url: Option<String>) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let signed = match app.updater_builder().timeout(Duration::from_secs(20)).build() {
            Ok(updater) => updater.check().await.ok().flatten(),
            Err(_) => None,
        };
        if let Some(update) = signed {
            set_updater_status(&app, |status| {
                status.phase = "download".into();
                status.target_version = update.version.clone();
            });
            let progress = app.clone();
            let mut received: u64 = 0;
            let mut last_percent = u32::MAX;
            let finished = app.clone();
            update
                .download_and_install(
                    move |chunk, total| {
                        received += chunk as u64;
                        let total = total.unwrap_or(0);
                        let percent = update_percent(received, total);
                        if percent != last_percent {
                            last_percent = percent;
                            set_updater_status(&progress, |status| {
                                status.percent = percent;
                                status.received = received;
                                status.total = total;
                            });
                        }
                    },
                    move || {
                        set_updater_status(&finished, |status| {
                            status.phase = "install".into();
                            status.percent = 100;
                        });
                    },
                )
                .await
                .map_err(|err| format!("Update failed: {err}"))?;
            set_updater_status(&app, |status| {
                status.phase = "restart".into();
                status.percent = 100;
            });
            tokio_sleep(Duration::from_millis(700)).await;
            app.restart();
        }
    }

    let url = fallback_url
        .ok_or_else(|| "No installer is published for this platform yet.".to_string())?;
    let installer = download_update_installer(&app, &url).await?;
    set_updater_status(&app, |status| {
        status.phase = "install".into();
        status.percent = 100;
    });
    stage_installer_and_relaunch(&installer)?;
    set_updater_status(&app, |status| status.phase = "restart".into());
    tokio_sleep(Duration::from_millis(700)).await;
    app.exit(0);
    Ok(())
}

async fn tokio_sleep(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || thread::sleep(duration)).await;
}

/// Close the app UI, show the updater window with live progress, install, relaunch.
#[tauri::command]
fn start_app_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppUpdater>,
    url: Option<String>,
    version: Option<String>,
) -> Result<(), String> {
    main_window_only(&window)?;
    let fallback_url = match url.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Some(github_update_url(value)?.to_string()),
        _ => None,
    };
    if state.running.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return show_updater_window(&app);
    }
    if let Ok(mut status) = state.status.lock() {
        *status = UpdaterStatus {
            phase: "preparing".into(),
            current_version: app.package_info().version.to_string(),
            target_version: version.unwrap_or_default().trim_start_matches(['v', 'V']).to_string(),
            fallback_url: fallback_url.clone().unwrap_or_default(),
            ..UpdaterStatus::default()
        };
    }
    if let Err(err) = show_updater_window(&app) {
        state.running.store(false, std::sync::atomic::Ordering::SeqCst);
        return Err(err);
    }
    hide_app_windows_for_update(&app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(message) = run_app_update(handle.clone(), fallback_url).await {
            set_updater_status(&handle, |status| {
                status.phase = "error".into();
                status.message = message;
            });
            handle
                .state::<AppUpdater>()
                .running
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
    });
    Ok(())
}

#[tauri::command]
fn app_update_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppUpdater>,
) -> Result<UpdaterStatus, String> {
    allow_windows(&window, &[UPDATER_WINDOW, "main"])?;
    state
        .status
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "Updater lock poisoned".to_string())
}

/// After a failed update: close the updater and bring the app back.
#[tauri::command]
fn app_update_dismiss(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppUpdater>,
) -> Result<(), String> {
    allow_windows(&window, &[UPDATER_WINDOW])?;
    if state.running.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("The update is still running".into());
    }
    let _ = focus_main_window_inner(app.clone());
    window.close().map_err(|err| err.to_string())
}

/// Open the release page when in-app install is not possible.
#[tauri::command]
fn app_update_open_download(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppUpdater>,
) -> Result<(), String> {
    allow_windows(&window, &[UPDATER_WINDOW])?;
    let url = state
        .status
        .lock()
        .map(|status| status.fallback_url.clone())
        .unwrap_or_default();
    let target = if url.is_empty() {
        "https://github.com/AbdulelahBakhurji/arrabstudiov1/releases/latest".to_string()
    } else {
        github_update_url(&url)?.to_string()
    };
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(&target).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &target]).status()
    } else {
        Command::new("xdg-open").arg(&target).status()
    }
    .map_err(|err| err.to_string())?;
    if !status.success() {
        return Err("Failed to open browser".into());
    }
    Ok(())
}

#[tauri::command]
fn open_external_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    main_window_only(&window)?;
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeHttpRequest {
    method: String,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHttpResponse {
    status: u16,
    body: String,
}

fn allow_native_http_url(url: &str) -> bool {
    let trimmed = url.trim();
    let Ok(parsed) = reqwest::Url::parse(trimmed) else {
        return false;
    };
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    match host.as_str() {
        "api.arrabai.com" | "auth.arrabai.com" | "testingworkspace.arrabai.com" => {
            scheme == "https"
        }
        "127.0.0.1" | "localhost" => {
            // Only known local API / Vite ports — not arbitrary loopback services.
            matches!(parsed.port_or_known_default(), Some(8787) | Some(1420) | Some(5173) | Some(3000) | None)
                && (scheme == "http" || scheme == "https")
        }
        _ => false,
    }
}

/// Bypass WebView CORP/CORS — Coolify sets Cross-Origin-Resource-Policy: same-site
/// which blocks tauri.localhost from reading api.arrabai.com responses.
#[tauri::command]
async fn native_http_request(
    window: tauri::WebviewWindow,
    args: NativeHttpRequest,
) -> Result<NativeHttpResponse, String> {
    studio_client_window(&window)?;
    let url = args.url.trim();
    if !allow_native_http_url(url) {
        return Err("URL not allowed for native HTTP".into());
    }
    let method = args.method.trim().to_uppercase();
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(30_000).clamp(1_000, 120_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        // Never follow redirects: a 3xx to a non-allowlisted host would bypass the gate.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| err.to_string())?;

    let mut builder = match method.as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "PATCH" => client.patch(url),
        "DELETE" => client.delete(url),
        "HEAD" => client.head(url),
        _ => return Err(format!("Unsupported method: {method}")),
    };

    if let Some(headers) = args.headers {
        for (key, value) in headers {
            let lower = key.to_ascii_lowercase();
            if lower == "host" || lower == "content-length" {
                continue;
            }
            builder = builder.header(key, value);
        }
    }
    if let Some(body) = args.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|err| err.to_string())?;
    Ok(NativeHttpResponse { status, body })
}

/// In-flight streaming requests, keyed by the caller's id so they can be cancelled.
#[derive(Default)]
struct NativeStreams(Mutex<std::collections::HashMap<u64, tauri::async_runtime::JoinHandle<()>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeStreamEvent {
    kind: &'static str,
    text: Option<String>,
    status: Option<u16>,
}

/// Streaming POST/GET (e.g. chat SSE) through native HTTP. Chunks are delivered
/// over `on_event` as they arrive: `open`, `chunk`…, then `end` or `error`.
#[tauri::command]
fn native_http_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeStreams>,
    app: tauri::AppHandle,
    id: u64,
    args: NativeHttpRequest,
    on_event: tauri::ipc::Channel<NativeStreamEvent>,
) -> Result<(), String> {
    studio_client_window(&window)?;
    let url = args.url.trim().to_string();
    if !allow_native_http_url(&url) {
        return Err("URL not allowed for native HTTP".into());
    }
    let method = args.method.trim().to_uppercase();
    if method != "POST" && method != "GET" {
        return Err(format!("Unsupported stream method: {method}"));
    }
    let read_timeout =
        Duration::from_millis(args.timeout_ms.unwrap_or(180_000).clamp(5_000, 300_000));
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let send = |kind: &'static str, text: Option<String>, status: Option<u16>| {
            on_event.send(NativeStreamEvent { kind, text, status }).is_ok()
        };
        let finish = |handle: &tauri::AppHandle| {
            if let Ok(mut map) = handle.state::<NativeStreams>().0.lock() {
                map.remove(&id);
            }
        };
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(read_timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(err) => {
                send("error", Some(err.to_string()), None);
                return finish(&handle);
            }
        };
        let mut request = if method == "POST" { client.post(&url) } else { client.get(&url) };
        for (key, value) in args.headers.unwrap_or_default() {
            let lower = key.to_ascii_lowercase();
            if lower == "host" || lower == "content-length" {
                continue;
            }
            request = request.header(key, value);
        }
        if let Some(body) = args.body {
            request = request.body(body);
        }
        let mut response = match request.send().await {
            Ok(response) => response,
            Err(err) => {
                send("error", Some(err.to_string()), None);
                return finish(&handle);
            }
        };
        let status = response.status().as_u16();
        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            send("error", Some(body), Some(status));
            return finish(&handle);
        }
        if !send("open", None, Some(status)) {
            return finish(&handle);
        }
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    carry.extend_from_slice(&chunk);
                    let text = take_utf8(&mut carry);
                    if !text.is_empty() && !send("chunk", Some(text), None) {
                        return finish(&handle);
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    send("error", Some(err.to_string()), None);
                    return finish(&handle);
                }
            }
        }
        send("end", None, Some(status));
        finish(&handle);
    });
    let mut map = state.0.lock().map_err(|_| "Stream lock poisoned".to_string())?;
    if let Some(previous) = map.insert(id, task) {
        previous.abort();
    }
    Ok(())
}

fn allow_web_lookup_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url.trim()) else {
        return false;
    };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    matches!(
        host.as_str(),
        "html.duckduckgo.com"
            | "lite.duckduckgo.com"
            | "api.duckduckgo.com"
            | "en.wikipedia.org"
            | "ar.wikipedia.org"
    )
}

/// Public web lookup for companion search. Only search hosts, no redirects.
#[tauri::command]
async fn desktop_web_fetch(window: tauri::WebviewWindow, url: String) -> Result<String, String> {
    studio_client_window(&window)?;
    let target = url.trim();
    if !allow_web_lookup_url(target) {
        return Err("URL not allowed for web lookup".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(target)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        )
        .header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en,ar;q=0.8")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Web lookup HTTP {}", status.as_u16()));
    }
    let text = response.text().await.map_err(|err| err.to_string())?;
    Ok(text.chars().take(90_000).collect())
}

#[tauri::command]
fn native_http_stream_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeStreams>,
    id: u64,
) -> Result<(), String> {
    studio_client_window(&window)?;
    if let Some(task) = state.0.lock().map_err(|_| "Stream lock poisoned".to_string())?.remove(&id) {
        task.abort();
    }
    Ok(())
}

#[tauri::command]
fn delete_path(
    window: tauri::WebviewWindow,
    root: String,
    relative: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
fn rename_path(
    window: tauri::WebviewWindow,
    root: String,
    from: String,
    to: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
fn create_dir(
    window: tauri::WebviewWindow,
    root: String,
    relative: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let path = resolve_under_root(&root, &relative)?;
    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(serde_json::json!({
        "path": relative.replace('\\', "/"),
        "created": true,
    }))
}

#[tauri::command]
fn open_path(
    window: tauri::WebviewWindow,
    root: String,
    relative: Option<String>,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
fn ensure_agents_office(window: tauri::WebviewWindow) -> Result<String, String> {
    main_window_only(&window)?;
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
fn agents_office_status(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|err| format!("Preview bind failed: {err}"))?;
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
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: http://127.0.0.1\r\nConnection: close\r\n\r\n",
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
fn start_phone_preview(
    window: tauri::WebviewWindow,
    html: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
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

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeMenuState {
    locale: String,
    organization: bool,
    signed_in: bool,
    always_on_top: bool,
    extended_thinking: bool,
    /// Translated labels of the sidebar destinations, in order (⌘1…⌘9).
    #[serde(default)]
    nav: Vec<String>,
}

impl Default for NativeMenuState {
    fn default() -> Self {
        Self {
            locale: "en".into(),
            organization: false,
            signed_in: false,
            always_on_top: false,
            extended_thinking: false,
            nav: Vec::new(),
        }
    }
}

static NATIVE_MENU_STATE: Mutex<Option<NativeMenuState>> = Mutex::new(None);
static WEBVIEW_ZOOM: Mutex<f64> = Mutex::new(1.0);

const ZOOM_STEPS: [f64; 9] = [0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75];

fn step_webview_zoom(app: &tauri::AppHandle, direction: i8) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let mut zoom = WEBVIEW_ZOOM.lock().unwrap_or_else(|e| e.into_inner());
    let next = match direction {
        0 => 1.0,
        d if d > 0 => ZOOM_STEPS
            .iter()
            .copied()
            .find(|step| *step > *zoom + 0.001)
            .unwrap_or(ZOOM_STEPS[ZOOM_STEPS.len() - 1]),
        _ => ZOOM_STEPS
            .iter()
            .rev()
            .copied()
            .find(|step| *step < *zoom - 0.001)
            .unwrap_or(ZOOM_STEPS[0]),
    };
    if window.set_zoom(next).is_ok() {
        *zoom = next;
        let _ = app.emit("arrab:zoom", next);
    }
}

fn build_native_menu(
    app: &tauri::AppHandle,
    state: &NativeMenuState,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{
        AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
    };

    let ar = state.locale.starts_with("ar");
    let tr = |en: &'static str, arabic: &'static str| if ar { arabic } else { en };
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let mut builder = MenuItemBuilder::with_id(id, label);
        if let Some(accel) = accel {
            builder = builder.accelerator(accel);
        }
        builder.build(app)
    };

    let about = AboutMetadata {
        name: Some("Arrab Studio".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("© Arrab AI".into()),
        website: Some("https://arrabai.com".into()),
        website_label: Some("arrabai.com".into()),
        ..Default::default()
    };

    // First submenu becomes the macOS app menu (under "Arrab Studio").
    let mut app_menu = SubmenuBuilder::new(app, "Arrab Studio")
        .about_with_text(tr("About Arrab Studio", "حول عرّاب ستوديو"), Some(about))
        .item(&item(
            "app-check-updates",
            tr("Check for Updates…", "التحقق من التحديثات…"),
            None,
        )?)
        .separator()
        .item(&item("nav-settings", tr("Settings…", "الإعدادات…"), Some("CmdOrCtrl+,"))?)
        .item(&item(
            "app-account",
            tr("Account…", "الحساب…"),
            Some("CmdOrCtrl+U"),
        )?);
    if state.signed_in {
        app_menu = app_menu
            .item(&item("app-usage", tr("Plan & Usage…", "الخطة والاستهلاك…"), None)?)
            .item(&item("app-add-usage", tr("Add Usage…", "إضافة استهلاك…"), None)?);
    } else {
        app_menu = app_menu.item(&item("app-sign-in", tr("Sign In…", "تسجيل الدخول…"), None)?);
    }
    let app_menu = app_menu
        .separator()
        .services_with_text(tr("Services", "الخدمات"))
        .separator()
        .hide_with_text(tr("Hide Arrab Studio", "إخفاء عرّاب ستوديو"))
        .hide_others_with_text(tr("Hide Others", "إخفاء الآخرين"))
        .show_all_with_text(tr("Show All", "إظهار الكل"))
        .separator()
        .quit_with_text(tr("Quit Arrab Studio", "إنهاء عرّاب ستوديو"))
        .build()?;

    let file = SubmenuBuilder::new(app, tr("File", "ملف"))
        .item(&item("file-new-chat", tr("New Chat", "محادثة جديدة"), Some("CmdOrCtrl+N"))?)
        .item(&item(
            "file-new-companion",
            if state.organization {
                tr("New Agent…", "وكيل جديد…")
            } else {
                tr("New Companion…", "رفيق جديد…")
            },
            Some("CmdOrCtrl+Shift+N"),
        )?)
        .separator()
        .item(&item(
            "file-connect-folder",
            tr("Connect Folder…", "ربط مجلد…"),
            Some("CmdOrCtrl+O"),
        )?)
        .item(&item(
            "file-command-palette",
            tr("Command Palette…", "لوحة الأوامر…"),
            Some("CmdOrCtrl+K"),
        )?)
        .separator()
        .close_window_with_text(tr("Close Window", "إغلاق النافذة"))
        .build()?;

    let edit = SubmenuBuilder::new(app, tr("Edit", "تحرير"))
        .undo_with_text(tr("Undo", "تراجع"))
        .redo_with_text(tr("Redo", "إعادة"))
        .separator()
        .cut_with_text(tr("Cut", "قص"))
        .copy_with_text(tr("Copy", "نسخ"))
        .paste_with_text(tr("Paste", "لصق"))
        .select_all_with_text(tr("Select All", "تحديد الكل"))
        .build()?;

    let always_on_top = CheckMenuItemBuilder::with_id(
        "view-always-on-top",
        tr("Keep on Top", "إبقاء في المقدمة"),
    )
    .checked(state.always_on_top)
    .accelerator("CmdOrCtrl+Alt+T")
    .build(app)?;

    let view = SubmenuBuilder::new(app, tr("View", "عرض"))
        .item(&item("view-reload", tr("Reload", "إعادة التحميل"), Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item("view-zoom-in", tr("Zoom In", "تكبير"), Some("CmdOrCtrl+="))?)
        .item(&item("view-zoom-out", tr("Zoom Out", "تصغير"), Some("CmdOrCtrl+-"))?)
        .item(&item("view-zoom-reset", tr("Actual Size", "الحجم الفعلي"), Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&item(
            "view-toggle-theme",
            tr("Toggle Light / Dark", "تبديل الفاتح / الداكن"),
            Some("CmdOrCtrl+Shift+T"),
        )?)
        .item(&item(
            "view-toggle-language",
            tr("Switch to Arabic", "التبديل إلى الإنجليزية"),
            Some("CmdOrCtrl+Shift+L"),
        )?)
        .separator()
        .item(&always_on_top)
        .fullscreen_with_text(tr("Enter Full Screen", "ملء الشاشة"))
        .build()?;

    let mut go = SubmenuBuilder::new(app, tr("Go", "انتقال"))
        .item(&item("go-back", tr("Back", "رجوع"), Some("CmdOrCtrl+["))?)
        .item(&item("go-forward", tr("Forward", "تقدم"), Some("CmdOrCtrl+]"))?)
        .separator();
    for (index, label) in state.nav.iter().take(9).enumerate() {
        let accel = format!("CmdOrCtrl+{}", index + 1);
        go = go.item(&item(&format!("go-{index}"), label, Some(&accel))?);
    }
    if state.nav.is_empty() {
        go = go
            .item(&item("nav-chat", tr("Chat", "المحادثة"), None)?)
            .item(&item("nav-connectors", tr("Connectors", "الموصلات"), None)?);
    }
    let go = go
        .separator()
        .item(&item("app-account", tr("Account", "الحساب"), None)?)
        .item(&item("nav-settings", tr("Settings", "الإعدادات"), None)?)
        .build()?;

    let thinking = CheckMenuItemBuilder::with_id(
        "ai-toggle-thinking",
        tr("Extended Thinking", "التفكير الموسّع"),
    )
    .checked(state.extended_thinking)
    .accelerator("CmdOrCtrl+Alt+E")
    .build(app)?;

    let ai = SubmenuBuilder::new(app, tr("AI", "الذكاء"))
        .item(&item("ai-new-chat", tr("Ask Arrab…", "اسأل عرّاب…"), None)?)
        .item(&item(
            "ai-stop-reply",
            tr("Stop Generating", "إيقاف التوليد"),
            Some("CmdOrCtrl+."),
        )?)
        .separator()
        .item(&thinking)
        .separator()
        .item(&item(
            "ai-companion-panel",
            tr("Quick Companion Panel", "لوحة الرفيق السريعة"),
            Some("CmdOrCtrl+Alt+K"),
        )?)
        .separator()
        .item(&item("ai-models", tr("Local Models…", "النماذج المحلية…"), None)?)
        .item(&item("ai-skills", tr("Skills…", "المهارات…"), None)?)
        .item(&item("nav-connectors", tr("Connectors…", "الموصلات…"), None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, tr("Window", "نافذة"))
        .minimize_with_text(tr("Minimize", "تصغير"))
        .maximize_with_text(tr("Zoom", "تكبير النافذة"))
        .separator()
        .item(&item(
            "window-studio",
            tr("Arrab Studio", "عرّاب ستوديو"),
            Some("CmdOrCtrl+Alt+0"),
        )?)
        .item(&item(
            "ai-companion-panel",
            tr("Companion Panel", "لوحة الرفيق"),
            None,
        )?)
        .separator()
        .bring_all_to_front_with_text(tr("Bring All to Front", "إحضار الكل إلى المقدمة"))
        .build()?;

    let help = SubmenuBuilder::new(app, tr("Help", "مساعدة"))
        .item(&item("help-getting-started", tr("Getting Started", "البدء"), None)?)
        .item(&item(
            "help-shortcuts",
            tr("Keyboard Shortcuts", "اختصارات لوحة المفاتيح"),
            Some("CmdOrCtrl+/"),
        )?)
        .item(&item("help-whats-new", tr("What's New", "ما الجديد"), None)?)
        .separator()
        .item(&item("help-report-issue", tr("Report an Issue…", "الإبلاغ عن مشكلة…"), None)?)
        .item(&item("help-privacy", tr("Privacy & Data", "الخصوصية والبيانات"), None)?)
        .separator()
        .item(&item("help-website", tr("Arrab Website", "موقع عرّاب"), None)?)
        .build()?;

    #[cfg(target_os = "macos")]
    {
        let _ = window.set_as_windows_menu_for_nsapp();
        let _ = help.set_as_help_menu_for_nsapp();
    }

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&go)
        .item(&ai)
        .item(&window)
        .item(&help)
        .build()
}

fn apply_native_menu(app: &tauri::AppHandle, state: &NativeMenuState) -> tauri::Result<()> {
    let menu = build_native_menu(app, state)?;
    app.set_menu(menu)?;
    Ok(())
}

fn install_native_menu(app: &tauri::App) -> tauri::Result<()> {
    apply_native_menu(app.handle(), &NativeMenuState::default())?;

    app.on_menu_event(move |app, event| {
        let id = event.id().as_ref();
        match id {
            "view-zoom-in" => step_webview_zoom(app, 1),
            "view-zoom-out" => step_webview_zoom(app, -1),
            "view-zoom-reset" => step_webview_zoom(app, 0),
            "ai-companion-panel" => {
                let _ = companion_panel_toggle_inner(app.clone());
            }
            "window-studio" => {
                let _ = focus_main_window_inner(app.clone());
            }
            _ if id.starts_with("app-")
                || id.starts_with("file-")
                || id.starts_with("view-")
                || id.starts_with("go-")
                || id.starts_with("nav-")
                || id.starts_with("ai-")
                || id.starts_with("help-") =>
            {
                if matches!(id, "ai-new-chat" | "file-new-chat" | "file-new-companion") {
                    let _ = focus_main_window_inner(app.clone());
                }
                let _ = app.emit("arrab:menu", id);
            }
            _ => {}
        }
    });

    Ok(())
}

/// Rebuilds the native menu bar in the app's language, with live check states
/// and the sidebar destinations of the signed-in role.
#[tauri::command]
fn native_menu_sync(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: NativeMenuState,
) -> Result<(), String> {
    main_window_only(&window)?;
    {
        let mut current = NATIVE_MENU_STATE.lock().unwrap_or_else(|e| e.into_inner());
        if current.as_ref().is_some_and(|prev| {
            prev.locale == state.locale
                && prev.organization == state.organization
                && prev.signed_in == state.signed_in
                && prev.always_on_top == state.always_on_top
                && prev.extended_thinking == state.extended_thinking
                && prev.nav == state.nav
        }) {
            return Ok(());
        }
        *current = Some(state.clone());
    }
    apply_native_menu(&app, &state).map_err(|err| err.to_string())
}

/// OS version string for the managed-client sync (no hardware identifiers).
#[tauri::command]
fn managed_os_version(window: tauri::WebviewWindow) -> Result<String, String> {
    main_window_only(&window)?;
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .map_err(|err| err.to_string())?;
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    #[cfg(target_os = "linux")]
    {
        let text = fs::read_to_string("/etc/os-release").unwrap_or_default();
        let version = text
            .lines()
            .find_map(|line| line.strip_prefix("VERSION_ID="))
            .unwrap_or("")
            .trim_matches('"')
            .to_string();
        return Ok(version);
    }
    #[allow(unreachable_code)]
    Ok(String::new())
}

#[tauri::command]
fn managed_restart_app(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    main_window_only(&window)?;
    app.restart();
}

/// One live Arrab Control stream per device; opening a new one aborts the old.
#[derive(Default)]
struct ManagedEvents(Mutex<Option<tauri::async_runtime::JoinHandle<()>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedSsePayload {
    id: u64,
    kind: &'static str,
    text: Option<String>,
    status: Option<u16>,
}

fn emit_managed_sse(app: &tauri::AppHandle, payload: ManagedSsePayload) {
    let _ = app.emit_to("main", "managed-client:sse", payload);
}

/// Decode as much valid UTF-8 as possible, carrying a split code point to the next chunk.
fn take_utf8(carry: &mut Vec<u8>) -> String {
    match std::str::from_utf8(carry) {
        Ok(text) => {
            let out = text.to_string();
            carry.clear();
            out
        }
        Err(err) => {
            let valid = err.valid_up_to();
            let out = String::from_utf8_lossy(&carry[..valid]).to_string();
            if err.error_len().is_some() {
                carry.clear();
            } else {
                carry.drain(..valid);
            }
            out
        }
    }
}

#[tauri::command]
fn managed_events_open(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, ManagedEvents>,
    id: u64,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    main_window_only(&window)?;
    let url = url.trim().to_string();
    if !allow_native_http_url(&url) {
        return Err("URL not allowed for native HTTP".into());
    }
    let mut slot = state.0.lock().map_err(|_| "Events lock poisoned".to_string())?;
    if let Some(previous) = slot.take() {
        previous.abort();
    }
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let closed = |status: Option<u16>| ManagedSsePayload {
            id,
            kind: "closed",
            text: None,
            status,
        };
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(90))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(_) => return emit_managed_sse(&handle, closed(None)),
        };
        let mut request = client.get(&url).header("Accept", "text/event-stream");
        for (key, value) in headers.unwrap_or_default() {
            let lower = key.to_ascii_lowercase();
            if lower == "host" || lower == "content-length" {
                continue;
            }
            request = request.header(key, value);
        }
        let mut response = match request.send().await {
            Ok(response) => response,
            Err(_) => return emit_managed_sse(&handle, closed(None)),
        };
        let status = response.status().as_u16();
        if !response.status().is_success() {
            return emit_managed_sse(&handle, closed(Some(status)));
        }
        emit_managed_sse(
            &handle,
            ManagedSsePayload { id, kind: "open", text: None, status: Some(status) },
        );
        let mut carry: Vec<u8> = Vec::new();
        while let Ok(Some(chunk)) = response.chunk().await {
            carry.extend_from_slice(&chunk);
            let text = take_utf8(&mut carry);
            if !text.is_empty() {
                emit_managed_sse(
                    &handle,
                    ManagedSsePayload { id, kind: "chunk", text: Some(text), status: None },
                );
            }
        }
        emit_managed_sse(&handle, closed(Some(status)));
    });
    *slot = Some(task);
    Ok(())
}

#[tauri::command]
fn managed_events_close(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedEvents>,
) -> Result<(), String> {
    main_window_only(&window)?;
    if let Some(task) = state.0.lock().map_err(|_| "Events lock poisoned".to_string())?.take() {
        task.abort();
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SshConfigHost {
    alias: String,
    host_name: String,
    user: String,
    port: String,
    identity_file: Option<String>,
}

fn user_home() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "Home directory is not set".to_string())
}

fn expand_home(raw: &str, home: &std::path::Path) -> String {
    let trimmed = raw.trim().trim_matches('"').trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home.join(rest).to_string_lossy().to_string();
    }
    if trimmed == "~" {
        return home.to_string_lossy().to_string();
    }
    trimmed.to_string()
}

fn strip_ssh_comment(line: &str) -> &str {
    let mut quoted = false;
    for (index, ch) in line.char_indices() {
        if ch == '"' {
            quoted = !quoted;
        }
        if ch == '#' && !quoted {
            return &line[..index];
        }
    }
    line
}

fn valid_ssh_alias(alias: &str) -> bool {
    let mut chars = alias.chars();
    match chars.next() {
        Some(ch) if ch.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    alias.len() <= 128
        && alias
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '@' | ':'))
}

fn glob_match(pattern: &str, name: &str) -> bool {
    fn rec(pattern: &[u8], name: &[u8]) -> bool {
        if pattern.is_empty() {
            return name.is_empty();
        }
        if pattern[0] == b'*' {
            return rec(&pattern[1..], name) || (!name.is_empty() && rec(pattern, &name[1..]));
        }
        if name.is_empty() {
            return false;
        }
        if pattern[0] == b'?' || pattern[0] == name[0] {
            return rec(&pattern[1..], &name[1..]);
        }
        false
    }
    pattern.len() <= 180 && rec(pattern.as_bytes(), name.as_bytes())
}

/// Expand an Include path. Globs are only resolved inside ~/.ssh.
fn expand_ssh_include(expanded: &str, ssh: &std::path::Path) -> Vec<PathBuf> {
    if expanded.contains("..") {
        return Vec::new();
    }
    let path = PathBuf::from(expanded);
    if !expanded.contains('*') && !expanded.contains('?') {
        return vec![path];
    }
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let Some(pattern) = path.file_name().and_then(|item| item.to_str()) else {
        return Vec::new();
    };
    let Ok(parent_canon) = parent.canonicalize() else {
        return Vec::new();
    };
    let Ok(ssh_canon) = ssh.canonicalize() else {
        return Vec::new();
    };
    if !parent_canon.starts_with(&ssh_canon) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&parent_canon) else {
        return Vec::new();
    };
    let mut matched = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if glob_match(pattern, &name) && entry.path().is_file() {
            matched.push(entry.path());
        }
        if matched.len() >= 8 {
            break;
        }
    }
    matched.sort();
    matched
}

fn parse_ssh_config(text: &str, home: &std::path::Path) -> (Vec<SshConfigHost>, Vec<String>) {
    let mut hosts = Vec::new();
    let mut includes = Vec::new();
    let mut aliases: Vec<String> = Vec::new();
    let mut host_name = String::new();
    let mut user = String::new();
    let mut port = String::from("22");
    let mut identity: Option<String> = None;

    let mut flush = |aliases: &mut Vec<String>,
                     host_name: &mut String,
                     user: &mut String,
                     port: &mut String,
                     identity: &mut Option<String>| {
        for alias in aliases.drain(..) {
            if alias.contains('*') || alias.contains('?') || alias.contains('!') {
                continue;
            }
            hosts.push(SshConfigHost {
                host_name: if host_name.is_empty() {
                    alias.clone()
                } else {
                    host_name.clone()
                },
                user: user.clone(),
                port: if port.is_empty() {
                    "22".to_string()
                } else {
                    port.clone()
                },
                identity_file: identity.clone(),
                alias,
            });
        }
        host_name.clear();
        user.clear();
        *port = "22".to_string();
        *identity = None;
    };

    for raw in text.lines() {
        let line = strip_ssh_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let key = parts.next().unwrap_or("").to_ascii_lowercase();
        if key == "host" {
            flush(&mut aliases, &mut host_name, &mut user, &mut port, &mut identity);
            aliases = parts.map(|item| item.to_string()).collect();
            continue;
        }
        let value = parts.collect::<Vec<_>>().join(" ");
        if key == "include" {
            for token in value.split_whitespace() {
                let expanded = expand_home(token, home);
                let resolved = if expanded.starts_with('/') {
                    expanded
                } else {
                    home.join(".ssh").join(expanded).to_string_lossy().to_string()
                };
                includes.push(resolved);
            }
            continue;
        }
        if aliases.is_empty() {
            continue;
        }
        match key.as_str() {
            "hostname" => host_name = value,
            "user" => user = value,
            "port" => port = value,
            "identityfile" if identity.is_none() => identity = Some(expand_home(&value, home)),
            _ => {}
        }
    }
    flush(&mut aliases, &mut host_name, &mut user, &mut port, &mut identity);
    (hosts, includes)
}

fn read_ssh_config_hosts() -> Result<Vec<SshConfigHost>, String> {
    let home = user_home()?;
    let ssh = home.join(".ssh");
    let config_path = ssh.join("config");
    if !config_path.is_file() {
        return Ok(Vec::new());
    }
    let mut pending = vec![config_path];
    let mut seen_files = std::collections::HashSet::new();
    let mut seen_alias = std::collections::HashSet::new();
    let mut hosts = Vec::new();
    while let Some(path) = pending.pop() {
        if seen_files.len() > 8 || !seen_files.insert(path.clone()) {
            continue;
        }
        let Ok(canon) = path.canonicalize() else { continue };
        let ssh_canon = ssh.canonicalize().unwrap_or(ssh.clone());
        let home_canon = home.canonicalize().unwrap_or(home.clone());
        if !canon.starts_with(&ssh_canon) && !canon.starts_with(&home_canon) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&canon) else { continue };
        let (parsed, includes) = parse_ssh_config(&text, &home);
        for host in parsed {
            if seen_alias.insert(host.alias.clone()) {
                hosts.push(host);
            }
        }
        for include in includes {
            for path in expand_ssh_include(&include, &ssh) {
                pending.push(path);
            }
        }
    }
    hosts.sort_by(|a, b| a.alias.to_lowercase().cmp(&b.alias.to_lowercase()));
    Ok(hosts)
}

#[tauri::command]
fn list_ssh_config_hosts(window: tauri::WebviewWindow) -> Result<Vec<SshConfigHost>, String> {
    main_window_only(&window)?;
    read_ssh_config_hosts()
}

#[tauri::command]
fn read_ssh_identity(window: tauri::WebviewWindow, path: String) -> Result<String, String> {
    main_window_only(&window)?;
    let home = user_home()?;
    let ssh = home
        .join(".ssh")
        .canonicalize()
        .map_err(|_| "SSH folder was not found".to_string())?;
    let expanded = expand_home(&path, &home);
    let file = PathBuf::from(&expanded)
        .canonicalize()
        .map_err(|_| "Identity file was not found".to_string())?;
    if !file.starts_with(&ssh) || !file.is_file() {
        return Err("Identity file must be a key inside ~/.ssh".into());
    }
    let meta = fs::metadata(&file).map_err(|err| err.to_string())?;
    if meta.len() > 64_000 {
        return Err("Identity file is too large".into());
    }
    let text = fs::read_to_string(&file).map_err(|err| err.to_string())?;
    if !text.contains("PRIVATE KEY") {
        return Err("That file is not a private key".into());
    }
    Ok(text)
}

#[tauri::command]
fn ssh_config_exec(
    window: tauri::WebviewWindow,
    alias: String,
    command: String,
) -> Result<serde_json::Value, String> {
    main_window_only(&window)?;
    let alias = alias.trim().to_string();
    let command = command.trim().to_string();
    if !valid_ssh_alias(&alias) {
        return Err("Unknown SSH host".into());
    }
    let known = read_ssh_config_hosts()?;
    if !known.iter().any(|host| host.alias == alias) {
        return Err("That host is not in ~/.ssh/config".into());
    }
    if command.is_empty() || command.len() > 8_000 {
        return Err("SSH command is empty or too long".into());
    }
    let mut child = Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=12",
            "-o",
            "StrictHostKeyChecking=accept-new",
            &alias,
            &command,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Could not start ssh: {err}"))?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > Duration::from_secs(20) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("SSH connection timed out".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(err) => return Err(err.to_string()),
        }
    }
    let output = child.wait_with_output().map_err(|err| err.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).chars().take(12_000).collect::<String>();
    let stderr = String::from_utf8_lossy(&output.stderr).chars().take(4_000).collect::<String>();
    Ok(serde_json::json!({
        "code": output.status.code(),
        "stdout": stdout,
        "stderr": stderr,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                let _ = focus_main_window_inner(app.clone());
            }))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .manage(ManagedEvents::default())
        .manage(NativeStreams::default())
        .manage(AppUpdater::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            run_local_command,
            run_sandbox_command,
            open_companion_sandbox,
            sandbox_desktop,
            sandbox_read_file,
            sandbox_write_file,
            sandbox_store_files,
            sandbox_import_file,
            sandbox_handoff,
            open_companion_browser,
            open_companion_page,
            place_companion_page,
            close_companion_page,
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
            install_app_update,
            start_app_update,
            app_update_status,
            app_update_dismiss,
            app_update_open_download,
            native_http_request,
            native_http_stream,
            native_http_stream_cancel,
            desktop_web_fetch,
            focus_main_window,
            agent_presence_show,
            agent_presence_update,
            agent_presence_hide,
            agent_presence_focus_studio,
            companion_panel_toggle,
            companion_panel_hide,
            companion_panel_fit,
            companion_panel_open_studio,
            managed_os_version,
            managed_restart_app,
            managed_events_open,
            managed_events_close,
            ensure_agents_office,
            agents_office_status,
            start_phone_preview,
            native_menu_sync,
            list_ssh_config_hosts,
            read_ssh_identity,
            ssh_config_exec
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
                    let _ = focus_main_window_inner(handle.clone());
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
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let _ = focus_main_window_inner(app_handle.clone());
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod ssh_config_tests {
    use super::{expand_home, glob_match, parse_ssh_config};
    use std::path::Path;

    #[test]
    fn reads_hosts_and_include_globs() {
        let home = Path::new("/Users/me");
        let (hosts, includes) = parse_ssh_config(
            "Include config.d/*.conf\n\nHost studio\n  HostName 10.0.0.8\n  User arrab\n  Port 2222\n  IdentityFile ~/.ssh/id_ed25519\n",
            home,
        );
        assert_eq!(includes, vec!["/Users/me/.ssh/config.d/*.conf"]);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "studio");
        assert_eq!(hosts[0].host_name, "10.0.0.8");
        assert_eq!(hosts[0].user, "arrab");
        assert_eq!(hosts[0].port, "2222");
        assert_eq!(
            hosts[0].identity_file.as_deref(),
            Some("/Users/me/.ssh/id_ed25519")
        );
        assert!(glob_match("*.conf", "work.conf"));
        assert!(!glob_match("*.conf", "work.txt"));
        assert_eq!(expand_home("~/x", home), "/Users/me/x");
    }
}
