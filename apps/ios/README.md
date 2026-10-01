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

## Individuals shell (matches design frames)

Adaptive chrome for phone → fold → iPad:

- **Phone:** top bar + Chat / Board / Tasks + hamburger drawer
- **iPad:** permanent side rail (Chat, Board, Tasks, Me) + Arrab top chrome
- **Chat** — companion strip (Control policy + API agents), welcome card, composer (SSE)
- **Board / Tasks / Me** — design-frame layouts
- **Settings** — full grid (usage, account, plans, appearance, notifications, privacy, about…) with Control sync + limits
- **Connectors** — live `/v1/connectors` + Arrab Control `/erp/connectors` catalog
- **Sessions / Incognito / Studio / Brain / Companions** — drawer destinations
- **Managed Control** — sync, SSE, banners, bell inbox, usage meter, remote commands, APNs

`--cp-*` tokens from desktop `companions.css` drive dark and light themes. ERP/Control desk manages companions, connectors, notices, and maintenance that this client consumes.

## App Store readiness

Already included for Apple review:

- `PrivacyInfo.xcprivacy` (no tracking; email, name, device id, product interaction for app functionality)
- `ITSAppUsesNonExemptEncryption = false` (HTTPS / standard crypto)
- Account **deletion** in Settings → Privacy / About and Account (`POST /v1/account/disconnect`)
- Privacy Policy, Terms, and Support links on Auth + Settings
- Face ID / passcode **Lock Studio** (optional)
- Offline banner + send gating; Dynamic Type; VoiceOver labels; Share/Copy on messages
- App Icon 1024×1024; iPhone + iPad orientations; multi-scene capable
- Local network usage string only for optional PC link
- Portrait + landscape; `TARGETED_DEVICE_FAMILY = 1,2`
- Deep link scheme `arrab://`
- Version **1.1.0** (build 2)

Still required before submit:

- App Store Connect privacy nutrition labels (match PrivacyInfo)
- Production API host with TLS
- Real Privacy / Terms / Support pages live at arrabai.com
- Signing Team + distribution certificate
- Screenshots for phone + iPad

## Layout

```
apps/ios/
  ArrabStudio/          SwiftUI sources
  Config/               Info.plist, Privacy, entitlements
  Scripts/              generate_xcodeproj.py
  ArrabStudio.xcodeproj generated
```
