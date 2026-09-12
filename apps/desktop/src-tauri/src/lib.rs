use std::fs;
use std::path::{Component, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
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
    if ns != "cache" && ns != "chats" && ns != "incognito" {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            device_store_get,
            device_store_set,
            device_store_remove,
            device_store_keys,
            device_store_clear,
            open_external_url
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Arrab Studio");
}
