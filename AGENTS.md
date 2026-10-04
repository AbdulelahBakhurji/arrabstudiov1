# Arrab Studio — agent guide

This file is the map for Cursor and Claude. Read it before editing. Product truth for the running desktop UI is `apps/desktop`, not the design previews.

## Repository

pnpm monorepo. Desktop never holds provider keys or connector secrets. The API owns persistence, billing, and model calls.

Full map: [STRUCTURE.md](./STRUCTURE.md).

| Path | Role |
| --- | --- |
| `apps/desktop` | Tauri 2 + React — Studio for solo, family, and organization |
| `apps/api` | Fastify API |
| `apps/ios` | Native SwiftUI client |
| `apps/android` | Managed Android client |
| `apps/agents-office` | Internal agents office |
| `packages/shared` | Domain types + HTTP contract |
| `packages/core` | Errors, ports, helpers |
| `packages/ai` | AI gateway + adapters |
| `packages/agents` | Chat runtime |
| `packages/database` | Persistence + migrations |
| `docs` | Architecture, product, security, design |
| `skills` | Project agent skills |
| `tests` | Cross-package and desktop tests |
| `scripts` | Dev and ship |
| `brand` | Canonical logo and icon |
| `vendor/` | Research-only dumps (not product) |
| `.cursor/rules` | Persistent Cursor rules |

## Audiences

Gate by plan audience (`audienceFromPlanId` / `navForRole`), not ad-hoc storage.

- **Solo / individual** — `apps/desktop/src/domains/companions/pages/` (`CompanionsPage`, `IndividualHomePage`)
- **Family** — `apps/desktop/src/domains/family/` (`ui/`, `guardian.ts`, `family-session.ts`)
- **Organization** — `apps/desktop/src/domains/organization/` (`ui/`, `pages/HomePage`, `WorkforcePage`) and `domains/chat/pages/ChatPage.tsx`

## How to add a feature

Plug-in modules live in `apps/desktop/src/features/modules/`. Do **not** edit `App.tsx` or `roles/catalog.ts` for a new page.

```bash
pnpm new:feature weekly-digest --audience=individual,family --nav
```

API/data slice: `packages/shared` → `packages/database` → `apps/api` service + route → `arrabApi` → the module page. Full checklist: `docs/FEATURE.md`.

## Desktop UI map

```text
apps/desktop/src/
  app/        main.tsx, App.tsx (routes), shell/ (StudioFrame, AuthGate, TitleBar)
  entries/    Extra Tauri windows (agent-presence, companion-panel, updater)
  domains/    account chat companions connectors encryption family organization
              managed notifications settings studio brain
              convention: api.ts · model/ · lib/ · pages/ · ui/ (+ catalog/ for companions)
  core/       api/ (http.ts + composed arrabApi) · session/ · storage/ · platform/
  shared/     ui/ · lib/ · hooks/ · i18n/locales/{en,ar}/<domain>.ts · theme/ · styles/
  features/   Plug-in page registry (modules/)
  legacy/     Retired screens — do not import
```

Companions: `domains/companions/{model,catalog,lib,pages,ui}`.  
Chat: `domains/chat/{model,lib,pages,ui}`.

Imports point down: `shared → core → domains → app/entries`. `tests/architecture.test.ts` fails the build on a violation.

API: `platform/` (config, http security, crypto, request context) → `modules/<domain>/` (service + routes + tests) → `http/v1.ts`. Full layout in `docs/ARCHITECTURE.md`.

## Rules

1. Thin change — one outcome; no drive-by refactors.
2. Shared package is the contract — do not invent API response shapes on the client.
3. Bilingual from day one — every new string gets `en` + `ar`.
4. Keep the current visual language; polish, do not redesign.
5. Never commit `.env`, keys, or credential JSON.

## Commands

```bash
pnpm install
pnpm dev:api
pnpm dev:desktop
pnpm typecheck
pnpm test
```
