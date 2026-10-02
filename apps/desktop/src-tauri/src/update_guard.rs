//! Trust rules for the in-app installer fallback.
//!
//! The signed Tauri updater verifies a minisign signature. The fallback path downloads a plain
//! installer, so *where it comes from* and *who signed it* are the only protections:
//!
//! * the URL must be a release asset of this project's repository (or Arrab's own domain), and
//!   every redirect hop must stay on a known release-hosting domain;
//! * on macOS the downloaded app must carry a valid code signature from the **same Developer ID
//!   team** as the app that is running — an unsigned or ad-hoc running app can never auto-install.

use reqwest::Url;

/// `owner/name` of the repository that publishes releases (override at build time).
pub const RELEASES_REPO: &str = match option_env!("ARRAB_RELEASES_REPO") {
    Some(repo) => repo,
    None => "AbdulelahBakhurji/arrabstudiov1",
};

/// Hosts a GitHub release download may redirect through.
const REDIRECT_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

fn is_arrab_host(host: &str) -> bool {
    host == "arrabai.com" || host.ends_with(".arrabai.com")
}

pub fn redirect_allowed(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    REDIRECT_HOSTS.contains(&host.as_str()) || is_arrab_host(&host)
}

/// Validate the first URL of an update download.
pub fn pin_release_url(raw: &str) -> Result<Url, String> {
    pin_release_url_for(raw, RELEASES_REPO)
}

pub fn pin_release_url_for(raw: &str, repo: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw.trim()).map_err(|_| "Invalid update URL".to_string())?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Update URL must be https".into());
    }
    if parsed.port().is_some() {
        return Err("Update URL must not specify a port".into());
    }
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    if is_arrab_host(&host) {
        return Ok(parsed);
    }
    let prefix = format!("/{}/releases/", repo.to_ascii_lowercase());
    if host == "github.com" && parsed.path().to_ascii_lowercase().starts_with(&prefix) {
        return Ok(parsed);
    }
    Err("Update URL must be a release of the Arrab Studio project".into())
}

/// Pull `TeamIdentifier=` out of `codesign -dv --verbose=2` output (which goes to stderr).
pub fn parse_team_identifier(codesign_output: &str) -> Option<String> {
    codesign_output
        .lines()
        .find_map(|line| line.trim().strip_prefix("TeamIdentifier="))
        .map(str::trim)
        .filter(|team| !team.is_empty() && *team != "not set")
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPO: &str = "AbdulelahBakhurji/arrabstudiov1";

    #[test]
    fn accepts_release_assets_of_the_project_repo() {
        for ok in [
            "https://github.com/AbdulelahBakhurji/arrabstudiov1/releases/download/v1.2.3/Arrab-Studio.dmg",
            "https://github.com/abdulelahbakhurji/ArrabStudioV1/releases/latest/download/x.dmg",
            "https://api.arrabai.com/releases/arrab.dmg",
            "https://arrabai.com/download/arrab.dmg",
        ] {
            assert!(pin_release_url_for(ok, REPO).is_ok(), "{ok}");
        }
    }

    #[test]
    fn rejects_anyone_elses_github_and_lookalike_hosts() {
        for bad in [
            "https://github.com/attacker/arrabstudiov1/releases/download/v9/x.dmg",
            "https://github.com/AbdulelahBakhurji/arrabstudiov1-evil/releases/download/v9/x.dmg",
            "https://github.com/AbdulelahBakhurji/other/releases/download/v9/x.dmg",
            "https://github.com/AbdulelahBakhurji/arrabstudiov1/raw/main/x.dmg",
            "https://objects.githubusercontent.com/github-production-release-asset/x.dmg",
            "https://evilgithub.com/AbdulelahBakhurji/arrabstudiov1/releases/download/v1/x.dmg",
            "https://github.com.evil.test/AbdulelahBakhurji/arrabstudiov1/releases/x",
            "https://notarrabai.com/x.dmg",
            "https://arrabai.com.evil.test/x.dmg",
            "http://github.com/AbdulelahBakhurji/arrabstudiov1/releases/download/v1/x.dmg",
            "https://user:pw@github.com/AbdulelahBakhurji/arrabstudiov1/releases/download/v1/x.dmg",
            "https://github.com:8443/AbdulelahBakhurji/arrabstudiov1/releases/download/v1/x.dmg",
            "file:///tmp/x.dmg",
            "",
        ] {
            assert!(pin_release_url_for(bad, REPO).is_err(), "{bad}");
        }
    }

    #[test]
    fn redirects_may_only_land_on_release_hosts() {
        let ok = |u: &str| redirect_allowed(&Url::parse(u).unwrap());
        assert!(ok("https://release-assets.githubusercontent.com/a/b"));
        assert!(ok("https://objects.githubusercontent.com/a"));
        assert!(ok("https://github.com/x"));
        assert!(!ok("http://github.com/x"));
        assert!(!ok("https://evil.test/x.dmg"));
        assert!(!ok("https://githubusercontent.com.evil.test/x"));
    }

    #[test]
    fn team_identifier_parsing() {
        let signed = "Executable=/Applications/Arrab.app/Contents/MacOS/arrab\nIdentifier=com.arrab.studio\nTeamIdentifier=ABCDE12345\n";
        assert_eq!(parse_team_identifier(signed).as_deref(), Some("ABCDE12345"));
        assert_eq!(parse_team_identifier("TeamIdentifier=not set\n"), None);
        assert_eq!(parse_team_identifier("Signature=adhoc\n"), None);
        assert_eq!(parse_team_identifier(""), None);
    }
}
