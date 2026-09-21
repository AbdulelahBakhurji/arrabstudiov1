# Windows packaging notes

Build Arrab Studio installers on a Windows host (or GitHub Actions `windows-latest`).

```powershell
pnpm install
pnpm ship:windows
```

Outputs:

- `Arrab Studio_VERSION_x64-setup.exe` (NSIS)
- `Arrab Studio_VERSION_x64_en-US.msi` (WiX / MSI)

## Code signing (enterprise)

1. Obtain an Authenticode certificate.
2. Set before build:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "..."
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
# or configure certificateThumbprint in tauri.conf.json via --config merge
```

3. Prefer DigiCert / Sectigo timestamp servers for long-lived trust.

WebView2 is installed via the download bootstrapper when missing (same model as many Chromium-shell apps).
