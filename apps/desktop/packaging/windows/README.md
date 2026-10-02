# Windows packaging notes

Build Arrab Studio installers on a Windows host (or GitHub Actions `windows-latest`).

```powershell
pnpm install
pnpm ship:windows
```

Outputs:

- `Arrab Studio_VERSION_x64-setup.exe` (NSIS)
- `Arrab Studio_VERSION_x64_en-US.msi` (WiX / MSI)

## Code signing

Two different keys are involved — do not mix them up:

| Key | Purpose | Where |
| --- | --- | --- |
| **Authenticode certificate** (DigiCert / Sectigo / Azure Trusted Signing) | Makes Windows SmartScreen trust the installer, and lets the in-app installer prove an update comes from the same publisher (it compares the signer certificate with the running app's). | `bundle.windows.certificateThumbprint` in a `--config` merge, or Azure Trusted Signing in CI |
| **minisign updater key** (`TAURI_SIGNING_PRIVATE_KEY`) | Signs the `latest.json` updater artifacts verified by the Tauri updater plugin. | CI secret; public half is `plugins.updater.pubkey` |

An unsigned Windows build installs, but the in-app update fallback refuses to run an installer whose
Authenticode signature does not match the running app. Keep the timestamp server on a long-lived CA.

WebView2 is installed via the download bootstrapper when missing (same model as many Chromium-shell apps).
