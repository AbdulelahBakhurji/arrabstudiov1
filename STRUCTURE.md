# Arrab Studio — repository structure

One-page map for humans and agents. Product UI lives in `apps/desktop`. Secrets and model calls live in `apps/api`.

## Top level

| Path | Role |
| --- | --- |
| [`apps/desktop`](apps/desktop) | Tauri 2 + React Studio (solo / family / org) |
| [`apps/api`](apps/api) | Fastify API — persistence, billing, AI, connectors |
| [`apps/ios`](apps/ios) | Native SwiftUI client |
| [`apps/android`](apps/android) | Managed Android client |
| [`apps/agents-office`](apps/agents-office) | Internal agents office (not product UI) |
| [`packages/shared`](packages/shared) | Domain types + HTTP contract |
| [`packages/core`](packages/core) | Errors, ports, helpers |
| [`packages/ai`](packages/ai) | AI gateway + provider adapters |
| [`packages/agents`](packages/agents) | Chat runtime |
| [`packages/database`](packages/database) | Persistence + migrations |
| [`docs`](docs) | Architecture, product, security, QA |
| [`scripts`](scripts) | Dev, ship, deploy |
| [`brand`](brand) | Canonical logo and icon |
| [`tests`](tests) | Cross-package and desktop tests |
| [`release`](release) | Local / CI installers (artifacts gitignored) |
| [`vendor`](vendor) | Research-only third-party dumps (not shipped) |
| [`AGENTS.md`](AGENTS.md) | Agent entry map |

## Desktop layers (`apps/desktop/src`)

Imports only point **down**. Enforced by `tests/architecture.test.ts`.

```text
shared/     → Pure UI, i18n, theme, prefs (imports nothing above)
core/       → API client, session, storage, Tauri platform
domains/    → Product areas (account, chat, companions, …)
features/   → Plug-in pages (`pnpm new:feature`)
app/        → Routes + shell (StudioFrame, AuthGate)
entries/    → Extra Tauri windows
legacy/     → Retired screens (do not import from new code)
```

### Domain convention (companions / chat)

```text
domains/<name>/
  api.ts          Domain HTTP slice (composed into arrabApi)
  model/          State, types, persistence
  catalog/        Product catalog data (companions only)
  lib/            Pure helpers / tools
  pages/          Routed screens
  ui/             Components (+ ui/hooks)
  README.md       Domain map
```

Other domains already use `pages/` + `ui/` (+ domain `*.ts`). Prefer that shape for new code.

## API layers (`apps/api/src`)

```text
platform/   → config, http security, crypto, context
modules/    → one folder per domain (service + routes + tests)
http/       → v1 router, deps, route policy
app.ts      → composition root
```

## Where to add X

| Want to… | Go here |
| --- | --- |
| New desktop page (solo/family) | `pnpm new:feature <kebab> --audience=… --nav` |
| New API endpoint | `packages/shared` contract → `apps/api/src/modules/<domain>/` → `http/v1.ts` |
| New shared type / DTO | `packages/shared/src/` |
| New copy (en + ar) | `apps/desktop/src/shared/i18n/locales/{en,ar}/` |
| Ship macOS installer | `pnpm ship:mac` → `release/artifacts/v*` |

## Research-only

`vendor/opendots` is an upstream reference dump. It is **not** part of Arrab Studio and must not be imported by product code.
