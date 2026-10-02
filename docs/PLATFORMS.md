# Platforms, sync and the shared contract

Arrab Studio is one product with several first-class clients. They share **one API contract, one
account/session model, one sync protocol and one AI gateway**. Each client keeps its own native shell.

| Client                 | Shell                                                                         | Why                                                  |
| ---------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| macOS, Windows (Linux) | Tauri 2 + Rust + React                                                        | Needs a real filesystem, terminal and OS integration |
| iOS / iPadOS           | Native SwiftUI (`apps/ios`)                                                   | App Store, Keychain, push, lifecycle                 |
| Android                | Native Kotlin recommended (`apps/android` holds the managed-client push code) | Background limits, Keystore, Play                    |
| Huawei (no GMS)        | Same Android app, HMS push + AppGallery build flavor                          | Must not require Google services                     |

Tauri is **not** forced onto mobile. The Android push bridge in `apps/android/managed-client` is written as a
Tauri mobile plugin; if the Android client is built natively (recommended), port `PushBridge`'s provider
selection (`hms` only when HMS is present and GMS is not, else `fcm`) — the logic is already GMS-independent.

## What is shared (platform-neutral TypeScript, `packages/shared`)

- `api-contract.ts` — HTTP contract under `/v1/*`; additive changes only, breaking changes need `/v2`.
- `sync/` — the sync protocol, conflict-aware merge, durable offline queue, status state machine.
  Pure functions + injected storage/transport, so desktop uses them directly and mobile clients port the
  same rules (the test suite in `sync/sync.test.ts` is the executable spec).
- `account.ts` — plans, entitlements, device `AccountSession`.

## Platform boundary (desktop: `apps/desktop/src/core/platform/`)

| Capability                  | Interface                              | macOS       | Windows                                       | Linux            | iOS / Android / Huawei                   |
| --------------------------- | -------------------------------------- | ----------- | --------------------------------------------- | ---------------- | ---------------------------------------- |
| Platform detection          | `platform-info.ts` (`PlatformInfo`)    | ✅          | ✅                                            | ✅               | ✅ (Huawei ⇒ `hasGoogleServices: false`) |
| Secure storage              | `secure-storage.ts` (`SecureStorage`)  | ✅ Keychain | ⚠️ file fallback (Credential Manager planned) | ⚠️ file fallback | native client (Keychain / Keystore)      |
| Network state               | `network.ts`                           | ✅          | ✅                                            | ✅               | native client                            |
| Client identity headers     | `client-info.ts`                       | ✅          | ✅                                            | ✅               | iOS ✅ (`ArrabAPIClient`)                |
| Filesystem (approved roots) | Rust `safe_fs`                         | ✅          | ✅ (code reviewed, CI-compiled)               | ✅               | sandbox APIs (native)                    |
| Opening URLs/files          | Rust `opener` (no shell)               | ✅          | ✅                                            | ✅               | native                                   |
| Process execution           | Rust `exec` (timeout, tree kill, caps) | ✅          | ✅                                            | ✅               | not applicable                           |

Rule: business code never branches on `if macOS / if Windows`. It asks a capability; the adapter decides.

## Sync (cross-device)

- **Model.** Every record has a server-assigned `rev`. A client edit carries `baseRev` (the revision it was
  based on) and an idempotent `opId`.
- **Server** (`apps/api/src/modules/sync`). Compare-and-set: if `baseRev` is stale the server returns the
  current record (`conflict`) instead of overwriting. Postgres decides the race in a single statement
  (verified against a real Postgres by `postgres.integration.test.ts`).
- **Client.** `OfflineQueue` stores the edit durably _before_ any network call, coalesces edits, retries with
  exponential backoff + jitter (honouring `Retry-After`), parks hopeless ops as `stuck` (never drops them),
  and refuses new edits loudly when full.
- **Merge.** `mergeRecord` is three-way and field-level; a true clash keeps the server value for convergence
  and returns the local value as a conflict so the UI can keep a copy. Edit beats delete. Chat messages use
  `mergeAppendOnly` (union by id).
- **UI states.** `deriveSyncStatus` → `online | connecting | offline | syncing | sync-error`.
  The desktop shows an accessible offline banner (`ConnectivityBanner`).
- **Pull.** Cursor-based (`GET /v1/sync/pull?cursor=`), paged.
- **Versioning.** `GET /v1/client/hello` (public) returns `protocol`, `minProtocol`, `minClientVersion`.

**Not yet wired:** the desktop's conversations/projects still use their existing stores; they have to be moved
onto `SyncRecord`s (kinds are already defined) before Mac → iPhone continuity is end-to-end. The zero-knowledge chat vault
(`/v1/e2ee/chats`) is last-write-wins by timestamp because the server cannot read ciphertext; clients should
merge decrypted transcripts with `mergeAppendOnly` before re-sealing.

## Accounts and device security

- One account, many **device sessions** (`AccountSession`): hashed tokens, 90-day sliding expiry, per-device
  name/platform, list (`GET /v1/account/sessions`), revoke one (`DELETE …/:id`), sign out everywhere
  (`POST …/revoke-all`). Desktop Account → Security lists devices and can revoke them via `arrabApi`.
  Logging out on one device no longer signs out the others or wipes connectors.
- Not yet: refresh-token rotation, MFA, biometric unlock, suspicious-session detection. The session model
  has the fields to build them on (`lastSeenAt`, `platform`, `appVersion`).

## Known single-tenant limit

The API still serves **one studio account per deployment** (`persistence.accounts.get()`); `connect` fails when an
account exists. Many users on one hosted API need a tenant dimension (workspace per account) through
persistence and every service. Until then, either run one API per customer or restrict sign-up with
`ARRAB_SIGNUP_EMAILS`. This is the largest remaining blocker for a public multi-user launch.
