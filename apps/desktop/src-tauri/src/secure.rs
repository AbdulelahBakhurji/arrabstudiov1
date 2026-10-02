//! OS-protected secret storage.
//!
//! * macOS: the user's login Keychain (`security-framework`).
//! * Other platforms: reported as unavailable, so the caller falls back to its documented
//!   file-based store. Windows Credential Manager / DPAPI and Linux Secret Service are the planned
//!   adapters behind this same interface — they are *not* implemented here and the API says so
//!   rather than pretending a file is a vault.

const SERVICE: &str = "com.arrab.studio";

/// A bounded, boring key name: no path or control characters can reach the OS API.
pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 96
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

#[derive(Debug, PartialEq, Eq)]
pub enum SecureError {
    /// No OS-protected store on this platform (constructed by the non-macOS backend).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unavailable,
    Invalid,
    Failed(String),
}

#[cfg(target_os = "macos")]
mod backend {
    use super::{SecureError, SERVICE};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    // errSecItemNotFound
    const NOT_FOUND: i32 = -25300;

    pub fn get(key: &str) -> Result<Option<String>, SecureError> {
        match get_generic_password(SERVICE, key) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| SecureError::Failed("stored value is not text".into())),
            Err(err) if err.code() == NOT_FOUND => Ok(None),
            Err(err) => Err(SecureError::Failed(err.to_string())),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), SecureError> {
        set_generic_password(SERVICE, key, value.as_bytes())
            .map_err(|err| SecureError::Failed(err.to_string()))
    }

    pub fn delete(key: &str) -> Result<(), SecureError> {
        match delete_generic_password(SERVICE, key) {
            Ok(()) => Ok(()),
            Err(err) if err.code() == NOT_FOUND => Ok(()),
            Err(err) => Err(SecureError::Failed(err.to_string())),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod backend {
    use super::SecureError;
    pub fn get(_key: &str) -> Result<Option<String>, SecureError> {
        Err(SecureError::Unavailable)
    }
    pub fn set(_key: &str, _value: &str) -> Result<(), SecureError> {
        Err(SecureError::Unavailable)
    }
    pub fn delete(_key: &str) -> Result<(), SecureError> {
        Err(SecureError::Unavailable)
    }
}

pub fn available() -> bool {
    cfg!(target_os = "macos")
}

pub fn get(key: &str) -> Result<Option<String>, SecureError> {
    if !valid_key(key) {
        return Err(SecureError::Invalid);
    }
    backend::get(key)
}

pub fn set(key: &str, value: &str) -> Result<(), SecureError> {
    if !valid_key(key) || value.len() > 16_384 {
        return Err(SecureError::Invalid);
    }
    backend::set(key, value)
}

pub fn delete(key: &str) -> Result<(), SecureError> {
    if !valid_key(key) {
        return Err(SecureError::Invalid);
    }
    backend::delete(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_names_are_restricted() {
        assert!(valid_key("workspace.aes.v1.acc_123"));
        for bad in ["", "a/b", "a b", "a\0b", "../x", &"x".repeat(200)] {
            assert!(!valid_key(bad), "{bad:?}");
        }
        assert_eq!(get("a/b"), Err(SecureError::Invalid));
        assert_eq!(set("ok", &"x".repeat(20_000)), Err(SecureError::Invalid));
    }

    /// Exercises the real login Keychain; only meaningful (and only run) on macOS.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "touches the user's login keychain; run with --ignored on a developer Mac"]
    fn keychain_round_trip() {
        let key = format!("arrab-test-{}", std::process::id());
        assert_eq!(get(&key), Ok(None));
        set(&key, "s3cret").unwrap();
        assert_eq!(get(&key), Ok(Some("s3cret".into())));
        set(&key, "rotated").unwrap();
        assert_eq!(get(&key), Ok(Some("rotated".into())));
        delete(&key).unwrap();
        assert_eq!(get(&key), Ok(None));
        delete(&key).unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn reports_unavailable_instead_of_faking_a_vault() {
        assert!(!available());
        assert_eq!(get("k"), Err(SecureError::Unavailable));
    }
}
