# Development

## Requirements

- Node.js 22+ (`corepack enable`)
- pnpm 10
- Rust stable (desktop / Tauri only)
- Optional: PostgreSQL for API persistence
- Optional: AI provider keys on the **API** `.env` only

## First-time setup

```bash
pnpm install
cp .env.example .env
cp apps/desktop/.env.example apps/desktop/.env
```

### Local desktop → local API

In `apps/desktop/.env`:

```bash
VITE_ARRAB_API_URL=http://127.0.0.1:8787
VITE_ARRAB_API_ROUTE_PREFIX=
```

### Local desktop → production API

```bash
VITE_ARRAB_API_URL=https://api.arrabai.com
VITE_ARRAB_API_ROUTE_PREFIX=/r/nmpi6uidtpkh1bdf
```

## Daily commands

```bash
pnpm dev:api          # Fastify on :8787
pnpm dev:desktop      # Tauri + Vite

pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e         # ARRAB_E2E=1 browser shells
pnpm qa:matrix         # regenerate plan × entitlement table
pnpm new:feature <id> --audience=individual,family --nav
```

## Environment roles

| Concern | Development | Production |
| --- | --- | --- |
| API host | `127.0.0.1:8787` | `api.arrabai.com` + Coolify prefix |
| Persistence | file under `~/.arrab-studio` or local Postgres | Postgres + `DATA_ENCRYPTION_KEY` |
| Plan redeem codes | `ARRAB_ENABLE_PLAN_CODES=1` for tests | **off** |
| CORS loopback | allowed when `NODE_ENV≠production` | deny loopback; explicit origins |
| OpenWA Docker | optional WhatsApp sidecar only | same — not required for core API |

## Architecture boundaries (do not violate)

```text
UI (domains/features)
  → arrabApi (core/api)
  → Arrab API (modules/*)
  → domain services
  → packages/database
  → Postgres / file
```

Desktop import direction: `shared → core → domains → app/entries`  
(`tests/architecture.test.ts` enforces this.)

## Debugging API

```bash
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8787/v1/meta
# Live probe (optional):
ARRAB_LIVE_API_URL=https://api.arrabai.com/r/nmpi6uidtpkh1bdf \
  pnpm exec vitest run apps/api/src/http/live-api.contract.test.ts
```

Deploy: [DEPLOY.md](./DEPLOY.md) (`APP_DIR=/root/arrab/platform`).
