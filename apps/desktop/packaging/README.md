# Desktop packaging

Ship Arrab Studio as a native desktop product (macOS `.app` / `.dmg`, Windows NSIS / MSI).

## Layout

```text
apps/desktop/
  packaging/
    macos/entitlements.plist   # Hardened Runtime entitlements
    windows/                   # Windows signing & installer notes
  src-tauri/tauri.conf.json    # Bundle identity, icons, installers
scripts/
  build-mac.sh                 # Build .app + .dmg on macOS
  build-windows.sh             # Build NSIS/MSI on Windows
  package-release.sh           # Sync version + build + collect artifacts
```

## Quick ship

From the repo root:

```bash
# macOS (Apple Silicon / Intel)
pnpm ship:mac

# Windows (run on a Windows machine or windows-latest CI)
pnpm ship:windows

# Collect into release/artifacts/
pnpm ship
```

Artifacts land in `release/artifacts/` (gitignored).

## App updates

Tagged releases (`v*`) publish installers to a GitHub Release. The desktop app checks
`GET /repos/{owner}/{repo}/releases/latest` and notifies when a newer version exists.

- Settings → About → **Updates** panel (check / download)
- Settings → Notifications → **App updates** + **Check for updates on launch**
- Override repo with `VITE_GITHUB_RELEASES_REPO=owner/name` at build time

## Signing (production)

- **macOS:** set `APPLE_SIGNING_IDENTITY` (Developer ID Application) and optional notarization env vars.
- **Windows:** set `TAURI_SIGNING_PRIVATE_KEY` / certificate thumbprint for Authenticode.

Unsigned local builds still produce installable apps (Gatekeeper may require right-click → Open on Mac).
