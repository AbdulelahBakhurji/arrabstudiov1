//! Filesystem boundary for the workspace commands.
//!
//! Two layers protect the user's disk from whatever runs in the webview (including a model that
//! was prompt-injected):
//!
//! 1. **Approved roots.** A workspace folder only becomes usable once the *user* picked it in the
//!    native folder dialog (or it is the app-owned assistant desk). The list is persisted, so a
//!    folder stays usable across restarts, but script in the webview cannot name `/` or `~`.
//! 2. **Containment.** Every relative path is resolved against the approved root with symlinks
//!    resolved, and must stay inside it.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Folders the user has explicitly granted. Stored as canonical paths.
pub struct ApprovedRoots {
    file: PathBuf,
    roots: Mutex<Vec<PathBuf>>,
}

impl ApprovedRoots {
    pub fn load(file: PathBuf) -> Self {
        let roots = fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .collect();
        Self {
            file,
            roots: Mutex::new(roots),
        }
    }

    /// Grant a folder (called only from code the user's click led to).
    pub fn approve(&self, folder: &Path) -> Result<PathBuf, String> {
        let canon = folder
            .canonicalize()
            .map_err(|err| format!("Invalid workspace folder: {err}"))?;
        if !canon.is_dir() {
            return Err("Workspace folder does not exist".into());
        }
        let mut roots = self
            .roots
            .lock()
            .map_err(|_| "Approval list is unavailable".to_string())?;
        if !roots.contains(&canon) {
            roots.push(canon.clone());
            // Keep the list bounded; oldest grants fall off first.
            if roots.len() > 64 {
                roots.remove(0);
            }
            let list: Vec<String> = roots
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if let Ok(json) = serde_json::to_string(&list) {
                let _ = write_atomic(&self.file, json.as_bytes());
            }
        }
        Ok(canon)
    }

    /// Canonical root for `raw` if (and only if) it was approved.
    pub fn require(&self, raw: &str) -> Result<PathBuf, String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err("Workspace folder is not set".into());
        }
        let canon = PathBuf::from(trimmed)
            .canonicalize()
            .map_err(|_| "Workspace folder does not exist".to_string())?;
        let roots = self
            .roots
            .lock()
            .map_err(|_| "Approval list is unavailable".to_string())?;
        if roots.contains(&canon) {
            Ok(canon)
        } else {
            Err("This folder has not been opened in Arrab Studio yet. Choose it again to grant access.".into())
        }
    }
}

/// Resolve `relative` inside `root_canon` (already canonical and approved).
///
/// * `..` may never climb above the root,
/// * symlinks are resolved on the deepest existing ancestor, so a link pointing outside is refused,
/// * paths that do not exist yet (new files, nested new folders) are allowed.
pub fn resolve_in_root(root_canon: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = relative.trim().trim_start_matches(['/', '\\']);
    if rel.is_empty() {
        return Ok(root_canon.to_path_buf());
    }
    if rel.contains('\0') {
        return Err("Invalid path".into());
    }

    let mut cleaned = PathBuf::new();
    for component in root_canon.join(rel).components() {
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
    if !cleaned.starts_with(root_canon) {
        // Lexical check first: `root/../x` must not reach canonicalize at all.
        return Err("Path escapes workspace".into());
    }

    // Deepest ancestor that exists on disk; everything below it is new and cannot be a symlink.
    let mut existing = cleaned.as_path();
    let mut missing: Vec<&std::ffi::OsStr> = Vec::new();
    while !existing.exists() {
        match (existing.file_name(), existing.parent()) {
            (Some(name), Some(parent)) => {
                missing.push(name);
                existing = parent;
            }
            _ => return Err("Invalid path".into()),
        }
    }
    let mut resolved = existing
        .canonicalize()
        .map_err(|err| format!("Invalid path: {err}"))?;
    if !resolved.starts_with(root_canon) {
        return Err("Path escapes workspace".into());
    }
    for name in missing.into_iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}

/// The workspace root itself and anything inside `.git` are never edited or removed through the
/// file tools: deleting the root destroys the project, and git hooks / config are code that runs
/// the next time the user (or an agent) touches the repository.
pub fn is_protected(root_canon: &Path, path: &Path) -> bool {
    if path == root_canon {
        return true;
    }
    path.strip_prefix(root_canon)
        .map(|rel| {
            rel.components()
                .any(|part| part.as_os_str().eq_ignore_ascii_case(".git"))
        })
        .unwrap_or(true)
}

/// Write via a sibling temp file and rename, so a crash or a full disk never leaves a
/// half-written (or empty) file in place of the previous contents.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let tmp = parent.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        // Preserve the mode of a file we are replacing (scripts keep +x).
        if let Ok(meta) = fs::metadata(path) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// File types that run code when opened with the OS default handler.
pub fn is_launchable(path: &Path) -> bool {
    if path.is_dir() {
        return path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("app"))
            .unwrap_or(false);
    }
    const LAUNCHABLE: &[&str] = &[
        "command",
        "tool",
        "sh",
        "bash",
        "zsh",
        "csh",
        "ksh",
        "workflow",
        "scpt",
        "applescript",
        "app",
        "pkg",
        "mpkg",
        "dmg",
        "terminal",
        "action",
        "exe",
        "msi",
        "bat",
        "cmd",
        "com",
        "scr",
        "ps1",
        "psm1",
        "vbs",
        "vbe",
        "js",
        "jse",
        "wsf",
        "wsh",
        "hta",
        "reg",
        "lnk",
        "jar",
        "appimage",
        "desktop",
        "run",
        "bin",
        "dll",
        "cpl",
        "inf",
        "url",
        "webloc",
    ];
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            LAUNCHABLE
                .iter()
                .any(|known| ext.eq_ignore_ascii_case(known))
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "arrab-safe-fs-{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn plain_and_new_paths_resolve_inside_root() {
        let root = scratch("plain");
        fs::write(root.join("a.txt"), "x").unwrap();
        assert_eq!(resolve_in_root(&root, "a.txt").unwrap(), root.join("a.txt"));
        assert_eq!(resolve_in_root(&root, "").unwrap(), root);
        assert_eq!(
            resolve_in_root(&root, "/a.txt").unwrap(),
            root.join("a.txt")
        );
        // New file in a folder that does not exist yet.
        assert_eq!(
            resolve_in_root(&root, "new/deep/file.md").unwrap(),
            root.join("new/deep/file.md")
        );
    }

    #[test]
    fn parent_traversal_is_refused() {
        let root = scratch("dots");
        for bad in ["../x", "a/../../x", "a/b/../../../x", "..", "./../x"] {
            assert!(resolve_in_root(&root, bad).is_err(), "{bad}");
        }
        // Climbing within the root is fine.
        fs::create_dir_all(root.join("a/b")).unwrap();
        assert_eq!(
            resolve_in_root(&root, "a/b/../c.txt").unwrap(),
            root.join("a/c.txt")
        );
        assert!(resolve_in_root(&root, "a\0b").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_pointing_outside_are_refused() {
        use std::os::unix::fs::symlink;
        let root = scratch("link-root");
        let outside = scratch("link-outside");
        fs::write(outside.join("secret.txt"), "top secret").unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        symlink(outside.join("secret.txt"), root.join("secret-link")).unwrap();

        assert!(resolve_in_root(&root, "escape").is_err());
        assert!(resolve_in_root(&root, "escape/secret.txt").is_err());
        assert!(resolve_in_root(&root, "secret-link").is_err());
        // Creating a *new* file through an escaping directory link is refused too.
        assert!(resolve_in_root(&root, "escape/new.txt").is_err());
        // A link that stays inside is fine.
        fs::create_dir_all(root.join("real")).unwrap();
        symlink(root.join("real"), root.join("alias")).unwrap();
        assert_eq!(resolve_in_root(&root, "alias").unwrap(), root.join("real"));
    }

    #[test]
    fn root_and_git_are_protected() {
        let root = scratch("protect");
        assert!(is_protected(&root, &root));
        assert!(is_protected(&root, &root.join(".git")));
        assert!(is_protected(&root, &root.join(".git/hooks/pre-commit")));
        assert!(is_protected(&root, &root.join("sub/.GIT/config")));
        assert!(!is_protected(&root, &root.join("src/main.rs")));
        assert!(!is_protected(&root, &root.join(".github/workflows/ci.yml")));
        assert!(is_protected(&root, Path::new("/somewhere/else")));
    }

    #[test]
    fn approved_roots_gate_and_persist() {
        let base = scratch("approved");
        let project = base.join("project");
        let other = base.join("other");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&other).unwrap();
        let file = base.join("approved.json");

        let roots = ApprovedRoots::load(file.clone());
        assert!(roots.require(project.to_str().unwrap()).is_err());
        assert!(roots.require("").is_err());
        assert!(roots.require("/").is_err());
        roots.approve(&project).unwrap();
        assert!(roots.require(project.to_str().unwrap()).is_ok());
        assert!(roots.require(other.to_str().unwrap()).is_err());
        // The parent of an approved folder is not approved.
        assert!(roots.require(base.to_str().unwrap()).is_err());

        let reloaded = ApprovedRoots::load(file);
        assert!(reloaded.require(project.to_str().unwrap()).is_ok());
        assert!(reloaded.require(other.to_str().unwrap()).is_err());
    }

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_files() {
        let root = scratch("atomic");
        let file = root.join("note.txt");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        let leftovers: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        write_atomic(&root.join("nested/dir/f.txt"), b"x").unwrap();
        assert!(root.join("nested/dir/f.txt").is_file());
    }

    #[test]
    fn launchable_files_are_recognised() {
        let root = scratch("launch");
        for name in [
            "run.command",
            "x.SH",
            "setup.exe",
            "a.bat",
            "b.app",
            "evil.dmg",
            "t.url",
        ] {
            assert!(is_launchable(&root.join(name)), "{name}");
        }
        for name in [
            "notes.md",
            "image.png",
            "report.pdf",
            "data.csv",
            "page.html",
            "README",
        ] {
            assert!(!is_launchable(&root.join(name)), "{name}");
        }
        fs::create_dir_all(root.join("Thing.app")).unwrap();
        assert!(is_launchable(&root.join("Thing.app")));
    }
}
