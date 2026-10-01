# Arrab Studio — agent guide

This file is the map for Cursor and Claude. Read it before editing. Product truth for the running desktop UI is `apps/desktop`, not the design previews.

## Repository

pnpm monorepo. Desktop never holds provider keys or connector secrets. The API owns persistence, billing, and model calls.

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
| `.cursor/rules` | Persistent Cursor rules |

## Audiences

Gate by plan audience (`audienceFromPlanId` / `navForRole`), not ad-hoc storage.

- **Solo / individual** — `apps/desktop/src/pages/CompanionsPage.tsx`, `IndividualHomePage.tsx`
- **Family** — `apps/desktop/src/components/family/`, `src/lib/guardian.ts`, `src/lib/family-*.ts`
- **Organization** — `apps/desktop/src/components/organization/`, `src/pages/HomePage.tsx`, `WorkforcePage.tsx`, `ChatPage.tsx`

## How to add a feature

Plug-in modules live in `apps/desktop/src/features/modules/`. Do **not** edit `App.tsx` or `roles/catalog.ts` for a new page.

```bash
pnpm new:feature weekly-digest --audience=individual,family --nav
```

API/data slice: `packages/shared` → `packages/database` → `apps/api` service + route → `arrabApi` → the module page. Full checklist: `docs/FEATURE.md`.

## Desktop UI map

```text
apps/desktop/src/
  App.tsx                 Routes (individuals / organizations)
  components/
    family/               Household, Guardian, parental chat
    organization/         HQ admin, org chat, live map
    companions/           Companion rooms and catalog
    managed/              Control-plane client (sync, updates, notices)
    shared/               Cross-audience chrome
  pages/                  Route screens
  lib/                    Client logic (api, prefs, billing, guardian)
  roles/catalog.ts        Rail destinations per audience
  i18n/messages.ts        All user-visible copy
```

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
