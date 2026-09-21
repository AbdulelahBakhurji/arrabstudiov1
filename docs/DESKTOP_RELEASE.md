# Arrab Studio desktop — ship as a Mac / Windows app

Arrab Studio ships as a native desktop product (Tauri 2): a signed app shell, web UI, and platform installers.

## Product identity

| Field | Value |
| --- | --- |
| Product name | Arrab Studio |
| Bundle ID | `com.arrab.studio` |
| Version | synced from root `package.json` |
| Publisher | Arrab |

## Develop

```bash
pnpm install
pnpm dev:api          # optional local API
pnpm dev:desktop      # native window + Vite
```

## Ship

```bash
# Current machine (macOS → .app + .dmg)
pnpm ship:mac

# Universal Mac binary (Intel + Apple Silicon)
pnpm ship:mac:universal

# Windows (must run on Windows or CI)
pnpm ship:windows

# Auto-detect host OS
pnpm ship
```

Installers are copied to:

```text
release/artifacts/vX.Y.Z/
```

### macOS install

1. Open the `.dmg`
2. Drag **Arrab Studio** into Applications
3. If Gatekeeper blocks an unsigned build: right-click → **Open**

### Windows install

1. Run the NSIS `*-setup.exe` (recommended), or the `.msi`
2. WebView2 installs automatically if missing

## CI

`.github/workflows/desktop-release.yml` builds macOS and Windows artifacts on `v*` tags or manual dispatch.

## Signing (enterprise)

- **macOS:** `APPLE_SIGNING_IDENTITY="Developer ID Application: …"` then `pnpm ship:mac`. Add Apple notarization in your release pipeline for Gatekeeper-clean distribution.
- **Windows:** Authenticode certificate + timestamp (see `apps/desktop/packaging/windows/README.md`).

## Layout

```text
apps/desktop/
  packaging/           # entitlements + ship notes
  src-tauri/           # native shell + tauri.conf.json
  src/                 # React UI
scripts/
  build-mac.sh
  build-windows.sh
  package-release.sh
  dev-desktop.sh
release/artifacts/     # output (gitignored)
```
