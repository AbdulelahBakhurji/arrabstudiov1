//! Hand a URL or file to the operating system without going through a shell.
//!
//! The previous Windows implementation ran `cmd /C start "" <target>`; `cmd.exe` re-parses its
//! command line, so a URL or file name containing `&` (`https://x.test/&calc.exe`) executed a
//! second command. These helpers never involve a shell.

use std::path::Path;
use std::process::{Command, Stdio};

/// Validate a URL that came from the webview or from model output before it is opened.
pub fn checked_web_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 2048
        || trimmed.chars().any(|c| c.is_control() || c == ' ')
    {
        return Err("That link is not allowed".into());
    }
    let parsed =
        reqwest::Url::parse(trimmed).map_err(|_| "That link is not allowed".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) URLs are allowed".into());
    }
    if parsed.host_str().map(str::is_empty).unwrap_or(true)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("That link is not allowed".into());
    }
    // Use the normalised form so what we open is exactly what was validated.
    Ok(parsed.to_string())
}

fn spawn_detached(mut command: Command) -> Result<(), String> {
    let status = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|err| err.to_string())?;
    // Windows shell helpers report non-zero even on success; only unix openers are trusted for status.
    if cfg!(windows) || status.success() {
        Ok(())
    } else {
        Err("Could not open it".into())
    }
}

pub fn open_url(raw: &str) -> Result<(), String> {
    let url = checked_web_url(raw)?;
    #[cfg(target_os = "macos")]
    let command = {
        let mut c = Command::new("/usr/bin/open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let command = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("rundll32.exe");
        c.args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let command = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    spawn_detached(command)
}

pub fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let command = {
        let mut c = Command::new("/usr/bin/open");
        c.arg(path);
        c
    };
    #[cfg(target_os = "windows")]
    let command = {
        let mut c = Command::new("explorer.exe");
        c.arg(path);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let command = {
        let mut c = Command::new("xdg-open");
        c.arg(path);
        c
    };
    spawn_detached(command)
}

#[cfg(test)]
mod tests {
    use super::checked_web_url;

    #[test]
    fn accepts_ordinary_web_urls() {
        assert_eq!(
            checked_web_url(" https://arrabai.com/path?q=1&b=2 ").unwrap(),
            "https://arrabai.com/path?q=1&b=2"
        );
        assert!(checked_web_url("http://localhost:8787/x").is_ok());
    }

    #[test]
    fn rejects_other_schemes_and_smuggling() {
        for bad in [
            "",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "ms-msdt:/id PCWDiagnostic",
            "https://user:pw@example.com/",
            "https://example.com/ with space",
            "https://example.com/\nsecond-line",
            "not a url",
            "arrab://auth/complete",
        ] {
            assert!(checked_web_url(bad).is_err(), "{bad:?}");
        }
        assert!(checked_web_url(&format!("https://e.com/{}", "a".repeat(3000))).is_err());
    }

    #[test]
    fn cmd_metacharacters_survive_only_as_inert_url_text() {
        // `&`, `|` and `^` are legal in URLs; the point is that no shell ever sees them.
        let url = checked_web_url("https://example.com/&calc.exe|whoami").unwrap();
        assert!(url.starts_with("https://example.com/"));
    }
}
