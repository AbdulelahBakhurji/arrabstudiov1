# Arrab Studio — iOS

Native SwiftUI client for Arrab Studio. Same product language as desktop (dark chrome, Studio companions, Brain map, chat), shortened for phone and adaptive from iPhone SE → Pro Max → iPad.

## Open & run

```bash
cd apps/ios
open ArrabStudio.xcodeproj
```

To regenerate the Xcode project after adding Swift files:

```bash
node Scripts/generate_xcodeproj.cjs
```

In Xcode:

1. Select the **ArrabStudio** target → **Signing & Capabilities** → choose your Team.
2. Set a unique bundle id if needed (default `studio.arrab.ios`).
3. Run on a simulator or device (iOS 17+).

## Connect to API & PC

| Mode | How |
| --- | --- |
| **Cloud API** | Me → API URL → `https://your-arrab-api` (or default). Sign in with the same email/password as desktop. |
| **LAN / desktop API** | Me → Link PC → paste `http://<mac-lan-ip>:8787`. Enables local networking (`NSAllowsLocalNetworking`). |
| **Deep link** | From Mac: `arrab://link?api=http://192.168.x.x:8787&token=<sessionToken>` |
| **Pair code** | Enter the code shown on desktop; finish with QR/URL. |

Session tokens live in the **Keychain** (`X-Arrab-Account-Session` + Bearer), matching desktop security rules — no provider secrets in the app.

## Tabs (phone-shortened)

- **Chat** — live conversations + SSE stream (falls back to POST).
- **Studio** — Arrab Assistant + specialist companions; bottom composer + suggestion chips.
- **Brain** — connected map, filters, pinch/pan, node sheet.
- **Tasks** — lightweight checklist.
- **Me** — account, API URL, PC link, sign out.

## App Store readiness

Already included for Apple review:

- `PrivacyInfo.xcprivacy` (no tracking; email for app functionality only)
- `ITSAppUsesNonExemptEncryption = false` (HTTPS only / standard crypto)
- Portrait + landscape; iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`)
- Adaptive layout via `AdaptiveMetrics` (no fixed phone frame)
- Deep link scheme `arrab://`
- Local network only when linking a desk (ATS local networking)

Still required before submit:

- App icon 1024×1024 in `Assets.xcassets/AppIcon`
- App Store screenshots + privacy nutrition labels in App Store Connect
- Production API host with TLS
- Account deletion / support URL if you collect accounts (align with web/desktop policy)

## Layout

```
apps/ios/
  ArrabStudio/          SwiftUI sources
  Config/               Info.plist, Privacy, entitlements
  Scripts/              generate_xcodeproj.py
  ArrabStudio.xcodeproj generated
```
