# Arrab API

Authoritative HTTP surface for desktop, iOS, and managed clients.

## Base URL

| Environment | Root |
| --- | --- |
| Local | `http://127.0.0.1:8787` |
| Production | `https://api.arrabai.com/r/nmpi6uidtpkh1bdf` |

Coolify/Traefik keeps the `/r/<id>` prefix; the API strips it internally.

## Auth headers

| Header | Meaning |
| --- | --- |
| `Authorization: Bearer <token>` | Account / seat-bound session |
| `X-Arrab-Account-Session` | Same token (desktop dual-send) |
| `X-Arrab-Employee-Session` | Org employee seat |
| `X-Arrab-Family-Member` | Family profile switch (owner sessions only; unknown id → 404) |
| `X-Arrab-Refresh: 1` | Opt into short-lived access + refresh tokens |
| `X-Arrab-Device-Name` / `Platform` / `App-Version` | Device session metadata |

## Module map (`apps/api/src/modules`)

| Module | Responsibility |
| --- | --- |
| `accounts` | Connect, sign-in, sessions, password, profile, subscribe |
| `billing` | Plans, Moyasar checkout/callback, confirm (owner-only) |
| `workspace` | Agents, teams, tasks, skills, knowledge, usage, `/v1/meta` |
| `conversations` | Chat + streaming + AI orchestration |
| `connectors` | OAuth connectors, webhooks, catalog |
| `organization` | Org seats, departments, crew, workforce |
| `family` | Household seats, guardian, seat sign-in |
| `encryption` | Sealed vault / E2EE |
| `sync` | CAS sync protocol |
| `desk` / `control` | Companion desk + managed-client sync |
| `erp` | Separate ERP bearer (`/erp/*`) |

Routes register from `http/v1.ts`. Cross-cutting policy: `http/route-policy.ts` + `platform/http/security.ts`.

## Public allowlist (session not required)

Examples: `/health`, `/ready`, `/v1/meta`, `/v1/billing/plans`, auth start/sign-in, `/v1/client/hello`, signed webhooks, OAuth callbacks.  
**Not public:** `/v1/billing/confirm` (owner session required).

## Contract package

Serializable request/response types: `packages/shared` (`api-contract.ts`, `account.ts`, `entitlements.ts`, …).

Desktop calls only through `arrabApi` (`apps/desktop/src/core/api/api.ts`).

## Entitlements

Machine-checkable plan features: `packages/shared/src/entitlements.ts` → `entitlementsForPlan`.  
Server enforces quotas in `AccountService` / conversation path. UI may mirror for pause screens.

## Version

`GET /v1/meta` → `{ name, version, persistence, … }` (currently **0.15.1** on production).
