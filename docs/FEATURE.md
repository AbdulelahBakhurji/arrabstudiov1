# Adding features (agile)

Ship small vertical slices. Prefer one user-visible outcome per PR: UI **or** API+UI, not a month-long rewrite.

## One-sprint slice

A complete feature usually touches these layers (skip what you do not need):

| Step | Where | What |
| --- | --- | --- |
| 1. Contract | `packages/shared/src/` | Types + request/response; export from `index.ts` |
| 2. Persist | `packages/database/` | Migration + repo only if data must survive restart |
| 3. Service | `apps/api/src/services/` | Business rules |
| 4. HTTP | `apps/api/src/routes/v1.ts` | Route that calls the service |
| 5. Client | `apps/desktop/src/lib/api.ts` | `arrabApi.*` method |
| 6. UI | `apps/desktop/src/pages/` or `components/` | Page or panel |
| 7. Nav | `apps/desktop/src/roles/catalog.ts` | Rail item (if it needs a destination) |
| 8. Route | `apps/desktop/src/App.tsx` | Individual and/or organization child route |
| 9. Copy | `apps/desktop/src/i18n/messages.ts` | `en` **and** `ar` keys |
| 10. Gate | `apps/desktop/src/features/flags.ts` | Optional flag for gradual rollout |

## Scaffold

```bash
pnpm new:feature my-thing
# or with audiences:
pnpm new:feature my-thing --audience=individual,family
```

Creates a page stub under `apps/desktop/src/pages/`, a feature note under `apps/desktop/src/features/`, and prints the checklist above.

## Agile rules for this repo

1. **Thin PR** — one outcome; tests for the new path; no drive-by refactors.
2. **Reuse catalogs** — nav in `roles/catalog.ts`, purposes in `purpose-registry`, connectors via API catalog.
3. **Shared is the contract** — desktop never invents response shapes the API does not own.
4. **Bilingual from day one** — every new string gets `en` + `ar`.
5. **Flag risky UI** — use `isFeatureEnabled("…")` until the slice is stable, then remove the flag.
6. **Settings** — add a tab via `apps/desktop/src/features/settings-tabs.ts`, not by hunting through `SettingsPage.tsx`.
7. **Family / org** — gate by plan audience (`audienceFromPlanId` / `navForRole`), not ad-hoc localStorage.

## Do / don’t

| Do | Don’t |
| --- | --- |
| Add a service + one route | Dump logic into `v1.ts` handlers |
| Extend `arrabApi` | Call `fetch` ad hoc from pages |
| Filter nav by role | Duplicate pages per audience unless UX truly differs |
| Write a focused `*.test.ts` | Rely only on manual clicks |
| Keep secrets on the API | Put provider keys in the desktop app |

## Feature flags

```ts
import { isFeatureEnabled } from "@/features/flags";

if (isFeatureEnabled("example_panel")) {
  // new UI
}
```

Flags are local/env (see `flags.ts`). They are for **shipping dark**, not long-term forks. Delete once the feature is default-on.

## Definition of done (per slice)

- [ ] Types in `@arrab/shared` (if API)
- [ ] Route + service covered by a test when behavior is non-trivial
- [ ] Desktop calls `arrabApi` only
- [ ] Nav + route wired for the right audiences
- [ ] `en` + `ar` strings
- [ ] `pnpm typecheck` and relevant `pnpm test` pass
- [ ] Flag removed or documented if still behind a flag

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system layout
- [DATA_MODEL.md](./DATA_MODEL.md) — entities
- [SECURITY.md](./SECURITY.md) — secrets stay on the API
