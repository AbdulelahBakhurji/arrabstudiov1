# Engineering status — Arrab Studio 0.15.1

Living record of the master audit. Last verified: 2026-10-02.

## Executive verdict

| Property | Status |
| --- | --- |
| Modular monorepo | **PASS** — apps + packages with enforced import direction |
| API-first / real production API | **PASS** — `api.arrabai.com` @ 0.15.1, postgres |
| Security hardening | **PASS WITH LIMITATIONS** — SEC-01–08 in tree; MFA / multi-tenant still open |
| Feature extensibility | **PASS** — `pnpm new:feature` + module checklist |
| Docker on core path | **PASS** — systemd Node API; OpenWA Docker optional only |
| Multi-tenant SaaS | **FAIL / known** — one studio account model (+ legacy dual-row primary pick) |
| Ultra plan | **N/A** — catalog uses Solo / Studio (not Ultra) |

**Do not reshape** `apps/api` → `services/api` or invent empty packages. The current layout already matches the responsibility model; moving trees would break deploy (`/root/arrab/platform`), CI, and imports without improving cohesion.

## Architecture (actual)

```text
Desktop (Tauri/React) / iOS
        ↓  arrabApi / ArrabAPIClient
https://api.arrabai.com/r/<coolify-id>
        ↓  Traefik TLS
systemd arrab-api (Fastify)
        ↓  security → route-policy → modules
Postgres (encrypted fields) + AI providers
```

### Conceptual modules → real folders

| Concept | Location |
| --- | --- |
| Auth / sessions | `apps/api/src/modules/accounts` + desktop `core/session` |
| Entitlements | `packages/shared/src/entitlements.ts` + AccountService |
| Billing | `apps/api/src/modules/billing` |
| Family | `apps/api/src/modules/family` + `domains/family` |
| Organization | `apps/api/src/modules/organization` + `domains/organization` |
| AI | `packages/ai` + conversations module + `packages/agents` |
| Sync | `packages/shared/src/sync` + `apps/api/src/modules/sync` |
| Desktop features | `apps/desktop/src/features/modules` + `domains/*` |
| Contract | `packages/shared` |
| Persistence | `packages/database` |

## How to add the next feature

See [FEATURE.md](./FEATURE.md). Short path:

```text
1. pnpm new:feature <id> --audience=… --nav
2. packages/shared — types
3. packages/database — migration if needed
4. apps/api/src/modules/<domain> — service + routes + tests
5. register in http/v1.ts (+ route-policy if owner/manager)
6. domains/<domain>/api.ts → arrabApi
7. en + ar copy
8. pnpm typecheck && focused tests
```

## Remaining debt (honest)

1. Multi-tenant accounts (public SaaS blocker)
2. MFA / biometric unlock
3. Desktop sync migration onto SyncRecords for conversations/projects
4. Giant UI files (`ChatPage.tsx`, `CoworkPage.tsx`, companions store) — split by responsibility over time
5. Live Map production gate still false
6. Moyasar callback = invoice re-fetch, not provider signature
7. In-process rate limits (single VPS OK)
8. No Ultra SKU — marketing must match Solo/Studio/catalog

## Verification snapshot

- Automated: `pnpm test` green on hardening tree (875+ tests class)
- Live: meta `0.15.1` / postgres; `/v1/client/hello` 200; anon billing confirm 401
- Deploy path: `APP_DIR=/root/arrab/platform`, service `arrab-api`
